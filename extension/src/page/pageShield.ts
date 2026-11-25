/*
pageShield.ts: Unsere Elemente auf der Seite (Hinweis, Feldsymbole, Listen-Panel) sollen für die Seite nicht als
"außerhalb" zählen (#53). Dialoge der Seite schließen sich sonst bei einem Klick auf sie (pointerdown/mousedown am
Dokument) oder wenn der Fokus zu ihnen wandert (focusin/focusout). Abgefangen in der Capture-Phase am window, also
vor allen Listenern der Seite am Dokument und auch vor den Bubble-Listenern am window. click bleibt frei, unsere
Knöpfe hängen daran. Ein Ereignis aus einem geschlossenen Shadow DOM kommt am window mit dem Host als Ziel an.
*/

const SHIELDED_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "focusin", "focusout"];

// Host -> Fokus in der Seite lassen (mousedown ohne Standardaktion); nur für Elemente ohne Eingabefelder
const hosts = new WeakMap<Element, { keepFocus: boolean }>();
let installed = false;

function onEvent(e: Event) {
    const options = e.target instanceof Element ? hosts.get(e.target) : undefined;
    if (!options) return;
    if (options.keepFocus && (e.type === "mousedown" || e.type === "pointerdown")) e.preventDefault();
    e.stopImmediatePropagation();
}

export function shieldFromPage(host: Element, keepFocus: boolean) {
    hosts.set(host, { keepFocus });
    if (installed) return;
    installed = true;
    for (const type of SHIELDED_EVENTS) window.addEventListener(type, onEvent, true);
}
