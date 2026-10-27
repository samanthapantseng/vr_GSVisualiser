import manifest from "./soundscape.json";

// ---------------------------------------------------------------------------
// The Pd soundscape, ported to Web Audio.
//
// Five zone beds run continuously and crossfade by gain as the visitor
// descends — nothing is switched on and off, which is how bubble.pd behaves:
// all five environment_* abstractions are always live and only their gains
// move. Each bed is also lowpassed, with the cutoff falling as you go deeper.
//
// Beds are *not* spatialised: bubble.pd sums them straight to dac~ and never
// instantiates binauralModeled-ircam. One-shots *are* — each random_noise_*
// does instantiate it, placing its source randomly inside a ±5 box. That is
// what the min_x/max_y parameters in environment_*.pd are for, and HRTF
// panning is the Web Audio equivalent.
//
// Beds stream rather than decode. An 8.6-minute 48 kHz stereo bed is ~198 MB
// of Float32 once decoded, and two of those alongside 500k splats will take
// the headset down. Streaming holds a few seconds of buffer instead, which is
// also exactly what readsf~ was doing in Pd.
// ---------------------------------------------------------------------------

// Every zone shares the same one-shot placement box, measured from the
// min_x/max_x/min_y/max_y sliders: ±5 on both axes.
const BOX = 5;

// Below this a bed is inaudible, so it gets paused — five concurrent streams
// cost bandwidth and decode time the headset would rather spend on splats.
const AUDIBLE = 0.012;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

export class Soundscape {
    constructor({ volume = 0.9, spatial = true, shotInterval = 9, falloff = 1 } = {}) {
        this.spatial = spatial;
        this.shotInterval = shotInterval;
        this.falloff = falloff;
        this.ready = false;
        this.zones = [];
        this.submergeBuffer = null;
        this.lastZ = null;

        this.ctx = new AudioContext({ latencyHint: "playback" });
        this.master = this.ctx.createGain();
        this.master.gain.value = volume;

        // The zones are summed without normalising, as bubble.pd sums them to
        // dac~, so the total swings with depth: measured 0.41 at the bottom of
        // the column against 1.71 at -5 m, where below and floor both peak
        // because they share a centre. Anything over 1.0 clips hard at the
        // destination, so a limiter sits in front of it. Pd would have clipped
        // too; the difference is that there you would hear it and pull a
        // fader, and here nobody is at the desk.
        this.limiter = this.ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -3;
        this.limiter.knee.value = 6;
        this.limiter.ratio.value = 12;
        this.limiter.attack.value = 0.005;
        this.limiter.release.value = 0.25;

        this.master.connect(this.limiter);
        this.limiter.connect(this.ctx.destination);
    }

    // Decoding the short one-shots up front is what lets them fire instantly;
    // a streamed trigger would buffer audibly late.
    async load(base = "audio/") {
        const decode = async (url) => {
            const res = await fetch(base + url);
            if (!res.ok) throw new Error(`${url}: ${res.status}`);
            return this.ctx.decodeAudioData(await res.arrayBuffer());
        };

        this.zones = manifest.zones.map((z) => {
            const el = new Audio();
            el.src = base + z.bed.url;
            el.loop = true;
            el.preload = "none"; // nothing is fetched until the zone is audible
            const node = this.ctx.createMediaElementSource(el);

            const filter = this.ctx.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.value = manifest.cutoffHz.max;
            filter.Q.value = 0.7;

            const gain = this.ctx.createGain();
            gain.gain.value = 0;

            node.connect(filter);
            filter.connect(gain);
            gain.connect(this.master);

            return { ...z, el, filter, gain, buffers: [], playing: false, nextShot: 0 };
        });

        const jobs = [];
        for (const zone of this.zones) {
            for (const shot of zone.oneShots) {
                jobs.push(
                    decode(shot.url)
                        .then((buf) => zone.buffers.push(buf))
                        // A missing one-shot should thin the pool, not kill the
                        // whole soundscape.
                        .catch((err) => console.warn("one-shot failed:", err.message)),
                );
            }
        }
        jobs.push(
            decode(manifest.submerge.url)
                .then((buf) => (this.submergeBuffer = buf))
                .catch((err) => console.warn("submerge failed:", err.message)),
        );
        await Promise.all(jobs);

        this.ready = true;
        const shots = this.zones.reduce((n, z) => n + z.buffers.length, 0);
        console.log(`Soundscape: ${this.zones.length} beds, ${shots} one-shots decoded`);
    }

    // An AudioContext starts suspended until a user gesture. The Enter VR
    // click counts, so this is called from onEnterXr as well as on a tap.
    resume() {
        if (this.ctx.state === "suspended") this.ctx.resume();
    }

    get suspended() {
        return this.ctx.state === "suspended";
    }

