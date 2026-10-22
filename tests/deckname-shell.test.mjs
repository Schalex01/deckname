// Tests für die App-Hülle von Deckname. Ausführen: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { installState, HINT_MAC, HINT_IOS } from "../deckname/shell.js";

const UA_CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const UA_SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const UA_SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const UA_FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0";
const UA_CRIOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.0.0 Mobile/15E148 Safari/604.1";
const UA_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0";

test("Bereits als App geöffnet: kein Knopf", () => {
  const s = installState({ standalone: true, promptReady: true, ua: UA_CHROME_MAC });
  assert.equal(s.button, null);
  assert.equal(s.mode, null);
});

test("Chrome mit gefangenem Installations-Angebot: Knopf mit Prompt", () => {
  const s = installState({ promptReady: true, ua: UA_CHROME_MAC });
  assert.equal(s.button, "Als App installieren");
  assert.equal(s.mode, "prompt");
  assert.equal(s.hint, "");
});

test("Chrome ohne Angebot: kein Knopf", () => {
  const s = installState({ promptReady: false, ua: UA_CHROME_MAC });
  assert.equal(s.button, null);
});

test("Safari auf dem Mac: Knopf mit Dock-Hinweis", () => {
  const s = installState({ ua: UA_SAFARI_MAC, touchPoints: 0 });
  assert.equal(s.button, "Als App");
  assert.equal(s.mode, "hint");
  assert.equal(s.hint, HINT_MAC);
});

test("Safari auf dem iPhone: Hinweis auf den Home-Bildschirm", () => {
  const s = installState({ ua: UA_SAFARI_IOS, touchPoints: 5 });
  assert.equal(s.hint, HINT_IOS);
});

test("iPad gibt sich als Macintosh aus, Berührpunkte verraten es", () => {
  const s = installState({ ua: UA_SAFARI_MAC, touchPoints: 5 });
  assert.equal(s.button, "Als App");
  assert.equal(s.hint, HINT_IOS);
});

test("Firefox, Chrome auf iOS und Edge zählen nicht als Safari", () => {
  assert.equal(installState({ ua: UA_FIREFOX }).button, null);
  assert.equal(installState({ ua: UA_CRIOS }).button, null);
  assert.equal(installState({ ua: UA_EDGE }).button, null);
  assert.equal(installState({}).button, null);
});
