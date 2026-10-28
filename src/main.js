import "./style.css";
import * as THREE from "three";
import { SparkRenderer, SplatMesh, SparkXr, isOculus } from "@sparkjsdev/spark";
import { Soundscape } from "./soundscape.js";

// ---------------------------------------------------------------------------
// Tunables. Each one can be overridden from the query string
// (?maxSpeed=2.4&upAxis=-z&worldHeight=50), so the piece can be recalibrated
// from inside the headset without a rebuild.
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);

function num(name, fallback) {
    const value = parseFloat(params.get(name));
    return Number.isFinite(value) ? value : fallback;
}

const CONFIG = {
    url: params.get("url") || "data/bubble.ksplat",
    // Which axis of the splat data points up. Measured from bubble.ksplat: the
    // column runs along +Y, 62.8 units tall and ~18 wide, so the data is
    // already Y-up and needs no rotation. (cameraUp: [-1, 0, 0] in the flat
    // viewer was a controls hack, not a statement about the data.) WebXR pins
    // world up to +Y and will not let you override it, so if a different
    // capture ever comes in tilted, rotate the scene here rather than the
    // camera: ?upAxis=-x and so on.
    upAxis: params.get("upAxis") || "+y",
    // The column is scaled so its full vertical extent spans this many metres.
    // Set ?worldHeight=0 to skip rescaling and treat 1 data unit as 1 metre,
    // which gives a 63 m shaft.
    worldHeight: num("worldHeight", 45),
    // Gaze-pitch locomotion.
    maxSpeed: num("maxSpeed", 0.8), // m/s at full tilt
    accel: num("accel", 0.9), // m/s^2 ramp
    deadzone: num("deadzone", 18), // degrees of pitch that still count as "hold"
    fullTilt: num("fullTilt", 62), // degrees of pitch for full speed
    curve: num("curve", 1.6), // > 1 softens the onset
    invert: params.get("invert") === "1",
    // Keep the rig this far inside the column so you never drift out of the splats.
    margin: num("margin", 2),
    // Render budget. lodScale multiplies Spark's per-platform splat budget,
    // which is 500k on Quest.
    lodScale: num("lodScale", 1),
    // WebXR fixed foveation. This one drops the *framebuffer* resolution
    // towards the edge of each eye, so it buys fragment cost, which splats
    // spend lavishly. Independent of the splat foveation below, which buys
    // splat count instead; both are on at once.
    foveation: num("foveation", 0.75),
    // Foveated splats, after Spark 2.0's LoD foveation
    // (worldlabs.ai/blog/spark-2.0). The LoD traversal ranks splats by their
    // apparent screen size, so scaling that size by a factor that falls off
    // with the angle from the view direction spends the same budget unevenly:
    // fine splats where you are looking, coarse ones in the periphery. Halving
    // the factor gets you roughly 2x coarser splats there.
    //
    // Fixed, not gaze-tracked: Quest exposes no eye tracking to WebXR, so the
    // cone is pinned to the head direction. That is why coneFov0 cannot be
    // narrow — it has to cover wherever the eyes roam while the head stays
    // put, which is about 30 degrees off-centre either way.
    foveate: params.get("foveate") !== "0",
    coneFov0: num("coneFov0", 60), // full-width cone kept at full detail
    coneFov: num("coneFov", 120), // full-width cone where coneFoveate is hit
    coneFoveate: num("coneFoveate", 0.3), // scale at the edge of coneFov
    behindFoveate: num("behindFoveate", 0.1), // scale behind the viewer
    // Seconds per leg of an automatic foveated/uniform A/B. 0 is off. See
    // updateFoveateAB.
    foveateAB: num("foveateAB", 0),
    // Seconds between frame-timing lines on the console. The HUD is DOM and so
    // is invisible inside an XR session, which makes this the only way to read
    // frame timing while the headset is actually on. 0 silences it.
    fpsLog: num("fpsLog", 1),
    // Sound. The soundscape is a port of the Pd patches in
    // ThreeJS_Gaussian_Splat/soundscapd; see src/soundscape.js.
    audio: params.get("audio") !== "0",
    volume: num("volume", 0.9),
    // 0 disables HRTF on the one-shots, leaving them centred. The Pd original
    // does spatialise them, so this is for comparison rather than fidelity.
    spatial: params.get("spatial") !== "0",
    // Mean seconds between one-shots in a zone at full gain. A guess; tune it
    // by ear.
    shotInterval: num("shotInterval", 9),
    // Scales the zone gain falloff. 1 puts each zone's edge at 25% of its
    // centre; higher is tighter and more separated, lower is more blended.
    falloff: num("falloff", 1),
};

