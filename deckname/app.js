// Deckname · Oberfläche. Alles client-side, kein Netzwerk außer der Nutzungszählung (nur Ereignisnamen).
// Prinzip seit 0.4: Treffer sind erst flüchtig (nur dieser Tab). Ins Wörterbuch kommen sie, wenn der geschützte
// Text kopiert oder eine Datei heruntergeladen wird (der Klick ist die Bestätigung nach der Sichtprüfung).
// Von Hand markierte Begriffe sind sofort dauerhaft. Mailadressen und Nummern werden nie gelernt.
// Seit 0.5: eine Karte im Wörterbuch = ein Platzhalter mit Schreibweisen als Chips, Karten lassen sich ineinander
// aufnehmen (alte Platzhalter bleiben im Rückweg auflösbar), Tabellen (csv, tsv) gehen wie Textdateien durch.
import {
  detect, assignPlaceholders, protect, restore, buildPreamble, newSession,
  normalizeKey, makeId, validPlaceholder, MANUAL_TYPES, TYPE_LABEL, placeholderNumber,
} from "./engine.js?v=0.5";
import { installState } from "./shell.js?v=0.5";
import {
  kindOf, rejectReason, outName, safeName, protectOffice, restoreOffice, pdfToText, buildZip,
  TABLE_KINDS, decodeText, utf8WithBom, detectDelimiter, tableClipboard,
} from "./docs.js?v=0.5";
import {
  migrate, promote, learnable, restoreMapping, freeDictPlaceholder, freeVolatilePlaceholder, allPlaceholders,
  spellings, addAlias, removeAlias, setRestoreForm, findBySpelling, suggestCards, mergeInto, unmerge, mergedOwner, similarCards,
  STORE_VERSION,
} from "./store.js?v=0.5";

const STORE = "deckname.v2";          // Wörterbuch, dauerhaft (localStorage)
const SESSION_STORE = "deckname.session"; // flüchtige Treffer, nur dieser Tab (sessionStorage)
const $ = (id) => document.getElementById(id);
const el = {
  src: $("src"), preview: $("preview"), previewwrap: $("previewwrap"), stats: $("stats"),
  ai: $("ai"), result: $("result"), resultwrap: $("resultwrap"), stats2: $("stats2"),
  btnCopyProt: $("btnCopyProt"), btnCopyRes: $("btnCopyRes"), preambleOn: $("preambleOn"),
  pop: $("pop"), popText: $("popText"), popTypes: $("popTypes"),
  chipmenu: $("chipmenu"), chipText: $("chipText"), chipReason: $("chipReason"), chipTypes: $("chipTypes"), chipPh: $("chipPh"), chipRemove: $("chipRemove"),
  drawer: $("drawer"), drawerbg: $("drawerbg"), btnDict: $("btnDict"), btnDrawerClose: $("btnDrawerClose"), dictList: $("dictList"), dictCount: $("dictCount"),
  ignoredWrap: $("ignoredWrap"), ignoredList: $("ignoredList"),
  btnExport: $("btnExport"), importFile: $("importFile"), btnClearDict: $("btnClearDict"),
  tour: $("tour"), btnExample: $("btnExample"), btnTourDone: $("btnTourDone"), btnTour: $("btnTour"), toast: $("toast"), toastText: $("toastText"), toastUndo: $("toastUndo"),
  btnSelProtect: $("btnSelProtect"), volatileNote: $("volatileNote"),
  btnInstall: $("btnInstall"), installhint: $("installhint"), installhintText: $("installhintText"),
  btnPasteSrc: $("btnPasteSrc"), btnPasteAi: $("btnPasteAi"),
  step1: $("step1"), step2: $("step2"), srcHead: $("srcHead"),
  fileInput: $("fileInput"), fileLink: document.querySelector(".filelink"), fileBack: $("fileBack"), btnFileBack: $("btnFileBack"),
  docs: $("docs"), docsList: $("docsList"), docsInfo: $("docsInfo"), docnote: $("docnote"), previewLbl: $("previewLbl"),
  preambleLabel: $("preambleLabel"), btnCopyHint: $("btnCopyHint"), btnClearFiles: $("btnClearFiles"), btnZip: $("btnZip"),
  btnCopyTable: $("btnCopyTable"),
};

// ---------- Zustand ----------
const state = {
  dict: [],          // dauerhaft: [{id, original, aliases, type, placeholder, origin: "manual"|"confirmed"|"guess", altLabels?, merged?}]
                     // original = Rückweg-Form, aliases = weitere Schreibweisen, altLabels = Platzhalter aufgenommener Karten
  volatile: [],      // flüchtig: gleiche Form plus reason, origin "guess"|"regex", Nummern ab 10000
  former: [],        // [{placeholder, original, type}] alte flüchtige Platzhalter schon gelernter Begriffe (Rückweg)
  ignored: [],       // [{text, type}] abgewählte Vermutungen, bleiben abgewählt
  items: [],
  protectedText: "",
  used: [],
  // theme steht bei alten Nutzern noch im Speicher, wird aber nicht mehr gelesen: die App ist nur dunkel.
  settings: { preamble: true, tourDone: false },
  files: [],         // [{id, name, size, kind, bytes, plain, hits, text, used, out, outName, seen, busy, error, reject}]
  activeId: null,    // Datei, die gerade in der Vorschau steht
  counted: { protect: false, restore: false, file: false },
  storageOk: true,
};

let migrated = 0;
function load() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const { data, removed } = migrate(JSON.parse(raw));
      state.dict = data.dict; state.ignored = data.ignored;
      Object.assign(state.settings, data.settings);
      migrated = removed.length;
      if (migrated) save();
    }
  } catch { state.storageOk = false; }
  try {
    const raw = sessionStorage.getItem(SESSION_STORE);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.volatile)) state.volatile = data.volatile.filter((e) => e && e.id && e.original && e.type && e.placeholder);
      if (Array.isArray(data.former)) state.former = data.former.filter((e) => e && e.placeholder && e.original);
    }
  } catch { /* ohne Sitzungsspeicher gilt der flüchtige Kreis nur bis zum Neuladen */ }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ version: STORE_VERSION, dict: state.dict, ignored: state.ignored, settings: state.settings })); }
  catch { state.storageOk = false; }
}
function saveSession() {
  try { sessionStorage.setItem(SESSION_STORE, JSON.stringify({ volatile: state.volatile, former: state.former })); }
  catch { /* siehe load */ }
}
const ignoredSet = () => new Set(state.ignored.map((i) => normalizeKey(i.text) + "|*"));

// ---------- Nutzungszählung (nur Ereignisnamen, keine Inhalte) ----------
function track(name) {
  if (!/(^|\.)a-schmitt\.com$/.test(location.hostname)) return;
  const path = "/deckname/ev/" + name;
  try {
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    window.va("pageview", { route: path, path }); // zählt als Seitenaufruf (auch im Hobby-Plan)
    window.va("event", { name: "deckname_" + name }); // falls Custom Events freigeschaltet sind
  } catch { /* nie den Nutzer stören */ }
}

