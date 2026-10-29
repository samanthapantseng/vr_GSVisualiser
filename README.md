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
budget is 500,000, chosen out of the 3,391,110 splats in `bubble.ksplat`. That
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
the whole reason this works untethered. The first load pulls about 80 MB, so
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
| `snapTurn` | `45` | *freefly:* degrees of yaw per stick flick. |
| `roam` | `6` | *freefly:* metres you may travel outside the capture's own bounds. |
| `lodScale` | `1` | Multiplies the splat budget. Drop to `0.6` if the frame rate struggles. |
| `foveation` | `0.75` | 0 to 1. Higher blurs more of the periphery and costs less fill rate. |
| `fpsLog` | `1` | Seconds between frame-timing lines on the console. `0` silences them. |
| `audio` | `1` | `0` silences the soundscape entirely. |
| `volume` | `0.9` | Master gain, before the safety limiter. |
| `spatial` | `1` | `0` centres the one-shots instead of HRTF-panning them. |
| `shotInterval` | `9` | Mean seconds between one-shots in a zone at full gain. |
| `falloff` | `1` | Zone gain falloff. `1` puts a zone's edge at 25% of its centre. |
| `upAxis` | `+y` | Which data axis points up. |
| `url` | per scene | Splat file to load. Also takes .ply, .spz, .splat, .sog and .rad. |

`maxSpeed`, `deadzone`, `fullTilt`, `curve`, `invert` and `margin` only apply to
the `column` mode; `moveSpeed`, `snapTurn` and `roam` only to `freefly`. The
rest apply to both.

## Adding a scene

1. Convert the capture and put it in `public/data/`:

   ```bash
   node tools/ply-to-ksplat.mjs public/data/tram.ply public/data/tram.ksplat
   ```

   Spark reads `.ply`, `.spz`, `.splat`, `.sog` and `.rad` directly, so this is
   purely about weight — the tram went 48.9 MB to 21.0 MB, geometry unchanged
   to within 2 cm. `.ply` sources are gitignored, because git keeps every
   version of a binary for ever and a re-export is a whole new copy.
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

Measured from `bubble.ksplat`: the column runs along **+Y**, 62.8 data units
tall and about 18 wide, so the data is already Y-up and needs no rotation. WebXR
pins world up to +Y and will not let you override it, so a differently-oriented
capture should be corrected with `?upAxis=` — rotating the scene, never the
camera.

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
