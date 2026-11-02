# vr_GSVisualiser

A standalone Meta Quest 3 viewer for Gaussian splat scans. Each scan is a
**scene**: an entry in [`src/scenes.js`](src/scenes.js) naming its file, how big
it should be and how you move through it. A bare URL shows a picker; a URL that
names a scene goes straight in.

**A Bubble** is the piece the viewer was built for. The visitor lies down and
steers with their head: **look up to float up, look down to sink, look level to
hold.** No controllers, nothing to hold, no buttons.

**Tram** is a scan with no interaction of its own yet, so it gets the
general-purpose `freefly` mode: walk around it in roomscale, or use the
thumbsticks to move, rise and snap-turn.

Built on [Spark](https://sparkjs.dev) for three.js, because it does
level-of-detail: it renders a budget of splats selected per frame by
screen-space size rather than keeping the whole scene resident. On Quest that
budget is 500,000, chosen out of the 3,255,251 splats in `bubble.spz`. That
is what makes a scene this size run on mobile hardware at all.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5174 and pick a scene, or skip the picker with
`?scene=bubble`. On a desktop you can rehearse the whole interaction: click to
capture the mouse and look around, or use the **arrow keys** to tilt. In
`freefly` scenes **WASD** moves and **Q**/**E** rise and sink. **R** resets,
**H** toggles the readout.

## Get it on the Quest 3

The piece is deployed and runs standalone. No cable, no dev server, no computer
in the room:

**https://samanthapantseng.github.io/vr_GSVisualiser/**

Open that in Quest Browser, tap a scene, and press **Enter VR** once it has
loaded. WebXR requires a secure context, and the HTTPS URL supplies it — that is
the whole reason this works untethered. The first load pulls about 56 MB, so
allow a moment on slow wifi.

Bookmark `…/?scene=bubble` to land in a scene directly and skip the picker.
Worth doing before a showing: typing a query string on the headset's floating
keyboard is miserable, and a bookmark is one tap.

Every push to `main` rebuilds and redeploys through
`.github/workflows/deploy-pages.yml`. The Vite build takes under a second; the
artifact upload is the slow part, usually a couple of minutes end to end.

### Putting unpushed work on the headset

For changes that are not deployed yet, tether over USB. A bare LAN address
(`http://192.168.x.x:5174`) is not a secure context and will not offer Enter VR,
but `localhost` on the headset counts as secure and needs no certificates:

```bash
brew install android-platform-tools
```

1. Enable Developer Mode for the headset in the Meta Horizon phone app.
2. Plug in the USB-C cable and accept the "Allow USB debugging" prompt inside
   the headset.
3. Forward the dev server:

```bash
adb reverse tcp:5174 tcp:5174
```

4. Open `http://localhost:5174` in Quest Browser.

`adb reverse` has to be re-run after the headset reboots or the cable is
replugged.

## Reading the console from the headset

Quest Browser does not forward page `console.log` to logcat, so `adb logcat`
shows nothing from the piece. Use Chrome's remote debugging instead, which works
while an XR session is running and against either origin — the dev server or the
deployed URL. It needs the USB cable even when the page came over wifi:

```bash
adb forward tcp:9222 localabstract:chrome_devtools_remote
```

Then open `chrome://inspect` in desktop Chrome and click **inspect** under
`A Bubble — VR`, or query it without a browser:

```bash
curl -s http://localhost:9222/json/list
```

The page target's `webSocketDebuggerUrl` carries the `fpsLog` lines. `window.__vr`
is exposed in dev builds, so `Runtime.evaluate` can also read `rig.position.y`,
`bounds` and the live splat count mid-session.

## Watching from the laptop

Meta's own VR Cast to the Horizon phone app is the easy answer and looks good
enough to show people; this section is the alternative for when you would rather
not involve a phone or a Meta account. `scrcpy` mirrors the headset screen over
the `adb` connection this README already sets up, so there is nothing new to
install but scrcpy itself.

```bash
brew install scrcpy
```

Tethered, with USB debugging already accepted (see above):

```bash
scrcpy --no-audio --stay-awake
```

`--no-audio` matters here: the soundscape belongs in the headset, and forwarding
it just doubles the beds in `src/soundscape.js` out of the laptop a beat late.

### Untethered

Cables and gaze-pitch locomotion do not mix — people turn, drift, and find the
cable with their ankles. scrcpy can move itself onto wifi, once, with the cable
still plugged in:

```bash
scrcpy --tcpip --no-audio --stay-awake
```

That switches the headset's adb to TCP/IP and connects over the LAN; from then
on plain `scrcpy --no-audio` finds it with nothing plugged in. Both machines
have to be on the same network, and after a headset reboot you re-tether and run
it again.

Wireless costs latency and sharpness — roughly 150–300 ms against 80 over the
cable. Trade sharpness for responsiveness:

```bash
scrcpy --no-audio -m 1024 -b 8M
```

`adb reverse tcp:5174 tcp:5174` works over wireless adb too, so unpushed work
still runs untethered and `http://localhost:5174` still counts as a secure
context. A bare LAN address would not.

### Cropping to one eye

The mirror is the headset's cast surface, which is squarer than it looks and
carries black margins. Run it bare the first time and read the resolution scrcpy
prints as it starts, or ask the device:

```bash
adb shell wm size
```

`--crop` then takes `width:height:x:y` in the device's natural orientation:

```bash
scrcpy --no-audio --crop 1600:900:160:90
```

Treat those numbers as a starting point rather than a measurement, and nudge `x`
and `y` until the black edges are gone. The crop is applied on the device, so it
saves a little encode bandwidth as well as screen space.

### What it costs

Any kind of mirroring runs the Quest's video encoder — scrcpy and Meta's own
casting alike — so frame timing while someone is watching is not the frame
timing of the piece. Take `fpsLog` readings with the mirror stopped before
concluding anything about `lodScale` or `foveation`, especially in the bubble,
where the number already moves with height in the column.

Both routes mirror the same headset display, so neither shows you more of the
piece than the other. What scrcpy buys beyond skipping the phone is latency —
about 80 ms over the cable against casting's second or so — and `-r session.mp4`
to record straight to the laptop.

## Tuning

Every parameter is a query string override, so the piece can be recalibrated in
the headset without a rebuild. For example:

```
https://samanthapantseng.github.io/vr_GSVisualiser/?maxSpeed=2.4&deadzone=24&worldHeight=60
```

| Parameter | Default | What it does |
| --- | --- | --- |
| `scene` | picker | Which entry in `src/scenes.js` to load. Omit it to get the picker. |
| `worldHeight` | per scene | Metres the capture is scaled to span. `0` keeps its own scale. |
| `maxSpeed` | `0.8` | Metres per second at full tilt. |
| `accel` | `0.9` | How fast speed ramps, in m/s². Lower is gentler and safer for nausea. |
| `deadzone` | `18` | Degrees of pitch that still count as holding still. |
| `fullTilt` | `62` | Degrees of pitch for full speed. |
| `curve` | `1.6` | Above 1 softens the onset near the deadzone. |
| `invert` | `0` | `1` swaps rise and sink. |
| `margin` | `2` | Metres kept clear of each end of the column. |
| `moveSpeed` | `1.5` | *freefly:* metres per second at a full stick push. |
| `roam` | `6` | *freefly:* metres you may travel outside the capture's own bounds. |
| `lodScale` | `1` | Multiplies the splat budget. Drop to `0.6` if the frame rate struggles. |
| `foveation` | `0.75` | 0 to 1. Higher blurs more of the periphery and costs less fill rate. |
| `maxSh` | `3` | Spherical-harmonic degree rendered. `0` is flat diffuse colour, as `.ksplat` was. |
| `fpsLog` | `1` | Seconds between frame-timing lines on the console. `0` silences them. |
| `audio` | `1` | `0` silences the soundscape entirely. |
| `volume` | `0.9` | Master gain, before the safety limiter. |
| `spatial` | `1` | `0` centres the one-shots instead of HRTF-panning them. |
| `shotInterval` | `9` | Mean seconds between one-shots in a zone at full gain. |
| `falloff` | `1` | Zone gain falloff. `1` puts a zone's edge at 25% of its centre. |
| `upAxis` | `+y` | Which data axis points up. |
| `url` | per scene | Splat file to load. Spark reads `.spz`, `.ply`, `.splat`, `.ksplat` and PlayCanvas SOG. |

`maxSpeed`, `deadzone`, `fullTilt`, `curve`, `invert` and `margin` only apply to
the `column` mode; `moveSpeed` and `roam` only to `freefly`. The
rest apply to both.

## Why .spz

The captures were `.ksplat` until Nov 2026 and are now `.spz`, the published
radiance-field format. Two reasons, both measured on these files:

| | `.ksplat` | `.spz` |
| --- | --- | --- |
| `bubble` | 78.0 MB, no harmonics | **55.8 MB, degree 3** |
| `tram` | 21.0 MB | **12.9 MB** |

The bubble is the case worth understanding. Its source carries 45 `f_rest_*`
fields — spherical harmonics, the view-dependent colour that makes a capture a
*radiance field* rather than a coloured point cloud — and `ply-to-ksplat.mjs`
writes `shDegree 0`, so all of it was being discarded on the way in. The `.spz`
is smaller than the file it replaced *and* carries more. The tram gains size
only: its export has `f_dc_*` and nothing else, so it never had harmonics to
lose. Spark also writes `.spz` itself, so `tools/ply-to-spz.mjs` needs no
external build, unlike `tools/ply-to-ksplat.mjs` and its hardcoded path into
another project.

Rendering degree 3 means 45 extra coefficients per splat per frame, which is
not free on Quest. **This has not been measured on the headset yet.** If it
costs too much, `?maxSh=1` or `?maxSh=0` turns it down at render time without
reconverting anything — the file keeps its harmonics either way. Compare at
matched heights in the column, interleaved: where you are in the bubble moves
the frame rate more than most settings do, so one run with and one run without
mostly tells you where you flew.

### Falling back to .ksplat

Both `.ksplat` files are still in `public/data/` and still deployed, so the old
file is one query string away from inside the headset:

```
…/?scene=bubble&url=data/bubble.ksplat
```

That is `url` doing what it always did, so nothing needs rebuilding to use it.
They are worth deleting once `.spz` has been through a showing — they cost
99 MB of every deploy and the artifact upload is the slow part of it.

## Adding a scene

1. Convert the capture and put it in `public/data/`:

   ```bash
   node tools/ply-to-spz.mjs public/data/tram.ply public/data/tram.spz
   ```

   Spark reads `.ply` directly, so this is about weight and about keeping the
   harmonics — the tram went 46.6 MB to 12.9 MB, the bubble 732.7 MB to
   55.8 MB with all of its degree-3 harmonics intact. `.ply` sources are
   gitignored, because git keeps every version of a binary for ever and a
   re-export is a whole new copy.
2. Add an entry to [`src/scenes.js`](src/scenes.js) — file, `upAxis`,
   `worldHeight`, a `locomotion` mode and whether it has `audio`.
3. That is all. It appears in the picker and answers to `?scene=<key>`.

`worldHeight: 0` keeps the capture's own metres, which is what you want for
anything that was a real object at a real size. Only the bubble is rescaled,
because a 63-unit column is not 63 metres of anything in particular.

If a capture comes in tilted, measure it and set `upAxis` in its entry rather
than correcting it with `?upAxis=` on every load. WebXR pins world up to +Y, so
the fix is always to rotate the scene, never the camera.

## Sound

A port of the Pure Data soundscape in `ThreeJS_Gaussian_Splat/soundscapd`, in
[`src/soundscape.js`](src/soundscape.js), driven by rig height. Five zone beds
run continuously and crossfade by gain — nothing is switched on and off, which
is how `bubble.pd` behaves — and each is lowpassed with a cutoff that falls from
4.5 kHz at the surface to under 300 Hz at the bottom.

Zone centres and ranges come from `bubble.pd`'s own `loadbang` messages, which
override the stale sliders stored inside each `environment_*.pd` (terrestrial's
read `1..1`, a zero-width zone that would have been silent):

| Zone | z range | Bed |
| --- | --- | --- |
| office | 4 to 6 | 163 s |
| terrestrial | 2 to 4 | 79 s |
| surface | 0.1 to 2 | 30 s |
| below | -10 to 0 | 956 s |
| floor | -8 to -2 | 518 s |

Beds **stream** rather than decode: an 8.6-minute 48 kHz stereo bed is ~198 MB
of Float32 once decoded, and two of those alongside 500k splats will take the
headset down. Streaming is also what `readsf~` was doing in Pd. The 34 one-shots
are small, so they are decoded up front and fire without buffering, and they are
HRTF-panned to random positions in a ±5 m box — the original does spatialise
them, via `binauralModeled-ircam` inside each `random_noise_*`, though the beds
themselves are plain stereo.

Assets are transcoded to Opus in `public/audio/` (235 MB of WAV becomes 21 MB).
Regenerate them with `ffmpeg` if the sources change; `src/soundscape.json`
carries the zone table and the file manifest.

Two things in there are approximations rather than ports, and want calibrating
by ear against Pd: `shotInterval`, because the Pd timing lives in slider
positions that could not be read off reliably, and `falloff`, which stands in
for the patch's `radius` parameter. Without it the raw `1/(1+d)^2` from the
patch leaves every zone under 10% almost everywhere.

## Notes on the bubble

The column runs along **Y**, about 52 data units tall and 23 wide, and the
capture is **Y-down** — its centres run from y +1.0 to -51.0, the usual
INRIA/COLMAP convention — so its entry carries `upAxis: "-y"`. It read `"+y"`
while the scene was a `.ksplat`, and that was correct at the time:
mkkellogg's converter stands a capture up as it writes it, so the `.ksplat` was
Y-up even though its `.ply` was not. `.spz` preserves the capture's own axes,
which is why switching formats turned the bubble upside down until this was
corrected. WebXR pins world up to +Y and will not let you override it, so the
fix is always to rotate the scene, never the camera.

At the default `worldHeight` the column is 45 m tall and 13 m wide, and travel
is limited to 2–43 m. The visitor is *inside* the column. The scene auto-fits:
on load it samples 50,000 splat centres, measures the extent and scales to
match, so a new capture needs no hand-tuned numbers.

## Comfort

Vertical self-motion is the easy kind to get wrong. Two things are doing the
work: speed ramps in and out rather than snapping (`accel`), and the visitor is
always moving in the direction they are looking, which is the best-tolerated
form of VR locomotion. If testers report discomfort, lower `maxSpeed` and
`accel` before anything else.

Lying on your back naturally holds a steep upward pitch, so the resting posture
is a slow rise, and stopping means tucking the chin. That is the intended
mapping. Widen `deadzone` if visitors struggle to hold position.

## Possible next steps

Three effects from the earlier flat version of this piece are not here: wave
displacement, a proximity reveal that fades splats in within a vertical window
around the viewer, and a circular mask. They were patched into mkkellogg's GLSL
and would need rewriting in Spark's dyno shader graph. The proximity reveal is
the one worth doing first — it suits an underwater descent and would also hide
LoD popping as you move.

A spectator view would beat mirroring for documenting the piece or showing it to
a room. Rather than shipping pixels off the headset, stream the pose — `rig`
position and `camera` quaternion, about 60 bytes a frame over a WebSocket — and
let a second client render the same scene at desktop resolution and a much
higher `lodScale` than Quest can afford. `applyDesktopLook()` in `src/viewer.js`
is the seam: it is already the one place the non-XR camera is decided. Tunnel
the socket through `adb reverse` like the dev server, so everything stays on
`localhost` and no mixed-content rule applies. Note that Quest 3 has no eye
tracking, so this follows head direction, not gaze — which is the right signal
anyway, since head pitch is what drives the column.
