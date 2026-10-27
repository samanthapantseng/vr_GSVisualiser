# vr_GSVisualiser

A standalone Meta Quest 3 viewer for Gaussian splat scenes. The visitor lies
down and steers with their head: **look up to float up, look down to sink, look
level to hold.** No controllers, nothing to hold, no buttons.

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

Open http://localhost:5174. On a desktop you can rehearse the whole interaction:
click to capture the mouse and look around, or use the **arrow keys** to tilt.
**R** resets to mid-depth, **H** toggles the readout.

## Get it on the Quest 3

The piece is deployed and runs standalone. No cable, no dev server, no computer
in the room:

**https://samanthapantseng.github.io/vr_GSVisualiser/**

Open that in Quest Browser and press **Enter VR**. WebXR requires a secure
context, and the HTTPS URL supplies it — that is the whole reason this works
untethered. The first load pulls about 80 MB, so allow a moment on slow wifi.

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
`limits` and the live splat count mid-session.

## Tuning

Every parameter is a query string override, so the piece can be recalibrated in
the headset without a rebuild. For example:

```
https://samanthapantseng.github.io/vr_GSVisualiser/?maxSpeed=2.4&deadzone=24&worldHeight=60
```

| Parameter | Default | What it does |
| --- | --- | --- |
| `worldHeight` | `45` | Metres the column is scaled to span. `0` keeps the capture's own scale (63 m). |
| `maxSpeed` | `1.6` | Metres per second at full tilt. |
| `accel` | `0.9` | How fast speed ramps, in m/s². Lower is gentler and safer for nausea. |
| `deadzone` | `18` | Degrees of pitch that still count as holding still. |
| `fullTilt` | `62` | Degrees of pitch for full speed. |
| `curve` | `1.6` | Above 1 softens the onset near the deadzone. |
| `invert` | `0` | `1` swaps rise and sink. |
| `margin` | `2` | Metres kept clear of each end of the column. |
| `lodScale` | `1` | Multiplies the splat budget. Drop to `0.6` if the frame rate struggles. |
| `foveation` | `0.75` | 0 to 1. Higher blurs more of the periphery and costs less fill rate. |
| `fpsLog` | `1` | Seconds between frame-timing lines on the console. `0` silences them. |
| `upAxis` | `+y` | Which data axis points up. |
| `url` | `data/bubble.ksplat` | Scene to load. Also takes .ply, .spz, .splat, .sog and .rad. |

## Notes on the scene

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
