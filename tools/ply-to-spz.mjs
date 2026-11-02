// Convert a .ply Gaussian splat capture to .spz.
//
//   node tools/ply-to-spz.mjs ~/captures/bubbleWorld_0.ply public/data/bubble.spz
//
// .spz is the published radiance-field format (Niantic's), and the one to
// commit. It beats .ksplat on both counts that matter here:
//
//   bubble  78.0 MB .ksplat, no harmonics -> 54.0 MB .spz with all of them
//   tram    21.0 MB .ksplat               -> 12.9 MB .spz
//
// The bubble is the interesting case. Its source carries 45 f_rest_* fields —
// spherical harmonics, degree 3, the view-dependent colour that makes a
// capture a radiance field rather than a coloured point cloud — and the
// .ksplat path threw every one of them away, because tools/ply-to-ksplat.mjs
// writes shDegree 0. So the .spz is smaller than the file it replaces *and*
// carries more. The tram gains size only: its export has f_dc_* and nothing
// else, so there were never any harmonics there to lose.
//
// Spark writes this format itself, which is the other reason to prefer it:
// no external build to point at, unlike ply-to-ksplat.mjs — which is kept
// only to document how the old files were made, since nothing loads them now.
import * as fs from "node:fs";
import * as path from "node:path";
import { transcodeSpz } from "@sparkjsdev/spark";

const [input, output, shArg, clipArg] = process.argv.slice(2);
if (!input || !output) {
    console.error(
        "usage: node tools/ply-to-spz.mjs <in.ply> <out.spz> [maxSh] " +
            "[xmin,ymin,zmin,xmax,ymax,zmax]",
    );
    process.exit(1);
}

// Harmonic degree to keep. 3 is everything the capture has; 0 writes flat
// diffuse colour and is what .ksplat gave you. Keep all of it in the file and
// turn it down at render time with ?maxSh= — that way testing the cost on the
// headset does not mean reconverting.
const maxSh = shArg === undefined ? 3 : Number(shArg);

// Optional crop, in the capture's own units and axes — before any up-axis
// correction, so read the numbers off the .ply rather than off the viewer.
//
// A training run leaves opaque junk scattered well outside the thing it
// reconstructed, and the viewer measures a scene with a raw min/max, so a
// handful of strays set the scale of everything and drag the centre off.
// Cropping them out at conversion time is the cheap fix: it costs a percent
// or two of splats you did not want anyway. An opacity threshold is the
// wrong lever for this, incidentally — the strays are fully opaque, and
// dropping 20% of the capture by alpha barely moved the bounds.
let clipXyz;
if (clipArg) {
    const n = clipArg.split(",").map(Number);
    if (n.length !== 6 || n.some((v) => !Number.isFinite(v))) {
        console.error("clip box wants six finite numbers: xmin,ymin,zmin,xmax,ymax,zmax");
        process.exit(1);
    }
    clipXyz = { min: n.slice(0, 3), max: n.slice(3) };
}

if (!fs.existsSync(input)) {
    console.error(`No such capture: ${input}`);
    process.exit(1);
}

const fileBytes = new Uint8Array(fs.readFileSync(input));
const { fileBytes: out, clippedCount } = await transcodeSpz({
    inputs: [{ fileBytes, pathOrUrl: input }],
    maxSh,
    ...(clipXyz ? { clipXyz } : {}),
});

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, out);

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
console.log(
    `${path.basename(input)} ${mb(fileBytes.length)} -> ` +
        `${path.basename(output)} ${mb(out.length)} (maxSh ${maxSh})`,
);
if (clippedCount) console.log(`clipped ${clippedCount} splats`);