// ---------- Hilfen ----------
/** Kurze Meldung unten. Mit undo: Knopf „Rückgängig", der die Meldung sofort schließt. */
function toast(msg, undo = null) {
  el.toastText.textContent = msg;
  el.toastUndo.hidden = !undo;
  toast.undo = undo;
  el.toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.toast.hidden = true; toast.undo = null; }, undo ? 5000 : 1800);
}
el.toastUndo.addEventListener("click", () => {
  const fn = toast.undo; toast.undo = null; el.toast.hidden = true; clearTimeout(toast.t);
  if (fn) fn();
});
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  }
}
/** Text plus HTML in die Zwischenablage (für Tabellen: Excel und Word erkennen die Zellen). Fällt auf reinen Text zurück. */
async function copyRich(text, html) {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      })]);
      return true;
    }
  } catch { /* unten der klassische Weg */ }
  // Ohne Rechte für die neue Zwischenablage: das copy-Ereignis darf beide Formen setzen
  try {
    let done = false;
    const onCopy = (ev) => { ev.clipboardData.setData("text/plain", text); ev.clipboardData.setData("text/html", html); ev.preventDefault(); done = true; };
    document.addEventListener("copy", onCopy, { once: true });
    const ok = document.execCommand("copy");
    document.removeEventListener("copy", onCopy);
    if (ok && done) return true;
  } catch { /* zuletzt reiner Text */ }
  return copy(text);
}
/** Eine Wörterbuch-Änderung mit Rückgängig: Zustand merken, ändern, speichern, melden. */
function snapshot() { return JSON.stringify({ dict: state.dict, ignored: state.ignored, volatile: state.volatile, former: state.former }); }
function restoreSnapshot(raw) { Object.assign(state, JSON.parse(raw)); }
function afterDictChange() { dictChanged(); save(); saveSession(); refresh(); if (!el.drawer.hidden) renderDict(); }
function act(msg, fn) {
  const before = snapshot();
  fn();
  afterDictChange();
  toast(msg, () => { restoreSnapshot(before); afterDictChange(); });
}
function replaceEntry(alt, neu) { state.dict = state.dict.map((e) => (e === alt ? neu : e)); return neu; }
function autosize(ta) {
  ta.style.height = "auto";
  ta.style.height = Math.min(Math.max(ta.scrollHeight + 2, 150), 520) + "px";
}
const matchesKey = (e, key) => normalizeKey(e.original) === key || (e.aliases || []).some((a) => normalizeKey(a) === key);
function findEntry(text) { const key = normalizeKey(text); return state.dict.find((e) => matchesKey(e, key)); }
function findVolatile(text) { const key = normalizeKey(text); return state.volatile.find((e) => matchesKey(e, key)); }
/** Der Eintrag hinter einem Treffer in der Vorschau: im Wörterbuch oder im flüchtigen Kreis. */
function entryOf(it) {
  if (!it) return null;
  return state.dict.find((d) => d.id === it.dictId) || state.volatile.find((d) => d.id === it.dictId) || null;
}
const isVolatile = (e) => state.volatile.includes(e);
function freePlaceholder(type, preferred) { return freeDictPlaceholder(type, state.dict, state.volatile, state.former, preferred); }

/** Flüchtigen Eintrag ins Wörterbuch heben, weil der Nutzer ihn angefasst hat (umbenannt, Typ geändert). */
function adopt(e) {
  if (!isVolatile(e)) return e;
  state.volatile = state.volatile.filter((v) => v !== e);
  state.former.push({ placeholder: e.placeholder, original: e.original, type: e.type });
  e.placeholder = freePlaceholder(e.type);
  e.origin = "manual";
  delete e.reason;
  state.dict.push(e);
  saveSession();
  return e;
}
/** Typ wechseln: ein Standard-Platzhalter des alten Typs (PERSON_2) wird zum neuen Typ (FIRMA_3), ein eigener Name (CHEF_M) bleibt. */
function retype(e, type) {
  if (e.type === type) return;
  const wasStandard = placeholderNumber(e.placeholder, e.type) > 0;
  e.type = type;
  if (wasStandard) e.placeholder = isVolatile(e) ? freeVolatilePlaceholder(type, state.dict, state.volatile, state.former) : freePlaceholder(type);
  e.origin = "manual";
}
/** Dauerhaften Eintrag anlegen oder vorhandenen anpassen (von Hand markiert oder importiert). */
function upsertEntry(text, type, origin, preferredPlaceholder) {
  const key = normalizeKey(text);
  state.ignored = state.ignored.filter((i) => normalizeKey(i.text) !== key);
  let e = findEntry(text);
  if (e) {
    retype(e, type);
    if (origin === "manual") e.origin = "manual";
    return e;
  }
  const v = findVolatile(text);
  if (v) { adopt(v); retype(v, type); v.origin = origin; return v; }
  e = { id: makeId(), original: text.trim(), aliases: [], type, placeholder: freePlaceholder(type, preferredPlaceholder), origin };
  state.dict.push(e);
  return e;
}
/** Flüchtigen Eintrag für einen frischen Treffer anlegen (Vermutung oder Muster). */
function addVolatile(m) {
  const e = {
    id: makeId(), original: m.text.trim(), aliases: [], type: m.type,
    placeholder: freeVolatilePlaceholder(m.type, state.dict, state.volatile, state.former),
    origin: m.source === "regex" ? "regex" : "guess", reason: m.reason || "",
  };
  state.volatile.push(e);
  return e;
}
/** Kopieren oder Herunterladen: die flüchtigen Einträge hinter diesen Treffern ins Wörterbuch übernehmen. */
function learnFrom(items) {
  const ids = items.map((it) => it.dictId).filter(Boolean);
  const r = promote(state.dict, state.volatile, state.former, ids);
  if (!r.learned.length) return 0;
  state.dict = r.dict; state.volatile = r.volatile; state.former = r.former;
  dictChanged(); save(); saveSession();
  return r.learned.length;
}

// ---------- Schritt 1 ----------
/** Die eine Schutz-Pipeline: Treffer finden, neue in den flüchtigen Kreis, nochmal finden, Platzhalter setzen. */
function pipeline(text, session, ignored) {
  const first = detect(text, state.dict, [], ignored, state.volatile);
  let added = 0;
  for (const m of first) {
    if (m.source === "dict" || m.source === "volatile" || findEntry(m.text) || findVolatile(m.text)) continue;
    addVolatile(m); added++;
  }
  const matches = added ? detect(text, state.dict, [], ignored, state.volatile) : first;
  const items = assignPlaceholders(matches, state.dict, session, state.volatile).map((it) => {
    const e = entryOf(it);
    // origin steuert nur den Rahmen: Vermutung gestrichelt, alles Gelernte und Mustererkannte durchgezogen
    const origin = it.source === "volatile" ? (e?.origin === "regex" ? "regex" : "guess") : (it.source === "dict" ? "dict" : it.source);
    return { ...it, origin, learnable: e ? learnable(e) : false };
  });
  const p = protect(text, items);
  return { items, text: p.text, used: p.used, added };
}

/** Der Text, der gerade in der Vorschau steht: das Textfeld oder der Klartext der aktiven Datei. */
function currentText() {
  if (!fileMode()) return el.src.value;
  const f = activeFile();
  return f && f.plain ? f.plain : "";
}

function refresh() {
  if (fileMode()) { refreshDocs(); return; }
  refreshText();
}

function refreshText() {
  const text = el.src.value;
  const r = pipeline(text, newSession(), ignoredSet());
  if (r.added) saveSession();
  state.items = r.items;
  state.protectedText = r.text;
  state.used = r.used;
  renderPreview(text);
  renderStats();
  renderDictCount();
  const has = text.trim().length > 0;
  el.btnCopyProt.disabled = !has;
  el.previewwrap.hidden = !has;
  if (has && state.items.length && !state.counted.protect) { state.counted.protect = true; track("protect"); }
  if (el.ai.value.trim()) refreshResult();
  if (!el.drawer.hidden) renderDict();
}

function renderPreview(text) {
  const frag = [];
  let pos = 0;
  state.items.forEach((it, i) => {
    if (it.start > pos) frag.push(`<span data-o="${pos}">${escapeHtml(text.slice(pos, it.start))}</span>`);
    frag.push(`<mark class="chip t-${it.type} src-${it.origin}" data-i="${i}" title="${escapeHtml(it.reason || "")}">${escapeHtml(it.text)}<span class="ph">${escapeHtml(it.placeholder)}</span><button class="x" type="button" data-x="${i}" title="Entfernen: bleibt im Klartext" aria-label="Entfernen">×</button></mark>`);
    pos = it.end;
  });
  if (pos < text.length) frag.push(`<span data-o="${pos}">${escapeHtml(text.slice(pos))}</span>`);
  el.preview.innerHTML = frag.join("");
}

