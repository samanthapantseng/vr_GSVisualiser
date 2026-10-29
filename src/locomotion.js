import * as THREE from "three";

// ---------------------------------------------------------------------------
// Locomotion modes.
//
// A scene's `locomotion` field picks one of these. Each returns the same small
// interface, so the viewer's frame loop does not know which one it is driving:
//
//   update(dt)        move the rig
//   reset()           back to the starting pose (R, and on entering XR)
//   readout()         { headline, detail } for the desktop HUD
//   desktopEyeHeight  where the eye sits above the rig when not in XR
//   dispose()         drop any listeners
//
// `bounds` is the object the viewer fills in once the splat extent is known,
// and it is shared by reference — these read it every frame rather than
// capturing its values, because it is empty until the file has loaded.
// ---------------------------------------------------------------------------

// Thumbstick values this small are drift, not intent. Quest sticks do not
// return exactly 0 at rest and a bare `!== 0` test makes the rig creep.
const STICK_DEADZONE = 0.12;

// Rescale past the deadzone so a full push still reaches 1.
function stick(value) {
    const v = value || 0;
    const mag = Math.abs(v);
    if (mag < STICK_DEADZONE) return 0;
    return Math.sign(v) * ((mag - STICK_DEADZONE) / (1 - STICK_DEADZONE));
}

// ---------------------------------------------------------------------------
// column — the bubble. Gaze pitch drives vertical travel inside a shaft:
// look up to rise, look down to sink, look level to hold.
// ---------------------------------------------------------------------------

function createColumn({ camera, rig, bounds, config }) {
    const forward = new THREE.Vector3();
    let velocity = 0;
    let pitchDegrees = 0;

    return {
        desktopEyeHeight: 0,

        update(dt) {
            camera.getWorldDirection(forward);

            // Pitch from the view vector, not Euler angles. Lying down puts a
            // lot of roll into the head pose, and roll makes Euler pitch
            // meaningless.
            pitchDegrees = THREE.MathUtils.radToDeg(
                Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)),
            );

            const span = Math.max(config.fullTilt - config.deadzone, 1e-3);
            const amount = THREE.MathUtils.clamp(
                (Math.abs(pitchDegrees) - config.deadzone) / span,
                0,
                1,
            );
            const direction = Math.sign(pitchDegrees) * (config.invert ? -1 : 1);
            const target =
                direction * Math.pow(amount, config.curve) * config.maxSpeed;

            // Ramp towards the target rather than snapping to it. The
            // acceleration cue is the difference between this feeling like
            // drifting and feeling like a lift dropping, and vertical motion
            // is the easy case to get wrong.
            velocity += THREE.MathUtils.clamp(
                target - velocity,
                -config.accel * dt,
                config.accel * dt,
            );

            const next = THREE.MathUtils.clamp(
                rig.position.y + velocity * dt,
                bounds.min,
                bounds.max,
            );
            // Bleed off speed at the ends instead of pressing against the limit.
            if (next === rig.position.y) velocity = 0;
            rig.position.y = next;
        },

        reset() {
            rig.position.y = (bounds.min + bounds.max) / 2;
            velocity = 0;
        },

        readout() {
            return {
                headline: `${(bounds.max - rig.position.y).toFixed(1)} m down`,
                detail:
                    `pitch   ${pitchDegrees.toFixed(0)}°\n` +
                    `speed   ${velocity.toFixed(2)} m/s\n` +
                    `height  ${rig.position.y.toFixed(1)} / ${bounds.max.toFixed(1)} m`,
            };
        },

        dispose() {},
    };
}

// ---------------------------------------------------------------------------
// freefly — the general-purpose inspection mode for a scan with no interaction
// of its own yet.
//
// In the headset, roomscale walking is already free: `local-floor` means the
// headset pose moves the camera without us doing anything. This adds the
// reach that a room does not have — left stick to move across the floor, right
// stick to rise and sink.
//
// Nothing turns the rig. You face where you physically face, which is the one
// form of turning that cannot make anyone queasy, and in roomscale it is
// enough. (Smooth stick yaw would go here if it is ever wanted; snap turn was
// tried and removed.)
// ---------------------------------------------------------------------------

