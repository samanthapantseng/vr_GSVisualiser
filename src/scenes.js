// ---------------------------------------------------------------------------
// One entry per capture.
//
// Everything in this table is a fact about a particular scan — where its file
// is, which way is up, how big it should be, how you move through it. Nothing
// in src/viewer.js mentions a bubble or a tram; it reads these.
//
// Query-string overrides still win over anything here, so recalibrating from
// inside the headset (?scene=tram&moveSpeed=3) works as it always did, now
// per scene. Adding a scan is an entry in this object and a file in
// public/data/ — no new page, no second build.
//
// The captures are .spz, the published radiance-field format: smaller than the
// .ksplat files they replaced, and in the bubble's case carrying the spherical
// harmonics that .ksplat discarded. See tools/ply-to-spz.mjs. The .ksplat
// files themselves are gone from the deploy; README.md says how to fetch one
// back out of history if a showing ever needs the old file.
// ---------------------------------------------------------------------------

export const SCENES = {
    bubble: {
        title: "A Bubble",
        blurb: "Lie down. Look up to rise, look down to sink.",
        url: "data/bubble.spz",
        // Y-down, the usual INRIA/COLMAP convention: the raw centres run
        // y +1.0 down to -51.0. This said "+y" for as long as the scene was a
        // .ksplat, and was right then — mkkellogg's converter stands the
        // capture up as it writes, so the .ksplat was Y-up even though the
        // .ply it came from was not. .spz keeps the capture's own axes, so the
        // correction belongs here now. As with the tram, measuring cannot tell
        // you this; the only check that catches it is looking at the thing.
        //
        // Standing -Y up is a 180° rotation about Z, so the interior arrives
        // yawed half a turn from where the .ksplat put it. Nothing to fix —
        // the visitor looks around freely — but ?heading= aims it if you want
        // a particular facing on entry.
        upAxis: "-y",
        // Scale the capture so its full vertical extent spans this many
        // metres. 0 means "leave the capture's own scale alone".
        worldHeight: 45,
        locomotion: "column",
        audio: true,
        // Only for the HUD's "x of y" line. Omit it and the readout just
        // shows the live count.
        // bubbleWorld_0.ply's own count. The old bubble.ksplat reported
        // 3,391,110, so it was written from a different export of this scan —
        // 136k splats adrift, not a conversion loss. If the .ply behind that
        // .ksplat ever turns up, reconvert from it and correct this.
        totalSplats: 3255251,
        loading: "Loading bubble…",
        hint:
            "Click to look around · look <strong>up</strong> to rise, " +
            "<strong>down</strong> to sink · <strong>R</strong> resets · " +
            "<strong>H</strong> toggles readout",
    },

    tram: {
        title: "Tram",
        blurb: "Walk around the scan, or fly with the thumbsticks.",
        url: "data/tram.spz",
        // Y-down, the usual INRIA/COLMAP convention: the raw centres run
        // y -3.15 to 0.36. Note that measuring the extent cannot tell you
        // this — a Y-up and a Y-down capture have identical bounds, because
        // fitWorld drops whichever end is lowest to y = 0. The only check
        // that catches it is looking at the thing in the headset.
        upAxis: "-y",
        // Degrees of yaw applied after the up-axis correction. Turning -Y onto
        // +Y is a 180° roll about the long axis, which lands the tram upright
        // but facing whichever way that leaves it; this aims it. Find the
        // value live with ?heading=, then bake it in here.
        heading: 0,
        // A vehicle wants its own metres. Rescaling it to a 45 m column would
        // make a tram you could stand inside the roof of.
        worldHeight: 0,
        locomotion: "freefly",
        audio: false,
        loading: "Loading tram…",
        hint:
            "Click to look around · <strong>WASD</strong> moves, " +
            "<strong>Q</strong>/<strong>E</strong> rise and sink · " +
            "<strong>R</strong> resets · <strong>H</strong> toggles readout",
    },
};

// What the bare URL used to show, and what ?scene= falls back to when it names
// something that is not in the table. The picker is what the bare URL shows
// now; this is only the fallback.
export const FALLBACK_SCENE = "bubble";