function renderStats() {
  const counts = {};
  for (const it of state.items) counts[it.type] = (counts[it.type] || 0) + 1;
  const parts = Object.entries(counts).map(([t, n]) => `<span class="stat t-${t}">${n} × ${escapeHtml(TYPE_LABEL[t] || t)}</span>`);
  const guesses = state.items.filter((i) => i.origin === "guess").length;
  if (guesses) parts.push(`<span class="stat guess">davon ${guesses} Vermutung${guesses === 1 ? "" : "en"}, bitte prüfen</span>`);
  if (!parts.length && currentText().trim()) parts.push(`<span class="stat empty">Nichts gefunden. Markieren Sie, was geschützt werden soll.</span>`);
  el.stats.innerHTML = parts.join("");
}
function renderDictCount() { el.dictCount.textContent = state.dict.length; }
function volatileSummary() {
  const n = state.volatile.length;
  if (!n) return "";
  const learn = state.volatile.filter(learnable).length;
  const never = n - learn;
  const parts = [];
  if (learn) parts.push(`${learn} Vermutung${learn === 1 ? "" : "en"} kommen beim Kopieren oder Herunterladen dazu`);
  if (never) parts.push(`${never} Kontaktdaten und Nummern bleiben nur für diesen Besuch gemerkt`);
  return "Noch nicht im Wörterbuch: " + parts.join(", ") + ".";
}

// ---------- Schritt 2 ----------
function mapping() { return restoreMapping(state.dict, state.volatile, state.former); }
function refreshResult() {
  const text = el.ai.value;
  const has = text.trim().length > 0;
  el.resultwrap.hidden = !has;
  el.btnCopyRes.disabled = !has;
  if (!has) { el.result.textContent = ""; el.stats2.innerHTML = ""; return; }
  const r = restore(text, mapping());
  const out = [];
  let cursor = 0;
  for (const s of r.spans.sort((a, b) => a.at - b.at)) {
    out.push(escapeHtml(text.slice(cursor, s.at)));
    out.push(`<span class="restored">${escapeHtml(s.original)}</span>`);
    cursor = s.at + s.len;
  }
  out.push(escapeHtml(text.slice(cursor)));
  el.result.innerHTML = out.join("");
  el.result.dataset.plain = r.text;
  const parts = [];
  if (r.count) parts.push(`<span class="stat">${r.count} Platzhalter zurückübersetzt</span>`);
  if (r.leftover.length) parts.push(`<span class="stat guess" title="${escapeHtml(r.leftover.join(", "))}">${r.leftover.length} unbekannt: ${escapeHtml(r.leftover.slice(0, 3).join(", "))}${r.leftover.length > 3 ? " …" : ""}</span>`);
  if (!parts.length) parts.push(`<span class="stat empty">Keine Platzhalter gefunden. Steht der passende Eintrag im Wörterbuch?</span>`);
  el.stats2.innerHTML = parts.join("");
  if (r.count && !state.counted.restore) { state.counted.restore = true; track("restore"); }
}

// ---------- Markieren per Auswahl ----------
function selectionOffsets() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!el.preview.contains(range.startContainer) || !el.preview.contains(range.endContainer)) return null;
  const off = (node, o) => {
    const span = node.nodeType === 3 ? node.parentElement : node;
    if (!span || !span.dataset || span.dataset.o === undefined) return null; // in einem Chip
    return +span.dataset.o + o;
  };
  const a = off(range.startContainer, range.startOffset), b = off(range.endContainer, range.endOffset);
  if (a === null || b === null || b <= a) return null;
  return { start: a, end: b, rect: range.getBoundingClientRect() };
}
function placePop(pop, rect) {
  pop.hidden = false;
  const top = rect.bottom + window.scrollY + 8;
  let left = rect.left + window.scrollX;
  const w = pop.offsetWidth;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - w - 12;
  pop.style.top = top + "px";
  pop.style.left = Math.max(12, Math.min(left, maxLeft)) + "px";
}
function hidePops() { el.pop.hidden = true; el.chipmenu.hidden = true; el.installhint.hidden = true; }

let pendingSel = null;
const narrow = () => window.matchMedia?.("(max-width: 640px)").matches;
let mouseDown = false;
document.addEventListener("mousedown", () => { mouseDown = true; });
document.addEventListener("mouseup", () => { mouseDown = false; });
function openSelPop(anchorRect) {
  if (!pendingSel) return;
  el.popText.textContent = pendingSel.text.length > 40 ? pendingSel.text.slice(0, 40) + "…" : pendingSel.text;
  placePop(el.pop, anchorRect);
}
/** Auswahl in der Vorschau: am Rechner erscheint das Menü direkt an der Markierung, auf dem Handy ein fester Knopf
 * unter der Vorschau, weil dort das Browser-Menü die Stelle verdeckt und mouseup nicht zuverlässig kommt. */
let selTimer = null;
document.addEventListener("selectionchange", () => {
  clearTimeout(selTimer);
  selTimer = setTimeout(() => {
    if (mouseDown) return;
    const s = selectionOffsets();
    if (!s) { el.btnSelProtect.hidden = true; return; }
    const text = currentText().slice(s.start, s.end).trim();
    if (!text) { el.btnSelProtect.hidden = true; return; }
    pendingSel = { text };
    if (narrow()) { el.btnSelProtect.hidden = false; el.pop.hidden = true; }
    else openSelPop(s.rect);
  }, 120);
});
// Der Knopf darf die Auswahl nicht aufheben, sonst ist der markierte Text weg, bevor der Klick ankommt
el.btnSelProtect.addEventListener("pointerdown", (ev) => ev.preventDefault());
el.btnSelProtect.addEventListener("click", (ev) => { ev.stopPropagation(); openSelPop(el.btnSelProtect.getBoundingClientRect()); });
function typeButtons(container, onPick, current) {
  container.innerHTML = "";
  for (const t of MANUAL_TYPES) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = TYPE_LABEL[t]; b.dataset.type = t;
    if (t === current) b.classList.add("on");
    b.addEventListener("click", () => onPick(t));
    container.appendChild(b);
  }
}
typeButtons(el.popTypes, (type) => {
  if (!pendingSel) return;
  const e = upsertEntry(pendingSel.text, type, "manual");
  dictChanged(); save(); saveSession(); refresh(); track("mark"); toast(`Geschützt als ${e.placeholder}, im Wörterbuch gemerkt`);
  pendingSel = null; hidePops(); el.btnSelProtect.hidden = true; window.getSelection()?.removeAllRanges();
});

