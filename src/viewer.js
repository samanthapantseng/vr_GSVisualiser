import * as THREE from "three";
import { SparkRenderer, SplatMesh, SparkXr, isOculus } from "@sparkjsdev/spark";
import { Soundscape } from "./soundscape.js";
import { createLoadingWheel } from "./loader.js";
import { createLocomotion } from "./locomotion.js";

// ---------------------------------------------------------------------------
// The viewer. One scene at a time, handed in from src/main.js.
//
// Tunables come from the scene entry first and the query string second, so
// ?scene=bubble&maxSpeed=2.4 still recalibrates from inside the headset
// without a rebuild — the defaults are just per scene now.
// ---------------------------------------------------------------------------

export function startViewer(scene) {
    const params = new URLSearchParams(location.search);

    function num(name, fallback) {
        const value = parseFloat(params.get(name));
        return Number.isFinite(value) ? value : fallback;
    }

    function flag(name, fallback) {
        const value = params.get(name);
        if (value === null) return fallback;
        return value !== "0";
    }

    const CONFIG = {
        // Per scene (src/scenes.js), overridable per load.
        url: params.get("url") || scene.url,
        // Which axis of the splat data points up. WebXR pins world up to +Y
        // and will not let you override it, so a capture that comes in tilted
        // gets rotated here rather than at the camera: ?upAxis=-x and so on.
        upAxis: params.get("upAxis") || scene.upAxis || "+y",
        // Yaw in degrees, applied after the up-axis correction. A capture
        // almost never arrives facing the way you want it.
        heading: num("heading", scene.heading ?? 0),
        // The capture is scaled so its full vertical extent spans this many
        // metres. 0 skips rescaling and treats 1 data unit as 1 metre.
        worldHeight: num("worldHeight", scene.worldHeight ?? 0),

        // Gaze-pitch locomotion (the column).
        maxSpeed: num("maxSpeed", scene.maxSpeed ?? 0.8), // m/s at full tilt
        accel: num("accel", scene.accel ?? 0.9), // m/s^2 ramp, both modes
        deadzone: num("deadzone", 18), // degrees of pitch that still count as "hold"
        fullTilt: num("fullTilt", 62), // degrees of pitch for full speed
        curve: num("curve", 1.6), // > 1 softens the onset
        invert: params.get("invert") === "1",
        // Keep the rig this far inside the column so you never drift out of
        // the splats.
        margin: num("margin", scene.margin ?? 2),

        // Stick locomotion (freefly).
        moveSpeed: num("moveSpeed", scene.moveSpeed ?? 1.5), // m/s at full push
        // How far outside the capture's own bounds you may fly before being
        // held. Enough to back off and see the whole thing, not enough to get
        // lost in the void.
        roam: num("roam", scene.roam ?? 6),

        // Render budget. lodScale multiplies Spark's per-platform splat
        // budget, which is 500k on Quest; foveation blurs the periphery, which
        // splats barely show and the fragment cost very much does.
        lodScale: num("lodScale", scene.lodScale ?? 1),
        foveation: num("foveation", scene.foveation ?? 0.75),
        // Spherical-harmonic degree to render. The .spz files carry degree 3 —
        // the view-dependent colour .ksplat dropped — and evaluating 45 extra
        // coefficients per splat is not free on Quest. ?maxSh=1 or ?maxSh=0
        // measures what it costs without reconverting the capture.
        maxSh: num("maxSh", scene.maxSh ?? 3),
        // Seconds between frame-timing lines on the console. The HUD is DOM
        // and so is invisible inside an XR session, which makes this the only
        // way to read frame timing while the headset is actually on.
        fpsLog: num("fpsLog", 1),

        // Sound. Only the bubble has a soundscape; see src/soundscape.js.
        audio: scene.audio === true && flag("audio", true),
        volume: num("volume", 0.9),
        spatial: flag("spatial", true),
        shotInterval: num("shotInterval", 9),
        falloff: num("falloff", 1),
    };

    const statusEl = document.getElementById("status");
    const hudEl = document.getElementById("hud");
    const hudDepthEl = document.getElementById("hudDepth");
    const hudDetailEl = document.getElementById("hudDetail");
    const hintEl = document.getElementById("hint");

    document.title = `${scene.title} — VR`;

    // Up before anything is fetched, so tapping a card in the picker gets an
    // answer on the same frame rather than a black screen for a few seconds.
    const loadingLabel = scene.loading || `Loading ${scene.title}…`;
    const wheel = createLoadingWheel(statusEl);
    wheel.progress(0, loadingLabel);

    hintEl.innerHTML = scene.hint || "";
    hintEl.hidden = false;

    // -----------------------------------------------------------------------
    // Renderer, scene, and the rig that locomotion actually drives
    // -----------------------------------------------------------------------

    // antialias must be off: WebGL MSAA does nothing for Gaussian splats and
    // costs a lot of fill rate, which is the budget that matters in stereo.
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ antialias: false });
    } catch (err) {
        // No context, no scene — and the wheel would otherwise sit at 0% for
        // ever with nothing to say. A browser blocks this after a page has
        // cycled through too many reloads; a fresh tab clears it.
        console.error("WebGL unavailable:", err);
        wheel.fail(`Could not start the viewer — ${err.message || err}`);
        return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById("app").appendChild(renderer.domElement);

    const world3 = new THREE.Scene();
    world3.background = new THREE.Color(0x03121c);

    const camera = new THREE.PerspectiveCamera(
        70,
        window.innerWidth / window.innerHeight,
        0.1,
        1000,
    );

    // In an XR session three.js overwrites camera.matrix from the headset pose
    // every frame, so writing camera.position does nothing. It does respect
    // the parent (camera.matrixWorld = parent.matrixWorld * camera.matrix), so
    // the rig is what we move. Everything about where the visitor is lives here.
    const rig = new THREE.Group();
    rig.add(camera);
    world3.add(rig);

    // Shared timer so Spark's time-based work and our locomotion agree on dt.
    const timer = new THREE.Timer();

    const spark = new SparkRenderer({ renderer, timer });
    spark.lodSplatScale = CONFIG.lodScale;
    world3.add(spark);

    // -----------------------------------------------------------------------
    // The splat scene, rotated upright and scaled to metres
    // -----------------------------------------------------------------------

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
        const axis = UP_VECTORS[String(upAxis).toLowerCase()] || UP_VECTORS["+y"];
        return new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(...axis),
            new THREE.Vector3(0, 1, 0),
        );
    }

    const world = new THREE.Group();
    {
        const orientation = worldOrientation(CONFIG.upAxis);
        if (CONFIG.heading) {
            // premultiply, not multiply: the yaw is about world up, and has to
            // happen after the data has been stood upright, not before.
            orientation.premultiply(
                new THREE.Quaternion().setFromAxisAngle(
                    new THREE.Vector3(0, 1, 0),
                    THREE.MathUtils.degToRad(CONFIG.heading),
                ),
            );
        }
        world.quaternion.copy(orientation);
    }
    world3.add(world);

    // Where the visitor may go, in world metres, filled in once the capture's
    // extent is known. min/max are the column's vertical limits; box is the
    // whole thing, which freefly clamps against. Locomotion holds this by
    // reference, because it is empty until the file has loaded.
    const bounds = {
        box: new THREE.Box3(),
        min: 0,
        max: CONFIG.worldHeight || 1,
    };

    const locomotion = createLocomotion(scene.locomotion, {
        camera,
        rig,
        renderer,
        bounds,
        config: CONFIG,
    });

    const splats = new SplatMesh({
        url: CONFIG.url,
        // Build the level-of-detail tree in a background worker after loading.
        // This is the whole reason for Spark here: a capture can be millions of
        // splats and Quest renders a 500k budget selected from it, rather than
        // all of them.
        lod: true,
        onProgress: (event) => {
            // No Content-Length (a proxy that re-encodes the response, say)
            // means no percentage to show; the wheel sweeps instead.
            if (!event || !event.lengthComputable || !event.total) {
                wheel.spin(loadingLabel);
                return;
            }
            const pct = (event.loaded / event.total) * 100;
            if (pct >= 100) {
                // The last byte is not the last of the wait: the LoD tree is
                // built in a worker after this, and on a three-million-splat
                // capture that is seconds more with nothing to count.
                wheel.spin("Building detail levels…");
            } else {
                wheel.progress(pct, loadingLabel);
            }
        },
        onLoad: () => {
            // fitWorld samples 50k centres on the main thread, so the wheel
            // comes down after it, not before — nothing paints in between.
            fitWorld();
            wheel.done();
            hudEl.hidden = false;
        },
    });
    world.add(splats);

    // maxSh is a field on the mesh rather than a constructor option; set here,
    // it is in place before the loaded data builds its generator.
    splats.maxSh = CONFIG.maxSh;

    // A scene listed in the table whose file is not in public/data/ yet should
    // say so, rather than sitting on "Loading…" for ever.
    splats.initialized?.catch((err) => {
        console.error("Splat load failed:", err);
        wheel.fail(`Could not load ${CONFIG.url} — ${err.message || err}`);
    });

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
        const xs = [];
        const zs = [];
        const stride = Math.max(1, Math.floor(count / 50000));
        for (let i = 0; i < count; i += stride) {
            const centre = packed.getSplat(i).center;
            // Merged LoD parents can land on NaN if a node ends up degenerate.
            if (!Number.isFinite(centre.x)) continue;
            box.expandByPoint(centre);
            xs.push(centre.x);
            zs.push(centre.z);
        }
        if (box.isEmpty()) return null;

        // Two different answers to "where is the capture", and they are not
        // interchangeable. The box is a raw min/max, so it describes the
        // extremes and a single stray splat moves it; `axis` is the median of
        // the sampled centres, so it describes the bulk and strays cannot
        // shift it. Height and scale want the extremes. Where the visitor
        // stands wants the bulk — the bubble's capture reaches 11 units one
        // way and 7 the other, so its box centre sits about a metre off the
        // column it is supposed to be the middle of.
        const median = (values) => {
            values.sort((a, b) => a - b);
            return values[values.length >> 1];
        };
        return { box, axis: new THREE.Vector3(median(xs), 0, median(zs)) };
    }

    // Rotate the measured box into world orientation, then scale and offset the
    // capture so it sits with its floor at y = 0.
    function fitWorld() {
        const measured = measureDataBounds(splats);
        if (!measured) {
            console.warn("Could not measure splat bounds; leaving scene unscaled.");
            locomotion.reset();
            return;
        }
        const { box: dataBox, axis: dataAxis } = measured;

        const rotation = new THREE.Matrix4().makeRotationFromQuaternion(
            world.quaternion,
        );
        const box = dataBox.clone().applyMatrix4(rotation);
        const size = box.getSize(new THREE.Vector3());
        // Rotated the same way as the box, so its x and z are world-oriented.
        // Only those two are read: the vertical placement comes off box.min.y,
        // because the floor is an extreme and not a median.
        const centre = dataAxis.clone().applyMatrix4(rotation);

        // worldHeight 0 means "leave the capture's own scale alone".
        const scale =
            CONFIG.worldHeight > 0
                ? CONFIG.worldHeight / Math.max(size.y, 1e-6)
                : 1;
        world.scale.setScalar(scale);
        // Position is applied after rotation and scale, so these are world metres.
        world.position.set(
            -scale * centre.x,
            -scale * box.min.y,
            -scale * centre.z,
        );

        // Read the final placement back off the transform rather than
        // recomputing it, so the two can never disagree.
        world.updateMatrixWorld(true);
        bounds.box.copy(dataBox).applyMatrix4(world.matrixWorld);

        const height = size.y * scale;
        bounds.min = CONFIG.margin;
        bounds.max = Math.max(CONFIG.margin, height - CONFIG.margin);
        locomotion.reset();

        console.log(
            `Splat extent (data units): ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}\n` +
                `Scale: 1 data unit = ${scale.toFixed(4)} m\n` +
                `World: ${height.toFixed(1)} m tall, ${(size.x * scale).toFixed(1)} m wide\n` +
                `Mode: ${scene.locomotion}`,
        );
    }

    // -----------------------------------------------------------------------
    // Sound
    // -----------------------------------------------------------------------

    // Loads alongside the splat rather than after it: the one-shots are small
    // and the beds are only streamed on demand, so there is nothing to wait for.
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

    // -----------------------------------------------------------------------
    // WebXR
    // -----------------------------------------------------------------------

    let inXr = false;

    const sparkXr = new SparkXr({
        renderer,
        element: document.body,
        button: true,
        mode: "vr",
        // local-floor puts the origin at floor level, which is what you want
        // whether the visitor is lying on the floor or walking around a scan.
        referenceSpaceType: "local-floor",
        fixedFoveation: CONFIG.foveation,
        frameBufferScaleFactor: isOculus() ? 0.9 : 1,
        onEnterXr: () => {
            inXr = true;
            hudEl.hidden = true;
            hintEl.hidden = true;
            locomotion.reset();
            // An AudioContext stays suspended until a user gesture; the Enter
            // VR click is one.
            soundscape?.resume();
        },
        onExitXr: () => {
            inXr = false;
            hudEl.hidden = false;
            hintEl.hidden = false;
        },
    });

    // -----------------------------------------------------------------------
    // Desktop rehearsal: mouse look drives the same view the headset would
    // -----------------------------------------------------------------------

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
        if (key === "r") locomotion.reset();
        if (key === "h" && !inXr) hudEl.hidden = !hudEl.hidden;

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
        camera.position.set(0, locomotion.desktopEyeHeight || 0, 0);
    }

    // -----------------------------------------------------------------------
    // Loop
    // -----------------------------------------------------------------------

    let fps = 0;

    renderer.setAnimationLoop(() => {
        timer.update();
        const rawDt = timer.getDelta();
        // Clamp dt so a stall (loading, LoD rebuild) cannot teleport the
        // viewer. The log wants the truth about stalls, so it gets rawDt.
        const dt = Math.min(rawDt, 0.1);

        if (!inXr) applyDesktopLook();
        locomotion.update(dt);
        renderer.render(world3, camera);

        soundscape?.update(rig.position.y, bounds, dt);

        if (dt > 0) fps += (1 / dt - fps) * 0.05;
        if (!hudEl.hidden) updateHud();
        logFrameTiming(rawDt);
    });

    function splatCount() {
        const live = (splats.numSplats || 0).toLocaleString();
        return scene.totalSplats
            ? `${live} of ${scene.totalSplats.toLocaleString()}`
            : live;
    }

    function updateHud() {
        const { headline, detail } = locomotion.readout();
        hudDepthEl.textContent = headline;
        hudDetailEl.textContent =
            `${detail}\n` +
            `splats  ${splatCount()}\n` +
            `fps     ${fps.toFixed(0)}\n` +
            `audio   ${audioStatus()}`;
    }

    // Periodic frame-timing log, read over the DevTools protocol while the
    // headset is on — Quest Browser does NOT forward page console output to
    // logcat, so `adb logcat` will not show these. See "Reading the console"
    // in the README. A mean on its own hides judder, so the slowest frame of
    // each window goes out alongside it: that is the one you actually feel.
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
                `${inXr ? "xr" : "desktop"}`,
        );

        logWindow = 0;
        logFrames = 0;
        logWorstDt = 0;
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
        window.__vr = {
            scene,
            // Lets the loading screen be posed at a desk without throttling
            // the network: __vr.wheel.progress(42) and so on.
            wheel,
            world3,
            rig,
            world,
            splats,
            spark,
            sparkXr,
            locomotion,
            CONFIG,
            bounds,
            soundscape,
        };
    }
}
