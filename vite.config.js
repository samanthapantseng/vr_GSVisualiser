import { defineConfig } from "vite";

export default defineConfig({
    // Served from the repo subpath on GitHub Pages; harmless locally.
    base: "./",
    server: {
        // Listen on every interface so the Quest can reach the dev server over
        // the LAN. For WebXR you still want `adb reverse` (see README) because
        // a bare LAN IP is not a secure context.
        host: true,
        port: 5174,
    },
    // public/data/bubble.ksplat is a symlink into ThreeJS_Visualizer so the
    // 81 MB file is not duplicated in git.
    resolve: { preserveSymlinks: false },
});