// ---------- Chip-Menü: Typ, Umbenennen, Entfernen ----------
let chipItem = null;
/** × am Treffer: raus aus dem Text und aus Wörterbuch bzw. flüchtigem Kreis, mit Rückgängig. */
function removeItem(it) {
  const e = entryOf(it);
  const wasDict = e && !isVolatile(e);
  if (e) {
    state.dict = state.dict.filter((d) => d !== e);
    state.volatile = state.volatile.filter((d) => d !== e);
  }
  const ign = { text: it.text, type: it.type };
  state.ignored.push(ign);
  dictChanged(); save(); saveSession(); refresh();
  toast(wasDict ? `„${it.text}" entfernt, auch aus dem Wörterbuch` : `„${it.text}" bleibt im Klartext`, () => {
    state.ignored = state.ignored.filter((i) => i !== ign);
    if (e) (wasDict ? state.dict : state.volatile).push(e);
    dictChanged(); save(); saveSession(); refresh();
  });
}
el.preview.addEventListener("click", (ev) => {
  const x = ev.target.closest("[data-x]");
  if (x) { removeItem(state.items[+x.dataset.x]); ev.stopPropagation(); return; }
  const chip = ev.target.closest("[data-i]");
  if (!chip) return;
  chipItem = state.items[+chip.dataset.i];
  el.chipText.textContent = chipItem.text;
  el.chipReason.textContent = chipItem.reason || "";
  el.chipPh.value = chipItem.placeholder;
  el.chipPh.classList.remove("err");
  typeButtons(el.chipTypes, (type) => {
    const e = entryOf(chipItem);
    if (e) { adopt(e); retype(e, type); dictChanged(); save(); saveSession(); refresh(); toast(`Jetzt ${TYPE_LABEL[type]}, im Wörterbuch gemerkt`); }
    hidePops();
  }, chipItem.type);
  placePop(el.chipmenu, chip.getBoundingClientRect());
  setTimeout(() => el.chipPh.focus(), 0);
  ev.stopPropagation();
});
function renamePlaceholder(entry, raw, input) {
  const v = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (v === entry.placeholder) return true;
  const clash = allPlaceholders(state.dict.filter((d) => d !== entry), state.volatile.filter((d) => d !== entry), state.former).includes(v);
  if (!validPlaceholder(v) || clash) {
    input.classList.add("err");
    toast(clash ? "Diesen Platzhalter gibt es schon" : "Nur Großbuchstaben, Ziffern und _ (z. B. CHEF_M)");
    return false;
  }
  const wasVolatile = isVolatile(entry);
  adopt(entry); // ein eigener Name ist eine bewusste Entscheidung: ab jetzt dauerhaft
  entry.placeholder = v; entry.origin = "manual"; input.value = v; input.classList.remove("err");
  dictChanged(); save(); saveSession(); refresh(); toast(wasVolatile ? `Heißt jetzt ${v}, im Wörterbuch gemerkt` : `Heißt jetzt ${v}`);
  return true;
}
el.chipPh.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") { ev.preventDefault(); const e = entryOf(chipItem); if (e && renamePlaceholder(e, el.chipPh.value, el.chipPh)) hidePops(); }
});
el.chipPh.addEventListener("change", () => { const e = entryOf(chipItem); if (e) renamePlaceholder(e, el.chipPh.value, el.chipPh); });
el.chipRemove.addEventListener("click", () => { if (chipItem) removeItem(chipItem); hidePops(); });
document.addEventListener("click", (ev) => {
  if (!ev.target.closest(".pop") && !ev.target.closest("[data-i]") && ev.target !== el.btnInstall && ev.target !== el.btnSelProtect) hidePops();
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { hidePops(); closeDrawer(); } });

// ---------- Wörterbuch-Schublade ----------
// Eine Karte = ein Platzhalter. Kopfzeile: Platzhalter, „zurück zu“ Rückweg-Form, Art, Entfernen.
// Darunter die Schreibweisen als Chips; gestrichelte Chips gehören zu einer aufgenommenen Karte (× holt sie zurück).
function dictCard(e) {
  const aliases = spellings(e).slice(1);
  const chips = aliases.map((a) => {
    const owner = mergedOwner(e, a);
    return owner
      ? `<span class="achip merged" title="Früher ${escapeHtml(owner.placeholder)}. Das × macht daraus wieder eine eigene Karte."><span class="t">${escapeHtml(a)}</span><button type="button" class="x" data-unmerge="${owner.id}" aria-label="${escapeHtml(owner.placeholder)} wieder als eigene Karte">×</button></span>`
      : `<span class="achip"><span class="t">${escapeHtml(a)}</span><button type="button" class="x" data-alias="${escapeHtml(a)}" title="Schreibweise entfernen" aria-label="Schreibweise ${escapeHtml(a)} entfernen">×</button></span>`;
  }).join("");
  const similar = similarCards(state.dict, e);
  const typeOpts = MANUAL_TYPES.map((t) => `<option value="${t}" ${t === e.type ? "selected" : ""}>${TYPE_LABEL[t]}</option>`).join("")
    + (MANUAL_TYPES.includes(e.type) ? "" : `<option value="${e.type}" selected>${TYPE_LABEL[e.type]}</option>`);
  return `
    <div class="dictitem" data-id="${e.id}">
      <div class="cardhead">
        <input class="ph" aria-label="Platzhalter" value="${escapeHtml(e.placeholder)}" maxlength="24" spellcheck="false" title="Platzhalter umbenennen, z. B. CHEF_M">
        <span class="to">zurück zu</span>
        <input class="orig" aria-label="Rückweg-Form" value="${escapeHtml(e.original)}" spellcheck="false" title="So steht es nach dem Rückweg im Text. Die bisherige Form bleibt als Schreibweise geschützt.">
        <select aria-label="Art" title="Art des Platzhalters">${typeOpts}</select>
        <button type="button" class="iconbtn del" title="Karte entfernen: bleibt künftig im Klartext" aria-label="Karte entfernen">×</button>
      </div>
      <div class="allbl">Werden im Text auch zu ${escapeHtml(e.placeholder)}</div>
      <div class="aliases">${chips}<input class="alin" aria-label="Schreibweise hinzufügen" placeholder="${aliases.length ? "weitere …" : "Kurzform, Abkürzung, andere Schreibweise …"}" title="Tippen und Enter. Steht die Schreibweise schon auf einer anderen Karte, wird die Karte vorgeschlagen." autocomplete="off" spellcheck="false"></div>
      <div class="suggest" hidden></div>
      ${similar.length ? `<div class="similar">Ähnlich: ${similar.map((o) => `<button type="button" data-merge="${o.id}" title="${escapeHtml(o.placeholder)} mit allen Schreibweisen in diese Karte aufnehmen">${escapeHtml(o.placeholder)} ${escapeHtml(o.original)}</button>`).join(" ")}</div>` : ""}
    </div>`;
}
function renderDict() {
  renderDictCount();
  el.volatileNote.textContent = volatileSummary();
  el.volatileNote.hidden = !state.volatile.length;
  if (!state.dict.length) {
    el.dictList.innerHTML = `<div class="dictempty">Noch leer. Was Sie von Hand markieren, steht sofort hier. Vermutungen kommen dazu, sobald Sie den geschützten Text kopieren oder eine Datei herunterladen.</div>`;
  } else {
    el.dictList.innerHTML = state.dict.map(dictCard).join("");
  }
  el.ignoredWrap.hidden = !state.ignored.length;
  el.ignoredList.innerHTML = state.ignored.map((i, idx) => `<button type="button" class="ign" data-ign="${idx}" title="Wieder schützen">${escapeHtml(i.text)} <span>↩</span></button>`).join("");
}
const cardEntry = (node) => { const item = node.closest("[data-id]"); return item ? state.dict.find((d) => d.id === item.dataset.id) || null : null; };

