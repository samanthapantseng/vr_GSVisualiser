// Convert a .ply Gaussian splat capture to .ksplat.
//
//   node tools/ply-to-ksplat.mjs public/data/tram.ply public/data/tram.ksplat
//
// Spark reads .ply directly, so this is purely about weight: a .ply carries 56
// uncompressed bytes per splat, a .ksplat 24. The tram went 48.9 MB -> 21.0 MB
// with the geometry unchanged to within 2 cm. Worth doing before committing a
// capture, because git keeps every version of a binary for ever.
//
// The writer lives in mkkellogg's gaussian-splats-3d, whose npm package does
// not ship its util/create-ksplat.js, so this drives the same classes out of
// the installed browser build. Point GS3D_BUILD at that build if it moves.
import * as fs from "node:fs";
import * as path from "node:path";

const LIB =
    process.env.GS3D_BUILD ||
    "/Users/samanthapan/Documents/Ecological Interaction/ThreeJS_Gaussian_Splat/" +
        "ThreeJS_Visualizer/node_modules/@mkkellogg/gaussian-splats-3d/build/" +
        "gaussian-splats-3d.module.js";

const [input, output, levelArg] = process.argv.slice(2);
if (!input || !output) {
    console.error(
        "usage: node tools/ply-to-ksplat.mjs <in.ply> <out.ksplat> [compressionLevel]",
    );
    process.exit(1);
}

// 1 is half precision, and what bubble.ksplat uses. 2 only buys anything on
// captures that carry spherical harmonics; without them it writes the same 24
// bytes per splat.
const compressionLevel = levelArg === undefined ? 1 : Number(levelArg);
const minimumAlpha = 1; // drop fully transparent splats
const shDegree = 0;

if (!fs.existsSync(LIB)) {
    console.error(`Cannot find the gaussian-splats-3d build at:\n  ${LIB}\nSet GS3D_BUILD to its path.`);
    process.exit(1);
}

// The build is a browser bundle and reaches for window.setTimeout inside its
// own delayedExecute(). Nothing else of the DOM is touched on this path, so a
// one-line shim is enough to run the parser headless.
globalThis.window ??= globalThis;
globalThis.self ??= globalThis;

const GS = await import(LIB);

const bytes = fs.readFileSync(path.resolve(input));
// Node's Buffer is a view into a pooled ArrayBuffer, so hand over a copy that
// starts at byte 0 — the parser reads the PLY header from offset 0.
const fileData = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
);

console.log(`in   ${input} (${(bytes.length / 1e6).toFixed(1)} MB)`);

const splatBuffer = await GS.PlyLoader.loadFromFileData(
    fileData,
    minimumAlpha,
    compressionLevel,
    true,
    shDegree,
);

const out = Buffer.from(splatBuffer.bufferData);
fs.writeFileSync(path.resolve(output), out);

const count = splatBuffer.getSplatCount();
console.log(
    `out  ${output} (${(out.length / 1e6).toFixed(1)} MB)\n` +
        `splats ${count.toLocaleString()} | level ${compressionLevel} | ` +
        `${(out.length / count).toFixed(1)} bytes/splat`,
);