const statusEl = document.getElementById("status");
const hudEl = document.getElementById("hud");
const hudDepthEl = document.getElementById("hudDepth");
const hudDetailEl = document.getElementById("hudDetail");
const hintEl = document.getElementById("hint");

// ---------------------------------------------------------------------------
// Renderer, scene, and the rig that locomotion actually drives
// ---------------------------------------------------------------------------

// antialias must be off: WebGL MSAA does nothing for Gaussian splats and costs
// a lot of fill rate, which is the budget that matters in stereo.
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById("app").appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03121c);

const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
);

// In an XR session three.js overwrites camera.matrix from the headset pose every
// frame, so writing camera.position does nothing. It does respect the parent
// (camera.matrixWorld = parent.matrixWorld * camera.matrix), so the rig is what
// we move. Everything about where the visitor is in the bubble lives here.
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

// Shared timer so Spark's time-based work and our locomotion agree on dt.
const timer = new THREE.Timer();

const spark = new SparkRenderer({ renderer, timer });
spark.lodSplatScale = CONFIG.lodScale;
scene.add(spark);

// Spark's LoD worker reads these off the renderer every time it re-traverses,
// and a SplatMesh may override any of them; there is one mesh here, so the
// renderer is the place to set them.
let foveateOn = CONFIG.foveate;

function applyFoveation() {
    // Off means a scale of 1 at every angle, which is Spark's pre-2.0
    // behaviour: one budget spread evenly over the whole sphere. Zeroing the
    // cones as well is belt and braces — the scales alone already flatten it.
    spark.coneFov0 = foveateOn ? CONFIG.coneFov0 : 0;
    spark.coneFov = foveateOn ? CONFIG.coneFov : 0;
    spark.coneFoveate = foveateOn ? CONFIG.coneFoveate : 1;
    spark.behindFoveate = foveateOn ? CONFIG.behindFoveate : 1;
    // The traversal only reruns when the view moves or the budget changes, so
    // a change made while sitting still has to announce itself.
    spark.lodDirty = true;
    spark.setDirty();
}

applyFoveation();

// ---------------------------------------------------------------------------
// The splat scene, rotated upright and scaled to metres
// ---------------------------------------------------------------------------

const UP_VECTORS = {
    "+x": [1, 0, 0],
    "-x": [-1, 0, 0],
    "+y": [0, 1, 0],
    "-y": [0, -1, 0],
    "+z": [0, 0, 1],
    "-z": [0, 0, -1],
};

// Rotation that brings the data's up axis onto world +Y.
function worldOrientation(upAxis) {
    const axis = UP_VECTORS[String(upAxis).toLowerCase()] || UP_VECTORS["-x"];
    return new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(...axis),
        new THREE.Vector3(0, 1, 0),
    );
}

const world = new THREE.Group();
world.quaternion.copy(worldOrientation(CONFIG.upAxis));
scene.add(world);

// Vertical travel limits in metres, filled in once the scene's extent is known.
const limits = { min: 0, max: CONFIG.worldHeight };

const splats = new SplatMesh({
    url: CONFIG.url,
    // Build the level-of-detail tree in a background worker after loading. This
    // is the whole reason for Spark here: the full file is ~3.4M splats and
    // Quest renders a 500k budget selected from it, rather than all of them.
    lod: true,
    onProgress: (event) => {
        if (!event || !event.lengthComputable) return;
        const pct = Math.round((event.loaded / event.total) * 100);
        statusEl.textContent = `Loading bubble… ${pct}%`;
    },
    onLoad: () => {
        fitWorld();
        statusEl.hidden = true;
        hudEl.hidden = false;
    },
});
world.add(splats);

// With lod: true the splat data moves off packedSplats onto its .lodSplats,
// and packedSplats.numSplats reads 0, so check both.
function resolvePackedSplats(mesh) {
    const candidates = [
        mesh.packedSplats,
        mesh.packedSplats && mesh.packedSplats.lodSplats,
    ];
    for (const packed of candidates) {
        if (!packed || typeof packed.getSplat !== "function") continue;
        const count =
            typeof packed.getNumSplats === "function"
                ? packed.getNumSplats()
                : packed.numSplats;
        if (count > 0) return { packed, count };
    }
    return null;
}