/** Karte source in Karte target aufnehmen (das Wort dafür steht nirgends in der Oberfläche). */
function takeOver(target, sourceId) {
  const source = state.dict.find((d) => d.id === sourceId);
  if (!target || !source) return;
  act(`${source.placeholder} gehört jetzt zu ${target.placeholder}: „${source.original}“ wird im Text zu ${target.placeholder}`, () => {
    state.dict = mergeInto(state.dict, target.id, source.id);
  });
}
/** Enter oder Verlassen des Chip-Felds: Schreibweise dazu, oder die Karte aufnehmen, die diese Schreibweise schon trägt. */
function commitAlias(input) {
  const e = cardEntry(input);
  const text = input.value.trim();
  input.value = "";
  if (!e || !text) return;
  const other = findBySpelling(state.dict, text, e.id);
  if (other) { takeOver(e, other.id); return; }
  if (spellings(e).some((x) => normalizeKey(x) === normalizeKey(text))) { toast("Steht schon auf der Karte"); return; }
  act(`„${text}“ wird im Text zu ${e.placeholder}`, () => { replaceEntry(e, addAlias(e, text)); });
}
el.dictList.addEventListener("click", (ev) => {
  const e = cardEntry(ev.target); if (!e) return;
  const del = ev.target.closest(".del");
  if (del) {
    act(`„${e.original}“ entfernt, bleibt künftig im Klartext`, () => {
      state.dict = state.dict.filter((d) => d !== e);
      state.ignored.push({ text: e.original, type: e.type });
    });
    return;
  }
  const al = ev.target.closest("[data-alias]");
  if (al) { const a = al.dataset.alias; act(`„${a}“ ist keine Schreibweise von ${e.placeholder} mehr`, () => { replaceEntry(e, removeAlias(e, a)); }); return; }
  const um = ev.target.closest("[data-unmerge]");
  if (um) {
    const card = (e.merged || []).find((m) => m.id === um.dataset.unmerge);
    act(card ? `${card.placeholder} ist wieder eine eigene Karte` : "Zurückgeholt", () => { state.dict = unmerge(state.dict, e.id, um.dataset.unmerge); });
    return;
  }
  const mg = ev.target.closest("[data-merge]");
  if (mg) { takeOver(e, mg.dataset.merge); return; }
});
el.dictList.addEventListener("change", (ev) => {
  const e = cardEntry(ev.target); if (!e) return;
  if (ev.target.tagName === "SELECT") { act(`${e.placeholder} ist jetzt ${TYPE_LABEL[ev.target.value]}`, () => retype(e, ev.target.value)); return; }
  if (ev.target.classList.contains("orig")) {
    const neu = ev.target.value.trim();
    if (!neu) { ev.target.value = e.original; return; }
    if (normalizeKey(neu) === normalizeKey(e.original)) { ev.target.value = e.original; return; }
    const other = findBySpelling(state.dict, neu, e.id);
    if (other) {
      // Die neue Rückweg-Form steht auf einer anderen Karte: die kommt mit, damit nichts doppelt ist
      act(`${e.placeholder} kommt als „${neu}“ zurück, ${other.placeholder} gehört jetzt dazu`, () => {
        state.dict = mergeInto(state.dict, e.id, other.id);
        const t = state.dict.find((d) => d.id === e.id);
        replaceEntry(t, setRestoreForm(t, neu));
      });
    } else {
      act(`${e.placeholder} kommt als „${neu}“ zurück, „${e.original}“ bleibt geschützt`, () => { replaceEntry(e, setRestoreForm(e, neu)); });
    }
    return;
  }
  if (ev.target.classList.contains("ph")) { if (!renamePlaceholder(e, ev.target.value, ev.target)) { ev.target.value = e.placeholder; ev.target.classList.remove("err"); } else renderDict(); return; }
  if (ev.target.classList.contains("alin")) { commitAlias(ev.target); }
});
el.dictList.addEventListener("input", (ev) => {
  if (!ev.target.classList.contains("alin")) return;
  const e = cardEntry(ev.target); if (!e) return;
  const box = ev.target.closest(".dictitem").querySelector(".suggest");
  const list = suggestCards(state.dict, ev.target.value, e.id);
  box.hidden = !list.length;
  box.innerHTML = list.map(({ entry, hit }) => `<button type="button" data-merge="${entry.id}" title="${escapeHtml(entry.placeholder)} mit allen Schreibweisen in diese Karte aufnehmen"><b>${escapeHtml(entry.placeholder)}</b> · ${escapeHtml(hit)} · übernehmen</button>`).join("");
});
// Ein Klick auf einen Vorschlag darf das Feld nicht vorher verlassen (sonst würde der Text als Schreibweise angelegt)
el.dictList.addEventListener("pointerdown", (ev) => { if (ev.target.closest(".suggest")) ev.preventDefault(); });
el.dictList.addEventListener("keydown", (ev) => {
  if (!ev.target.classList.contains("alin")) return;
  if (ev.key === "Enter") { ev.preventDefault(); commitAlias(ev.target); }
  if (ev.key === "Escape") { ev.target.value = ""; ev.target.closest(".dictitem").querySelector(".suggest").hidden = true; }
});
el.ignoredList.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-ign]"); if (!b) return;
  const i = state.ignored[+b.dataset.ign];
  act(`„${i.text}“ wird wieder geschützt`, () => {
    state.ignored.splice(+b.dataset.ign, 1);
    upsertEntry(i.text, MANUAL_TYPES.includes(i.type) ? i.type : "SONSTIGES", "manual");
  });
});
function openDrawer() { renderDict(); el.drawer.hidden = false; el.drawerbg.hidden = false; }
function closeDrawer() { el.drawer.hidden = true; el.drawerbg.hidden = true; }
el.btnDict.addEventListener("click", openDrawer);
el.btnDrawerClose.addEventListener("click", closeDrawer);
el.drawerbg.addEventListener("click", closeDrawer);

