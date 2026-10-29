import "./style.css";
import { SCENES, FALLBACK_SCENE } from "./scenes.js";
import { showPicker } from "./picker.js";
import { startViewer } from "./viewer.js";

// ---------------------------------------------------------------------------
// Which scene, and how we were asked for it.
//
// A bare URL shows the picker. ?scene=tram goes straight in, which is what a
// Quest bookmark and the tuning query strings rely on — typing a query string
// on the headset's floating keyboard is not something to design around.
// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const asked = params.get("scene");

if (asked && SCENES[asked]) {
    startViewer(SCENES[asked]);
} else if (asked) {
    // A scene that is not in the table is a typo or a stale bookmark, and
    // showing the fallback beats showing nothing.
    console.warn(`Unknown scene "${asked}"; falling back to ${FALLBACK_SCENE}.`);
    startViewer(SCENES[FALLBACK_SCENE]);
} else if (params.get("url")) {
    // ?url= on its own means someone is pointing the viewer at a file by hand.
    // It borrows the fallback scene's settings, so expect to pass ?worldHeight=
    // and ?audio=0 along with it.
    startViewer(SCENES[FALLBACK_SCENE]);
} else {
    showPicker().then(startViewer);
}
