// Deckname · App-Hülle. Reine Logik, kein DOM, damit sie testbar bleibt.
// Entscheidet, ob und wie der Knopf "Als App" angeboten wird.

export const HINT_MAC = "Im Safari-Menü: Ablage → Zum Dock hinzufügen.";
export const HINT_IOS = "Unten auf Teilen tippen, dann Zum Home-Bildschirm.";

/** Safari, und wirklich nur Safari: alle anderen Browser tragen Safari im Kennzeichen mit. */
function isSafari(ua) {
  if (!ua || !/Safari/.test(ua)) return false;
  return !/(Chrome|Chromium|CriOS|FxiOS|Edg|EdgiOS|OPR|OPiOS|Android|SamsungBrowser)/.test(ua);
}
/** iPad meldet sich seit iPadOS 13 als Macintosh, die Zahl der Berührpunkte verrät es. */
function isTouchApple(ua, touchPoints) {
  if (/iPhone|iPad|iPod/.test(ua || "")) return true;
  return /Macintosh/.test(ua || "") && Number(touchPoints || 0) > 1;
}

/**
 * @param {{promptReady?:boolean, standalone?:boolean, ua?:string, touchPoints?:number}} ctx
 * @returns {{button:null|string, hint:string, mode:null|"prompt"|"hint"}}
 */
export function installState(ctx = {}) {
  const { promptReady = false, standalone = false, ua = "", touchPoints = 0 } = ctx;
  if (standalone) return { button: null, hint: "", mode: null };
  if (promptReady) return { button: "Als App installieren", hint: "", mode: "prompt" };
  if (isSafari(ua)) {
    return { button: "Als App", hint: isTouchApple(ua, touchPoints) ? HINT_IOS : HINT_MAC, mode: "hint" };
  }
  return { button: null, hint: "", mode: null };
}