el.btnExport.addEventListener("click", () => {
  if (!state.dict.length && !state.ignored.length) { toast("Das Wörterbuch ist leer"); return; }
  if (!confirm("Die Datei enthält die Klarnamen aus Ihrem Wörterbuch. Bitte nur an einem sicheren Ort ablegen und nie in ein KI-Werkzeug laden. Exportieren?")) return;
  const blob = new Blob([JSON.stringify({ deckname: 4, exported: new Date().toISOString(), dict: state.dict, ignored: state.ignored }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "deckname-woerterbuch.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
el.importFile.addEventListener("change", async () => {
  const f = el.importFile.files?.[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const list = Array.isArray(data) ? data : data.dict;
    let n = 0;
    for (const e of list || []) {
      if (!e || !e.original || !e.type || findEntry(e.original)) continue;
      const neu = { id: makeId(), original: e.original, aliases: Array.isArray(e.aliases) ? e.aliases : [], type: e.type, placeholder: freePlaceholder(e.type, validPlaceholder(e.placeholder || "") ? e.placeholder : null), origin: e.origin || "manual" };
      if (Array.isArray(e.altLabels)) neu.altLabels = e.altLabels.filter((x) => typeof x === "string" && validPlaceholder(x) && !allPlaceholders(state.dict, state.volatile, state.former).includes(x));
      if (Array.isArray(e.merged)) neu.merged = e.merged.filter((m) => m && m.id && m.original && m.type && m.placeholder);
      state.dict.push(neu);
      n++;
    }
    for (const i of (data.ignored || [])) if (i && i.text && !state.ignored.some((x) => normalizeKey(x.text) === normalizeKey(i.text))) state.ignored.push(i);
    dictChanged(); save(); renderDict(); refresh(); toast(`${n} Einträge übernommen`);
  } catch { toast("Datei nicht lesbar"); }
  el.importFile.value = "";
});
el.btnClearDict.addEventListener("click", () => {
  if (!state.dict.length && !state.ignored.length) return;
  if (!confirm("Wörterbuch wirklich leeren? Alle Platzhalter werden vergessen. Das lässt sich nicht rückgängig machen.")) return;
  state.dict = []; state.ignored = []; state.volatile = []; state.former = [];
  dictChanged(); save(); saveSession(); renderDict(); refresh();
});

// ---------- Aktionen ----------
el.btnCopyProt.addEventListener("click", async () => {
  const pre = el.preambleOn.checked ? buildPreamble(state.used) : "";
  if (await copy(pre + state.protectedText)) {
    // Kopieren = Vorschau geprüft: die Vermutungen in diesem Text wandern jetzt ins Wörterbuch
    const n = learnFrom(state.items);
    if (n) refresh();
    toast(n ? `Kopiert, ${n} Begriff${n === 1 ? "" : "e"} im Wörterbuch gemerkt` : "Geschützter Text kopiert");
    track("copy_protected");
  } else toast("Kopieren nicht möglich");
});
el.btnCopyRes.addEventListener("click", async () => {
  if (await copy(el.result.dataset.plain || "")) { toast("Ergebnis kopiert"); track("copy_result"); }
  else toast("Kopieren nicht möglich");
});
el.preambleOn.addEventListener("change", () => { state.settings.preamble = el.preambleOn.checked; save(); });

let t1, t2;
el.src.addEventListener("input", () => { autosize(el.src); clearTimeout(t1); t1 = setTimeout(refresh, 250); });
el.src.addEventListener("paste", () => { state.counted.protect = false; setTimeout(() => { autosize(el.src); refresh(); }, 0); });
el.ai.addEventListener("input", () => { autosize(el.ai); clearTimeout(t2); t2 = setTimeout(refreshResult, 200); });
el.ai.addEventListener("paste", () => { state.counted.restore = false; setTimeout(() => { autosize(el.ai); refreshResult(); }, 0); });

// ---------- Als App ablegen ----------
let installPrompt = null;   // Chrome/Edge: das abgefangene Angebot des Browsers
let promptSpent = false;    // ein Angebot lässt sich nur einmal öffnen
const HINT_SPENT = "Der Browser hat das Angebot schon gezeigt. Es geht auch über das Installationssymbol rechts in der Adresszeile.";

function renderInstall() {
  const st = installState({
    promptReady: !!installPrompt,
    standalone: window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true,
    ua: navigator.userAgent || "",
    touchPoints: navigator.maxTouchPoints || 0,
  });
  el.btnInstall.hidden = !st.button;
  if (!st.button) { el.installhint.hidden = true; return; }
  // auf schmalen Schirmen die kurze Beschriftung, sonst passt die Kopfzeile nicht mehr
  const narrow = window.matchMedia?.("(max-width: 640px)").matches;
  el.btnInstall.textContent = narrow ? "Als App" : st.button;
  el.btnInstall.dataset.mode = st.mode;
  if (st.hint) el.installhintText.textContent = st.hint;
}
window.addEventListener("resize", () => { if (!el.btnInstall.hidden) renderInstall(); });
window.addEventListener("beforeinstallprompt", (ev) => { ev.preventDefault(); installPrompt = ev; promptSpent = false; renderInstall(); });
window.addEventListener("appinstalled", () => {
  installPrompt = null; promptSpent = false;
  el.installhint.hidden = true;
  renderInstall();
  track("app_installed");
});
el.btnInstall.addEventListener("click", async (ev) => {
  ev.stopPropagation();
  if (el.btnInstall.dataset.mode === "prompt") {
    if (installPrompt && !promptSpent) {
      promptSpent = true;
      try { installPrompt.prompt(); await installPrompt.userChoice; } catch { /* Knopf bleibt stehen */ }
      return;
    }
    el.installhintText.textContent = HINT_SPENT; // abgelehnt: Knopf bleibt, Weg über den Browser zeigen
  }
  el.installhint.hidden = !el.installhint.hidden;
  if (!el.installhint.hidden) placePop(el.installhint, el.btnInstall.getBoundingClientRect());
});

// ---------- Zwischenablage ----------
const canRead = () => !!navigator.clipboard?.readText;
async function readClipboard() {
  try { return await navigator.clipboard.readText(); }
  catch { toast("Zugriff auf die Zwischenablage nicht erlaubt"); return null; }
}
el.btnPasteSrc.addEventListener("click", async () => {
  const text = await readClipboard();
  if (text === null) return;
  el.src.value = text;
  state.counted.protect = false;
  autosize(el.src); refresh();
  el.src.scrollIntoView({ behavior: "smooth", block: "nearest" });
});
el.btnPasteAi.addEventListener("click", async () => {
  const text = await readClipboard();
  if (text === null) return;
  el.ai.value = text;
  state.counted.restore = false;
  autosize(el.ai); refreshResult();
  const r = restore(text, mapping());
  if (!r.count) { toast("Keine Platzhalter in der Zwischenablage gefunden"); return; }
  const ok = await copy(r.text);
  toast(ok ? `Zurückgeholt und kopiert: ${r.count} Platzhalter` : `Zurückgeholt: ${r.count} Platzhalter, Kopieren war nicht möglich`);
});

// ---------- Dateien ----------
// Wort- und Foliendateien behalten ihr Layout: Deckname tauscht nur die Textknoten. Ein PDF wird zu Text.
const MAX_FILES = 30;
const KIND_LABEL = { docx: "WORD", pptx: "PPT", pdf: "PDF", txt: "TXT", md: "MD", csv: "CSV", tsv: "TSV" };
const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "text/plain;charset=utf-8", txt: "text/plain;charset=utf-8", md: "text/markdown;charset=utf-8",
  csv: "text/csv;charset=utf-8", tsv: "text/tab-separated-values;charset=utf-8",
};
const KIND_NOTE = {
  docx: "Als Text gezeigt, die Datei behält ihr Layout.",
  pptx: "Als Text gezeigt, die Datei behält ihr Layout.",
  pdf: "Wird als Text ausgegeben, das Layout geht verloren.",
  csv: "Tabelle als Text gezeigt. Trenner und Zeilen bleiben wie im Original, der Download ist CSV UTF-8, das liest Excel richtig.",
  tsv: "Tabelle als Text gezeigt. Tabulatoren und Zeilen bleiben wie im Original, der Download ist UTF-8.",
};
function kindNote(f) {
  let n = KIND_NOTE[f.kind] || "";
  if (f.encoding === "windows-1252") n += " Die Datei war Windows-1252 kodiert (altes Excel), Umlaute sind umgesetzt.";
  return n;
}

const fileMode = () => state.files.length > 0;
const activeFile = () => state.files.find((f) => f.id === state.activeId) || null;
const usable = (f) => !f.reject && !f.error;
const fehlerText = (err) => (err && err.message) || "Die Datei konnte nicht gelesen werden.";

function shortName(name, max = 46) {
  const n = String(name || "");
  if (n.length <= max) return n;
  const punkt = n.lastIndexOf(".");
  const ext = punkt > 0 ? n.slice(punkt) : "";
  return n.slice(0, max - ext.length - 1) + "…" + ext;
}
function humanSize(b) {
  if (!(b > 0)) return "0 KB";
  if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)) + " KB";
  return (b / (1024 * 1024)).toFixed(1).replace(".", ",") + " MB";
}

// pdf.js ist groß und wird erst geholt, wenn wirklich ein PDF kommt
let pdfjsP = null;
function pdfjs() {
  if (!pdfjsP) {
    pdfjsP = import("/deckname/vendor/pdf.min.mjs").then((m) => {
      const lib = m && m.getDocument ? m : m.default;
      lib.GlobalWorkerOptions.workerSrc = "/deckname/vendor/pdf.worker.min.mjs";
      return lib;
    }).catch(() => { pdfjsP = null; throw new Error("Der PDF-Leser konnte nicht geladen werden."); });
  }
  return pdfjsP;
}

function download(name, data, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: mime || "application/octet-stream" }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Alle Platzhalter aus allen Dateien, für den Hinweis an das KI-Werkzeug. */
function allUsed() {
  const m = new Map();
  for (const f of state.files) for (const u of f.used || []) m.set(u.placeholder, u.type);
  return [...m].map(([placeholder, type]) => ({ placeholder, type }));
}
function hintText() {
  const pre = buildPreamble(allUsed()).replace(/\s*-{3,}\s*$/, "").trim();
  return pre || "Hinweis: In diesen Dateien stehen keine Platzhalter.";
}

/** Eine Datei schützen. Wirft nicht: ein Fehler bleibt in der Zeile stehen. */
async function processFile(f, session, ignored) {
  const protectFn = (t) => {
    const r = pipeline(t, session, ignored);
    return { text: r.text, items: r.items, used: r.used };
  };
  try {
    if (f.kind === "docx" || f.kind === "pptx") {
      const res = await protectOffice(f.bytes, f.kind, protectFn);
      f.plain = res.plain; f.hits = res.hits; f.text = res.text; f.used = res.used; f.out = res.bytes;
    } else {
      // Rohtext nur einmal holen: ein PDF zweimal zu lesen kostet unnötig Zeit
      if (f.raw == null) {
        if (f.kind === "pdf") f.raw = await pdfToText(f.bytes, await pdfjs());
        else { const d = decodeText(f.bytes); f.raw = d.text; f.encoding = d.encoding; }
      }
      const r = pipeline(f.raw, session, ignored);
      f.plain = f.raw; f.hits = r.items; f.text = r.text; f.used = r.used;
      if (TABLE_KINDS.has(f.kind)) {
        // Tabellen immer als UTF-8 mit BOM ausgeben: Excel unter Windows liest sonst ANSI und zerlegt die Umlaute
        f.delim = detectDelimiter(f.raw, f.kind);
        f.out = utf8WithBom(r.text);
      } else f.out = r.text;
    }
    // Der Dateiname läuft durch dasselbe Wörterbuch: aus "Vertrag Mustermann.docx" wird "Vertrag PERSON_1.geschuetzt.docx"
    const base = pipeline(f.name.replace(/\.[A-Za-z0-9]+\s*$/, ""), session, ignored).text;
    f.outName = outName(f.name, f.kind, base);
    f.error = null;
    return true;
  } catch (err) {
    f.error = fehlerText(err);
    f.plain = ""; f.hits = []; f.used = []; f.text = ""; f.out = null;
    return false;
  }
}

let docRun = 0;
async function refreshDocs() {
  const my = ++docRun;
  const session = newSession();
  const ignored = ignoredSet();
  renderDocs();
  for (const f of state.files) {
    if (f.reject) continue;
    f.busy = true;
    renderDocs();
    await new Promise((r) => setTimeout(r, 0));   // dem Browser Luft lassen, damit "verarbeite …" zu sehen ist
    if (my !== docRun) return;
    const ok = await processFile(f, session, ignored);
    if (my !== docRun) return;
    f.busy = false;
    if (ok && !state.counted.file) { state.counted.file = true; track("file_protect"); }
    renderDocs();
    if (f.id === state.activeId) showActive();
  }
  saveSession();
  renderDictCount();
  renderDocs();
  showActive();
  if (el.ai.value.trim()) refreshResult();
  if (!el.drawer.hidden) renderDict();
}

/** Die aktive Datei in die bestehende Chip-Vorschau legen. */
function showActive() {
  const f = activeFile();
  if (!f || !usable(f) || !f.plain) {
    state.items = []; state.protectedText = ""; state.used = [];
    el.preview.innerHTML = "";
    el.previewwrap.hidden = true;
    el.docnote.hidden = true;
    el.btnCopyTable.hidden = true;
    renderStats();
    return;
  }
  state.items = f.hits || [];
  state.protectedText = f.text || "";
  state.used = f.used || [];
  el.previewLbl.textContent = "Geschützte Vorschau: " + shortName(f.name, 34);
  const note = kindNote(f);
  el.docnote.textContent = note;
  el.docnote.hidden = !note;
  el.btnCopyTable.hidden = !TABLE_KINDS.has(f.kind);
  el.btnCopyTable.disabled = !f.text;
  el.previewwrap.hidden = false;
  renderPreview(f.plain);
  renderStats();
}

function renderDocs() {
  el.docs.hidden = !fileMode();
  if (!fileMode()) return;
  el.docsList.innerHTML = state.files.map((f) => {
    const aktiv = f.id === state.activeId;
    let status = "";
    if (f.busy) status = '<span class="st busy">verarbeite …</span>';
    else if (usable(f)) status = f.seen ? '<span class="st ok">geprüft ✓</span>' : '<span class="st wait">noch ansehen</span>';
    const zahl = usable(f) && !f.busy ? ` · ${(f.hits || []).length} Platzhalter` : "";
    const aus = !usable(f) || f.busy || !f.seen || f.out == null;
    return `<div class="docrow${aktiv ? " on" : ""}${usable(f) ? "" : " bad"}" data-f="${f.id}">
      <span class="kind">${KIND_LABEL[f.kind] || "?"}</span>
      <span class="nm" title="${escapeHtml(f.name)}">${escapeHtml(shortName(f.name))}</span>
      <button type="button" class="btn ghost dl" data-dl="${f.id}"${aus ? " disabled" : ""}>Herunterladen</button>
      <button type="button" class="kill" data-kill="${f.id}" title="Datei entfernen" aria-label="Datei entfernen">×</button>
      <span class="info">${escapeHtml(humanSize(f.size))}${zahl} ${status}</span>
      ${usable(f) ? "" : `<span class="err">${escapeHtml(f.reject || f.error || "")}</span>`}
    </div>`;
  }).join("");
  const gut = state.files.filter(usable);
  const geprueft = gut.filter((f) => f.seen && !f.busy).length;
  el.docsInfo.textContent = gut.length
    ? `${geprueft} von ${gut.length} geprüft`
    : "Keine Datei, die Deckname lesen kann";
  el.btnZip.disabled = !gut.length || gut.some((f) => !f.seen || f.busy || f.out == null);
}

function activate(id) {
  const f = state.files.find((x) => x.id === id);
  if (!f || !usable(f)) return;
  state.activeId = id;
  f.seen = true;
  renderDocs();
  showActive();
}

/** Ändert sich das Wörterbuch, muss jede nicht sichtbare Datei noch einmal angesehen werden. */
function dictChanged() {
  for (const f of state.files) if (f.id !== state.activeId) f.seen = false;
}

function applyMode() {
  const on = fileMode();
  el.src.hidden = on;
  el.srcHead.hidden = on;
  el.docs.hidden = !on;
  el.btnCopyProt.hidden = on;
  el.preambleLabel.hidden = on;
  el.btnCopyHint.hidden = !on;
  el.btnClearFiles.hidden = !on;
  el.btnZip.hidden = !on;
  if (!on) {
    el.btnCopyTable.hidden = true;
    el.previewLbl.textContent = "Vorschau mit Platzhaltern";
    el.docnote.hidden = true;
    el.docsList.innerHTML = "";
  }
}

async function addFiles(list) {
  const eingehend = [...(list || [])].filter(Boolean);
  if (!eingehend.length) return;
  let zuviel = 0;
  for (const file of eingehend) {
    if (state.files.length >= MAX_FILES) { zuviel++; continue; }
    const grund = rejectReason(file.name, file.size);
    const f = {
      id: makeId(), name: file.name, size: file.size, kind: kindOf(file.name),
      bytes: null, raw: null, plain: "", hits: [], text: "", used: [], out: null, outName: "",
      seen: false, busy: false, error: null, reject: grund,
    };
    if (!grund) {
      try { f.bytes = new Uint8Array(await file.arrayBuffer()); }
      catch { f.reject = "Die Datei ließ sich nicht öffnen."; }
    }
    state.files.push(f);
  }
  if (zuviel) toast(`Mehr als ${MAX_FILES} Dateien auf einmal gehen nicht, ${zuviel} sind liegen geblieben`);
  if (!activeFile() || !usable(activeFile())) {
    const erste = state.files.find(usable);
    if (erste) { state.activeId = erste.id; erste.seen = true; }
  }
  applyMode();
  refresh();
}

function removeFile(id) {
  const i = state.files.findIndex((f) => f.id === id);
  if (i < 0) return;
  state.files.splice(i, 1);
  if (state.activeId === id) {
    const naechste = state.files.find(usable);
    state.activeId = naechste ? naechste.id : null;
    if (naechste) naechste.seen = true;
  }
  applyMode();
  if (!fileMode()) { docRun++; autosize(el.src); refreshText(); return; }
  renderDocs();
  showActive();
}

function downloadOne(f) {
  if (!f || !usable(f) || f.out == null) return;
  download(f.outName, f.out, MIME[f.kind]);
  const n = learnFrom(f.hits || []);
  if (n) { renderDictCount(); if (f.id === state.activeId) f.seen = true; renderDocs(); }
  toast(n ? `Gespeichert: ${f.outName}, ${n} Begriff${n === 1 ? "" : "e"} im Wörterbuch gemerkt` : "Gespeichert: " + f.outName);
}

el.docsList.addEventListener("click", (ev) => {
  const kill = ev.target.closest("[data-kill]");
  if (kill) { removeFile(kill.dataset.kill); return; }
  const dl = ev.target.closest("[data-dl]");
  if (dl) { downloadOne(state.files.find((f) => f.id === dl.dataset.dl)); return; }
  const row = ev.target.closest("[data-f]");
  if (row) activate(row.dataset.f);
});

el.fileInput.addEventListener("change", () => { addFiles(el.fileInput.files); el.fileInput.value = ""; });
el.fileLink.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); el.fileInput.click(); }
});