// Sample the splat centres to find the scene's extent. Sampling rather than
// walking all of them keeps this to ~20 ms instead of a visible stall.
function measureDataBounds(mesh) {
    const resolved = resolvePackedSplats(mesh);
    if (!resolved) return null;

    const { packed, count } = resolved;
    const box = new THREE.Box3();
    const stride = Math.max(1, Math.floor(count / 50000));
    for (let i = 0; i < count; i += stride) {
        const centre = packed.getSplat(i).center;
        // Merged LoD parents can land on NaN if a node ends up degenerate.
        if (Number.isFinite(centre.x)) box.expandByPoint(centre);
    }
    return box.isEmpty() ? null : box;
}

// Rotate the measured box into world orientation, then scale and offset the
// scene so the column runs from y = 0 up to y = CONFIG.worldHeight.
function fitWorld() {
    const dataBox = measureDataBounds(splats);
    if (!dataBox) {
        console.warn("Could not measure splat bounds; leaving scene unscaled.");
        rig.position.y = CONFIG.worldHeight / 2;
        return;
    }

    const rotation = new THREE.Matrix4().makeRotationFromQuaternion(
        world.quaternion,
    );
    const box = dataBox.clone().applyMatrix4(rotation);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());

    // worldHeight 0 means "leave the capture's own scale alone".
    const scale =
        CONFIG.worldHeight > 0
            ? CONFIG.worldHeight / Math.max(size.y, 1e-6)
            : 1;
    world.scale.setScalar(scale);
    // Position is applied after rotation and scale, so these are world metres.
    world.position.set(-scale * centre.x, -scale * box.min.y, -scale * centre.z);

    const height = size.y * scale;
    limits.min = CONFIG.margin;
    limits.max = Math.max(CONFIG.margin, height - CONFIG.margin);
    rig.position.y = (limits.min + limits.max) / 2;

    console.log(
        `Splat extent (data units): ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}\n` +
            `Scale: 1 data unit = ${scale.toFixed(4)} m\n` +
            `Column: ${height.toFixed(1)} m tall, ${(size.x * scale).toFixed(1)} m wide\n` +
            `Travel: ${limits.min.toFixed(1)} m to ${limits.max.toFixed(1)} m`,
    );
}

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

// Loads alongside the splat rather than after it: the one-shots are small and
// the beds are only streamed on demand, so there is nothing to wait for.
const soundscape = CONFIG.audio
    ? new Soundscape({
          volume: CONFIG.volume,
          spatial: CONFIG.spatial,
          shotInterval: CONFIG.shotInterval,
          falloff: CONFIG.falloff,
      })
    : null;

soundscape?.load().catch((err) => {
    // Silence is better than a dead scene if the audio cannot be fetched.
    console.warn("Soundscape failed to load:", err);
});

// ---------------------------------------------------------------------------
// WebXR
// ---------------------------------------------------------------------------

let inXr = false;

const sparkXr = new SparkXr({
    renderer,
    element: document.body,
    button: true,
    mode: "vr",
    // local-floor puts the origin at floor level, which is what you want when
    // the visitor is lying on the floor rather than standing.
    referenceSpaceType: "local-floor",
    fixedFoveation: CONFIG.foveation,
    frameBufferScaleFactor: isOculus() ? 0.9 : 1,
    onEnterXr: () => {
        inXr = true;
        hudEl.hidden = true;
        hintEl.hidden = true;
        resetRig();
        // An AudioContext stays suspended until a user gesture; the Enter VR
        // click is one.
        soundscape?.resume();
    },
    onExitXr: () => {
        inXr = false;
        hudEl.hidden = false;
        hintEl.hidden = false;
    },
});

// ---------------------------------------------------------------------------
// Gaze-pitch locomotion: look up to rise, look down to sink, level to hold
// ---------------------------------------------------------------------------

const forward = new THREE.Vector3();
let velocity = 0;
let pitchDegrees = 0;