    // Map metres of rig height onto Pd's z axis, which runs -10 (deep) to 6.
    heightToZ(y, limits) {
        const t = clamp((y - limits.min) / Math.max(limits.max - limits.min, 1e-6), 0, 1);
        return lerp(manifest.zAxis.min, manifest.zAxis.max, t);
    }

    update(y, limits, dt) {
        if (!this.ready || this.suspended) return;

        const z = this.heightToZ(y, limits);
        const now = this.ctx.currentTime;

        // One global cutoff sweep: deeper is more muffled, which is what the
        // lop~ cutoff mapping in each zone patch does.
        const depth = clamp(
            (z - manifest.zAxis.min) / (manifest.zAxis.max - manifest.zAxis.min),
            0,
            1,
        );
        const cutoff = lerp(manifest.cutoffHz.min, manifest.cutoffHz.max, depth);

        for (const zone of this.zones) {
            // Inverse-square falloff from the zone centre, as in
            // environment_*.pd: min(1 / (1 + d)^2, 1) — but with the distance
            // normalised by the zone's own half-width.
            //
            // Taking d in raw z units, the way the patch's expr does before
            // its radius term, makes every zone nearly silent: `below` spans
            // -10..0 yet reads 3% at z = -9.6, which is inside its own range,
            // because d = 4.6 there. Dividing by the half-width puts the edge
            // of each zone at a consistent 25% instead. The patch's radius
            // parameter is doing this job in Pd; its value was not something I
            // could read off the sliders, so ?falloff= stands in for it.
            const half = Math.max((zone.maxZ - zone.minZ) / 2, 1e-6);
            const d = (Math.abs(z - zone.centre) / half) * this.falloff;
            const g = clamp(1 / Math.pow(1 + d, 2), 0, 1);

            // Ramp rather than jump: setValueAtTime on a moving gain clicks.
            zone.gain.gain.setTargetAtTime(g, now, 0.12);
            zone.filter.frequency.setTargetAtTime(cutoff, now, 0.2);

            if (g >= AUDIBLE && !zone.playing) {
                zone.el.preload = "auto";
                zone.el.play().catch(() => {}); // a refused play is not fatal
                zone.playing = true;
            } else if (g < AUDIBLE && zone.playing) {
                zone.el.pause();
                zone.playing = false;
            }

            if (zone.playing) this.maybeFireShot(zone, g, now);
        }

        this.maybeSubmerge(z, now);
        this.lastZ = z;
    }

    // Sparse random one-shots, standing in for the eight random_noise_*
    // instances per zone. Firing rate scales with zone gain so a zone you are
    // only at the edge of stays sparse. The interval itself is a guess — the
    // Pd timing lives in slider positions I could not read off confidently —
    // so it is exposed as ?shotInterval= to be set by ear.
    maybeFireShot(zone, g, now) {
        if (!zone.buffers.length) return;
        if (now < zone.nextShot) return;
        if (zone.nextShot === 0) {
            zone.nextShot = now + Math.random() * this.shotInterval;
            return;
        }

        const buf = zone.buffers[(Math.random() * zone.buffers.length) | 0];
        const src = this.ctx.createBufferSource();
        src.buffer = buf;

        let tail = this.master;
        if (this.spatial) {
            const panner = this.ctx.createPanner();
            panner.panningModel = "HRTF";
            panner.distanceModel = "inverse";
            panner.refDistance = 1;
            panner.positionX.value = (Math.random() * 2 - 1) * BOX;
            panner.positionY.value = (Math.random() * 2 - 1) * BOX;
            panner.positionZ.value = (Math.random() * 2 - 1) * BOX;
            panner.connect(this.master);
            tail = panner;
        }

        const shotGain = this.ctx.createGain();
        shotGain.gain.value = g;
        src.connect(shotGain);
        shotGain.connect(tail);
        src.start(now);

        // Rate follows gain, with a floor so a faint zone still ticks over.
        const rate = Math.max(g, 0.15);
        zone.nextShot = now + (this.shotInterval / rate) * (0.5 + Math.random());
    }

    // bubble.pd fires submerge.wav on a threshold crossing. Its own test reads
    // 0.18 off a signal I could not trace to z with confidence, so this uses
    // the musically obvious event instead: crossing the water surface at z = 0,
    // downwards only.
    maybeSubmerge(z, now) {
        if (!this.submergeBuffer || this.lastZ === null) return;
        if (!(this.lastZ > 0 && z <= 0)) return;

        const src = this.ctx.createBufferSource();
        src.buffer = this.submergeBuffer;
        src.connect(this.master);
        src.start(now);
        console.log("Soundscape: submerge");
    }

    dispose() {
        for (const zone of this.zones) {
            zone.el.pause();
            zone.el.src = "";
        }
        this.ctx.close();
    }
}