el.btnCopyHint.addEventListener("click", async () => {
  if (await copy(hintText())) toast("Hinweis für die KI kopiert");
  else toast("Kopieren nicht möglich");
});
// „Tabelle kopieren“: die geschützte Tabelle Tab-getrennt plus als HTML-Tabelle, wie Excel es bei Strg+C liefert.
// Zählt wie ein Download: die Vermutungen in dieser Datei wandern ins Wörterbuch.
el.btnCopyTable.addEventListener("click", async () => {
  const f = activeFile();
  if (!f || !TABLE_KINDS.has(f.kind) || !usable(f) || !f.text) return;
  const t = tableClipboard(f.text, f.delim);
  if (!(await copyRich(t.text, t.html))) { toast("Kopieren nicht möglich"); return; }
  const n = learnFrom(f.hits || []);
  f.seen = true;
  renderDictCount(); renderDocs();
  toast(`Tabelle kopiert: ${t.rows} Zeile${t.rows === 1 ? "" : "n"}, ${t.columns} Spalte${t.columns === 1 ? "" : "n"}${n ? `, ${n} Begriff${n === 1 ? "" : "e"} im Wörterbuch gemerkt` : ""}`);
  track("copy_table");
});
el.btnClearFiles.addEventListener("click", () => {
  docRun++;
  state.files = []; state.activeId = null;
  applyMode(); autosize(el.src); refreshText();
  toast("Dateien entfernt. Das Wörterbuch bleibt.");
});
el.btnZip.addEventListener("click", async () => {
  const gut = state.files.filter((f) => usable(f) && f.out != null);
  if (!gut.length) return;
  try {
    const bytes = await buildZip([...gut.map((f) => ({ name: f.outName, bytes: f.out })), { name: "KI-Hinweis.txt", text: hintText() }]);
    download("Deckname-geschuetzt.zip", bytes, "application/zip");
    const n = learnFrom(gut.flatMap((f) => f.hits || []));
    if (n) { renderDictCount(); for (const f of gut) f.seen = true; renderDocs(); }
    toast(`${gut.length} Datei${gut.length === 1 ? "" : "en"} und der KI-Hinweis liegen im ZIP${n ? `, ${n} Begriff${n === 1 ? "" : "e"} im Wörterbuch gemerkt` : ""}`);
  } catch { toast("Das ZIP ließ sich nicht bauen"); }
});