function createFreefly({ camera, rig, renderer, bounds, config }) {
    const keys = new Set();
    const onKeyDown = (event) => keys.add(event.key.toLowerCase());
    const onKeyUp = (event) => keys.delete(event.key.toLowerCase());
    // Losing focus mid-push leaves a key stuck down and the rig sliding.
    const onBlur = () => keys.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    const velocity = new THREE.Vector3();
    const desired = new THREE.Vector3();
    const delta = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();

    function viewBasis() {
        camera.getWorldDirection(forward);
        forward.y = 0;
        // Looking straight up or down leaves no horizontal component at all,
        // which would kill the stick mid-push. Fall back to the rig's facing.
        if (forward.lengthSq() < 1e-6) {
            forward.set(0, 0, -1).applyQuaternion(rig.quaternion);
            forward.y = 0;
        }
        forward.normalize();
        // right = forward × up, for a Y-up right-handed world.
        right.set(-forward.z, 0, forward.x);
    }

    // Thumbsticks are axes[2] and axes[3] on Quest; axes[0..1] are the
    // (unused) touchpad slots the WebXR profile reserves. Stick y is negative
    // when pushed away from you, hence the sign flips.
    function readSticks() {
        const input = { strafe: 0, advance: 0, lift: 0 };
        const session = renderer.xr.getSession();
        if (!session) return input;

        for (const source of session.inputSources) {
            const pad = source.gamepad;
            if (!pad || pad.axes.length < 4) continue;
            const x = stick(pad.axes[2]);
            const y = stick(pad.axes[3]);
            if (source.handedness === "right") {
                // Right stick x is deliberately unused.
                input.lift = -y;
            } else {
                input.strafe = x;
                input.advance = -y;
            }
        }
        return input;
    }

    function readKeys() {
        const held = (...names) => names.some((n) => keys.has(n));
        return {
            strafe: (held("d") ? 1 : 0) - (held("a") ? 1 : 0),
            advance: (held("w") ? 1 : 0) - (held("s") ? 1 : 0),
            lift: (held("e") ? 1 : 0) - (held("q") ? 1 : 0),
        };
    }

    return {
        // In XR the headset pose supplies eye height off the floor. On the
        // desktop nothing does, so the rig carries it and you are not looking
        // at the scene from ankle level.
        desktopEyeHeight: 1.6,

        update(dt) {
            const inXr = renderer.xr.isPresenting;
            const input = inXr ? readSticks() : readKeys();

            viewBasis();
            desired
                .set(0, 0, 0)
                .addScaledVector(right, input.strafe)
                .addScaledVector(forward, input.advance);
            // Clamp the horizontal part before adding lift, so a diagonal is
            // not faster than a straight line and rising does not slow you.
            if (desired.lengthSq() > 1) desired.normalize();
            desired.multiplyScalar(config.moveSpeed);
            desired.y = input.lift * config.moveSpeed;

            // Same ramp as the column, in three axes: accel m/s² towards the
            // target rather than a jump to it.
            delta.subVectors(desired, velocity);
            const step = config.accel * dt;
            if (delta.lengthSq() > step * step) delta.setLength(step);
            velocity.add(delta);

            rig.position.addScaledVector(velocity, dt);

            // Keep the visitor within reach of the scan. Flying out into empty
            // space is disorienting and the only way back is R.
            if (!bounds.box.isEmpty()) {
                const lo = bounds.box.min;
                const hi = bounds.box.max;
                const m = config.roam;
                rig.position.set(
                    THREE.MathUtils.clamp(rig.position.x, lo.x - m, hi.x + m),
                    THREE.MathUtils.clamp(rig.position.y, lo.y - m, hi.y + m),
                    THREE.MathUtils.clamp(rig.position.z, lo.z - m, hi.z + m),
                );
            }
        },

        reset() {
            velocity.set(0, 0, 0);
            if (bounds.box.isEmpty()) {
                rig.position.set(0, 0, 0);
                return;
            }
            // Standing on the floor of the capture, at its centre. In XR the
            // headset adds eye height on top of this; on the desktop
            // desktopEyeHeight does.
            const centre = bounds.box.getCenter(new THREE.Vector3());
            rig.position.set(centre.x, bounds.box.min.y, centre.z);
        },

        readout() {
            const p = rig.position;
            return {
                headline: `${velocity.length().toFixed(1)} m/s`,
                detail: `x ${p.x.toFixed(1)}  y ${p.y.toFixed(1)}  z ${p.z.toFixed(1)}`,
            };
        },

        dispose() {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
        },
    };
}

const MODES = {
    column: createColumn,
    freefly: createFreefly,
};

export function createLocomotion(mode, context) {
    const factory = MODES[mode];
    if (!factory) {
        console.warn(`Unknown locomotion mode "${mode}"; falling back to freefly.`);
        return createFreefly(context);
    }
    return factory(context);
}

export const LOCOMOTION_MODES = Object.keys(MODES);