function updateLocomotion(dt) {
    camera.getWorldDirection(forward);

    // Pitch from the view vector, not Euler angles. Lying down puts a lot of
    // roll into the head pose, and roll makes Euler pitch meaningless.
    pitchDegrees = THREE.MathUtils.radToDeg(
        Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)),
    );

    const span = Math.max(CONFIG.fullTilt - CONFIG.deadzone, 1e-3);
    const amount = THREE.MathUtils.clamp(
        (Math.abs(pitchDegrees) - CONFIG.deadzone) / span,
        0,
        1,
    );
    const direction = Math.sign(pitchDegrees) * (CONFIG.invert ? -1 : 1);
    const target =
        direction * Math.pow(amount, CONFIG.curve) * CONFIG.maxSpeed;

    // Ramp towards the target rather than snapping to it. The acceleration cue
    // is the difference between this feeling like drifting and feeling like a
    // lift dropping, and vertical motion is the easy case to get wrong.
    velocity += THREE.MathUtils.clamp(
        target - velocity,
        -CONFIG.accel * dt,
        CONFIG.accel * dt,
    );

    const next = THREE.MathUtils.clamp(
        rig.position.y + velocity * dt,
        limits.min,
        limits.max,
    );
    // Bleed off speed at the ends instead of pressing against the limit.
    if (next === rig.position.y) velocity = 0;
    rig.position.y = next;
}

function resetRig() {
    rig.position.y = (limits.min + limits.max) / 2;
    velocity = 0;
}

// ---------------------------------------------------------------------------
// Desktop rehearsal: mouse look drives the same pitch the headset would
// ---------------------------------------------------------------------------

let yaw = 0;
let desktopPitch = 0;
const desktopEuler = new THREE.Euler(0, 0, 0, "YXZ");

renderer.domElement.addEventListener("click", () => {
    soundscape?.resume();
    if (!inXr && document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock();
    }
});

document.addEventListener("mousemove", (event) => {
    if (inXr || document.pointerLockElement !== renderer.domElement) return;
    const sensitivity = 0.0022;
    yaw -= event.movementX * sensitivity;
    desktopPitch = THREE.MathUtils.clamp(
        desktopPitch - event.movementY * sensitivity,
        -Math.PI / 2 + 0.01,
        Math.PI / 2 - 0.01,
    );
});

window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === "r") resetRig();
    if (key === "h" && !inXr) hudEl.hidden = !hudEl.hidden;
    if (key === "f") {
        foveateOn = !foveateOn;
        applyFoveation();
        console.log(`foveated splats ${foveateOn ? "on" : "off"}`);
    }

    // Arrow keys tilt the view without needing pointer lock, which is the
    // quickest way to rehearse the rise/sink feel at a desk.
    if (inXr) return;
    const step = THREE.MathUtils.degToRad(5);
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        desktopPitch = THREE.MathUtils.clamp(
            desktopPitch + (event.key === "ArrowUp" ? step : -step),
            -Math.PI / 2 + 0.01,
            Math.PI / 2 - 0.01,
        );
    }
});