// ---------- Schritt 2: eine geschützte Datei zurückübersetzen ----------
function backName(name, kind) {
  const base = String(name).replace(/\.[A-Za-z0-9]+\s*$/, "").replace(/\.geschuetzt$/i, "");
  return safeName(base) + ".zurueck." + kind;
}
async function backFile(file) {
  if (!file) return;
  const kind = kindOf(file.name);
  if (!kind || kind === "pdf") { toast("Zurück gehen Word, PowerPoint, Textdateien und Tabellen (csv, tsv)."); return; }
  const grund = rejectReason(file.name, file.size);
  if (grund) { toast(grund); return; }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (kind === "docx" || kind === "pptx") {
      const res = await restoreOffice(bytes, kind, (t) => restore(t, mapping()));
      if (!res.count) { toast("Keine Platzhalter in der Datei gefunden"); return; }
      download(backName(file.name, kind), res.bytes, MIME[kind]);
      if (!state.counted.restore) { state.counted.restore = true; track("restore"); }
      toast(`Zurückgeholt: ${res.count} Platzhalter, Datei gespeichert`);
    } else if (TABLE_KINDS.has(kind)) {
      // Eine Tabelle kommt als Datei zurück, mit denselben Trennern und Umbrüchen, als UTF-8 mit BOM
      const res = restore(decodeText(bytes).text, mapping());
      if (!res.count) { toast("Keine Platzhalter in der Tabelle gefunden"); return; }
      download(backName(file.name, kind), utf8WithBom(res.text), MIME[kind]);
      if (!state.counted.restore) { state.counted.restore = true; track("restore"); }
      toast(`Zurückgeholt: ${res.count} Platzhalter, Tabelle gespeichert (CSV UTF-8)`);
    } else {
      el.ai.value = decodeText(bytes).text;
      state.counted.restore = false;
      autosize(el.ai); refreshResult();
      el.ai.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  } catch (err) { toast(fehlerText(err)); }
}
el.btnFileBack.addEventListener("click", () => el.fileBack.click());
el.fileBack.addEventListener("change", () => { backFile(el.fileBack.files?.[0]); el.fileBack.value = ""; });

// ---------- Ablegen per Maus ----------
const hatDateien = (ev) => [...(ev.dataTransfer?.types || [])].includes("Files");
function dropZone(node, onFiles) {
  let tiefe = 0;
  node.addEventListener("dragenter", (ev) => {
    if (!hatDateien(ev)) return;
    ev.preventDefault(); tiefe++; node.classList.add("over");
  });
  node.addEventListener("dragover", (ev) => {
    if (!hatDateien(ev)) return;
    ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; node.classList.add("over");
  });
  node.addEventListener("dragleave", () => { tiefe = Math.max(0, tiefe - 1); if (!tiefe) node.classList.remove("over"); });
  node.addEventListener("drop", (ev) => {
    if (!hatDateien(ev)) return;
    ev.preventDefault(); tiefe = 0; node.classList.remove("over");
    const files = [...(ev.dataTransfer?.files || [])];
    if (files.length) onFiles(files);
  });
}
dropZone(el.step1, (files) => addFiles(files));
dropZone(el.step2, (files) => backFile(files[0]));

// ---------- Onboarding ----------
const EXAMPLE = `Hallo Sabine,

danke für das Gespräch gestern mit Herrn Dr. Hoffmann von der Nordlicht Medien GmbH. Wie besprochen übernimmt Katrin Schulz ab Oktober die Koordination, erreichbar unter katrin.schulz@example.org oder +49 172 5551234.

Die Rechnung geht an die Sparkasse Hohenmoor, IBAN DE89 3704 0044 0532 0130 00, Kunden-Nr. 4471-2209. Der Drehort bleibt Musterstraße 12a, 14482 Potsdam.

Viele Grüße
Max Berger`;

function loadExample() {
  if (fileMode()) { docRun++; state.files = []; state.activeId = null; applyMode(); }
  el.src.value = EXAMPLE; autosize(el.src); refresh(); track("example");
}
el.btnExample.addEventListener("click", () => {
  loadExample();
  el.src.scrollIntoView({ behavior: "smooth", block: "start" });
});
// Die Tour ist standardmäßig zu und lässt sich über „So funktioniert es" öffnen
el.btnTour.addEventListener("click", () => { el.tour.hidden = !el.tour.hidden; el.btnTour.setAttribute("aria-expanded", String(!el.tour.hidden)); });
el.btnTourDone.addEventListener("click", () => { el.tour.hidden = true; el.btnTour.setAttribute("aria-expanded", "false"); state.settings.tourDone = true; save(); });

// ---------- Start ----------
load();
el.preambleOn.checked = state.settings.preamble !== false;
el.tour.hidden = true;
renderInstall();
// Läuft Deckname als installierte App? Einmal pro Start zählen, damit wir sehen, ob die Hülle genutzt wird.
if (window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true) track("app_open");
el.btnPasteSrc.hidden = !canRead();
el.btnPasteAi.hidden = !canRead();
renderDictCount();
applyMode();
autosize(el.src); autosize(el.ai);
// /deckname?beispiel=1: ein Link von der Startseite landet nicht auf einem leeren Werkzeug
if (new URLSearchParams(location.search).has("beispiel") && !el.src.value.trim()) loadExample();
else refresh();
if (!state.storageOk) toast("Kein Browserspeicher verfügbar: das Wörterbuch gilt nur für diesen Besuch");
else if (migrated) toast(`Wörterbuch aufgeräumt: ${migrated} Kontaktdaten und Nummern entfernt, die werden nicht mehr gespeichert`);
