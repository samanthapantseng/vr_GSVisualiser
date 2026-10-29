import { SCENES } from "./scenes.js";

// ---------------------------------------------------------------------------
// The scene picker.
//
// A flat DOM overlay, shown by a bare URL, resolving to the chosen scene. It
// is deliberately not a 3D menu: DOM is invisible inside an XR session, so the
// choice has to happen before Enter VR anyway, and tapping a card in Quest
// Browser beats typing ?scene=tram on a floating keyboard.
//
// Nothing is fetched until a card is tapped, which matters when the wrong
// choice costs an 80 MB download.
// ---------------------------------------------------------------------------

export function showPicker() {
    const root = document.getElementById("picker");

    return new Promise((resolve) => {
        const inner = document.createElement("div");
        inner.className = "picker-inner";

        const heading = document.createElement("h1");
        heading.textContent = "GS Visualiser";

        const lede = document.createElement("p");
        lede.className = "picker-lede";
        lede.textContent = "Choose a scene, then press Enter VR.";

        const list = document.createElement("ul");
        list.className = "picker-list";

        for (const [key, scene] of Object.entries(SCENES)) {
            const title = document.createElement("span");
            title.className = "picker-title";
            title.textContent = scene.title;

            const blurb = document.createElement("span");
            blurb.className = "picker-blurb";
            blurb.textContent = scene.blurb || "";

            const button = document.createElement("button");
            button.className = "picker-card";
            button.type = "button";
            button.append(title, blurb);
            button.addEventListener("click", () => choose(key));

            const item = document.createElement("li");
            item.appendChild(button);
            list.appendChild(item);
        }

        const foot = document.createElement("p");
        foot.className = "picker-foot";
        foot.textContent = "Meta Quest 3 · WebXR";

        inner.append(heading, lede, list, foot);
        root.replaceChildren(inner);
        root.hidden = false;

        // Enter or a tap both work; the first card takes focus so a Bluetooth
        // keyboard or the headset's own navigation has somewhere to start.
        list.querySelector("button")?.focus();

        function choose(key) {
            // Put the choice in the URL before starting, so a reload, a
            // bookmark, or the Quest favourites bar lands straight in the
            // scene and skips this screen.
            const url = new URL(location.href);
            url.searchParams.set("scene", key);
            history.replaceState(null, "", url);

            root.hidden = true;
            root.replaceChildren();
            resolve(SCENES[key]);
        }
    });
}
