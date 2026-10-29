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
    // Captures live in public/data/ and are committed, not symlinked: an 81 MB
    // bubble.ksplat is already close to GitHub's 100 MB per-file ceiling, so
    // check the size of anything new before adding it.
    resolve: { preserveSymlinks: false },
});