function applyDesktopLook() {
    desktopEuler.set(desktopPitch, yaw, 0);
    camera.quaternion.setFromEuler(desktopEuler);
    camera.position.set(0, 0, 0);
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

let fps = 0;

renderer.setAnimationLoop(() => {
    timer.update();
    const rawDt = timer.getDelta();
    // Clamp dt so a stall (loading, LoD rebuild) cannot teleport the viewer.
    // The log wants the truth about stalls, so it gets rawDt instead.
    const dt = Math.min(rawDt, 0.1);

    if (!inXr) applyDesktopLook();
    updateLocomotion(dt);
    renderer.render(scene, camera);

    soundscape?.update(rig.position.y, limits, dt);

    if (dt > 0) fps += (1 / dt - fps) * 0.05;
    if (!hudEl.hidden) updateHud();
    logFrameTiming(rawDt);
    updateFoveateAB(rawDt);
});

function updateHud() {
    const depth = limits.max - rig.position.y;
    hudDepthEl.textContent = `${depth.toFixed(1)} m down`;
    hudDetailEl.textContent =
        `pitch   ${pitchDegrees.toFixed(0)}°\n` +
        `speed   ${velocity.toFixed(2)} m/s\n` +
        `height  ${rig.position.y.toFixed(1)} / ${limits.max.toFixed(1)} m\n` +
        `splats  ${(splats.numSplats || 0).toLocaleString()} of 3,391,110\n` +
        `fps     ${fps.toFixed(0)}\n` +
        `foveate ${foveateStatus()}\n` +
        `audio   ${audioStatus()}`;
}

// Periodic frame-timing log, read over the DevTools protocol while the headset
// is on — Quest Browser does NOT forward page console output to logcat, so
// `adb logcat` will not show these. See "Reading the console" in the README.
// A mean on its own hides judder, so the slowest frame of each window goes out
// alongside it: that is the one you actually feel.
let logWindow = 0; // seconds accumulated since the last line
let logFrames = 0;
let logWorstDt = 0;

function logFrameTiming(rawDt) {
    if (CONFIG.fpsLog <= 0) return;

    logWindow += rawDt;
    logFrames += 1;
    if (rawDt > logWorstDt) logWorstDt = rawDt;
    if (logWindow < CONFIG.fpsLog) return;

    console.log(
        `fps ${(logFrames / logWindow).toFixed(1)} | ` +
            `worst ${(logWorstDt * 1000).toFixed(1)} ms | ` +
            `splats ${(splats.numSplats || 0).toLocaleString()} | ` +
            `height ${rig.position.y.toFixed(1)} m | ` +
            `foveate ${foveateOn ? "on" : "off"} | ` +
            `${inXr ? "xr" : "desktop"}`,
    );

    logWindow = 0;
    logFrames = 0;
    logWorstDt = 0;
}

function foveateStatus() {
    if (!foveateOn) return "off (uniform)";
    return (
        `${CONFIG.coneFov0.toFixed(0)}/${CONFIG.coneFov.toFixed(0)}° ` +
        `${CONFIG.coneFoveate}/${CONFIG.behindFoveate}`
    );
}

// Automatic foveated/uniform A/B. Frame rate here depends more on where you
// are in the column than on any render setting, so comparing two runs tells
// you nothing: the only honest comparison interleaves the states while you
// hold still, which is what this does. ?foveateAB=20 flips the switch every
// 20 s and logs each leg's mean alongside the running mean of both states.
// The logged height is the control — if it drifted between legs, discard them.
const AB_WARMUP = 1; // seconds dropped after each flip, while the LoD catches up
const abTotals = { on: { frames: 0, time: 0 }, off: { frames: 0, time: 0 } };
let abElapsed = 0;
let abFrames = 0;
let abTime = 0;

function updateFoveateAB(rawDt) {
    if (CONFIG.foveateAB <= 0) return;

    const wasElapsed = abElapsed;
    abElapsed += rawDt;
    // Frames during the warmup belong to neither state: the flip invalidates
    // the LoD traversal and the first fetches land in the next few frames.
    if (wasElapsed >= AB_WARMUP) {
        abFrames += 1;
        abTime += rawDt;
    }
    if (abElapsed < CONFIG.foveateAB + AB_WARMUP) return;

    const total = foveateOn ? abTotals.on : abTotals.off;
    total.frames += abFrames;
    total.time += abTime;
    const mean = (t) => (t.time > 0 ? (t.frames / t.time).toFixed(1) : "—");

    console.log(
        `A/B ${foveateOn ? "foveated" : "uniform "} | ` +
            `leg ${abTime > 0 ? (abFrames / abTime).toFixed(1) : "—"} fps | ` +
            `means foveated ${mean(abTotals.on)} vs uniform ${mean(abTotals.off)} | ` +
            `splats ${(splats.numSplats || 0).toLocaleString()} | ` +
            `height ${rig.position.y.toFixed(1)} m`,
    );

    abElapsed = 0;
    abFrames = 0;
    abTime = 0;
    foveateOn = !foveateOn;
    applyFoveation();
}

// Which beds are actually audible, for the desktop readout.
function audioStatus() {
    if (!soundscape) return "off";
    if (!soundscape.ready) return "loading";
    if (soundscape.suspended) return "click to start";
    const live = soundscape.zones
        .filter((z) => z.playing)
        .map((z) => `${z.name} ${(z.gain.gain.value * 100).toFixed(0)}%`);
    return live.length ? live.join(", ") : "silent";
}

window.addEventListener("resize", () => {
    if (inXr) return; // the headset owns the framebuffer during a session
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

if (import.meta.env.DEV) {
    // applyFoveation() after poking CONFIG.coneFov0 and friends, so the
    // traversal picks the new numbers up without waiting for the view to move.
    window.__vr = {
        scene, rig, world, splats, spark, sparkXr, CONFIG, limits, soundscape,
        applyFoveation,
        setFoveate: (on) => {
            foveateOn = on;
            applyFoveation();
        },
    };
}
