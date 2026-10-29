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
// ---------------------------------------------------------------------------

export const SCENES = {
    bubble: {
        title: "A Bubble",
        blurb: "Lie down. Look up to rise, look down to sink.",
        url: "data/bubble.ksplat",
        // Measured from the file: the column runs along +Y, 62.8 units tall
        // and ~18 wide, so the data is already Y-up and needs no rotation.
        upAxis: "+y",
        // Scale the capture so its full vertical extent spans this many
        // metres. 0 means "leave the capture's own scale alone".
        worldHeight: 45,
        locomotion: "column",
        audio: true,
        // Only for the HUD's "x of y" line. Omit it and the readout just
        // shows the live count.
        totalSplats: 3391110,
        loading: "Loading bubble…",
        hint:
            "Click to look around · look <strong>up</strong> to rise, " +
            "<strong>down</strong> to sink · <strong>R</strong> resets · " +
            "<strong>H</strong> toggles readout",
    },

    tram: {
        title: "Tram",
        blurb: "Walk around the scan, or fly with the thumbsticks.",
        url: "data/tram.ksplat",
        // A guess until the file is in: most exports land Y-up, but if the
        // tram comes in on its side, measure it and fix it here rather than
        // fighting it with ?upAxis= every time.
        upAxis: "+y",
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
