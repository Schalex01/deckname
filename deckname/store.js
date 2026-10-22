// Deckname · Speicherregeln (reine Funktionen, keine DOM-Abhängigkeit, laufen auch in Node für die Tests).
//
// Zwei Ablagen seit 0.4 (seit 0.5 außerdem: Schreibweisen als Chips, Karten zusammenlegen, Rückweg-Form):
//   Wörterbuch (localStorage, dauerhaft): von Hand markierte Begriffe sofort, Vermutungen und Adressen erst,
//     wenn der geschützte Text kopiert oder eine Datei heruntergeladen wurde. Platzhalter-Nummern 1 bis 899.
//   Flüchtig (sessionStorage, nur dieser Tab): alles, was die Erkennung gerade gefunden hat. Nummern ab 10000,
//     damit sie nie mit dem Wörterbuch kollidieren. Mailadressen, Telefonnummern, IBANs, Kartennummern und
//     Steuer-IDs bleiben immer flüchtig: sicher am Muster erkannt, nie automatisch gelernt.

import { placeholderNumber, makeId, normalizeKey } from "./engine.js";

export const STORE_VERSION = 5;
export const DICT_MIN = 1, DICT_MAX = 899;
export const VOLATILE_MIN = 10000, VOLATILE_MAX = 99999;

// Typen, die aus der Mustererkennung (regex) nie ins Wörterbuch wandern.
const NEVER_LEARN = new Set(["MAIL", "TELEFON", "IBAN", "KARTE", "NUMMER"]);

/** Darf ein flüchtiger Eintrag beim Kopieren oder Herunterladen gelernt werden? */
export function learnable(entry) {
  if (!entry) return false;
  if (entry.origin === "manual") return true;
  if (entry.origin === "regex") return !NEVER_LEARN.has(entry.type);
  return true; // guess
}

/** Nächste freie Nummer eines Typs im Bereich [min, max], unter Berücksichtigung aller belegten Platzhalter. */
export function nextFreeNumber(type, takenPlaceholders, min, max) {
  const used = new Set();
  for (const p of takenPlaceholders) { const n = placeholderNumber(p, type); if (n) used.add(n); }
  for (let k = min; k <= max; k++) if (!used.has(k)) return k;
  return max;
}

/** Alle belegten Platzhalter, auch die alten einer zusammengelegten Karte (altLabels): die bleiben reserviert. */
export function allPlaceholders(dict, volatile = [], former = []) {
  const out = [];
  for (const e of [...dict, ...volatile, ...former]) {
    out.push(e.placeholder);
    for (const a of e.altLabels || []) out.push(a);
  }
  return out;
}

export function freeDictPlaceholder(type, dict, volatile = [], former = [], preferred = null) {
  const taken = new Set(allPlaceholders(dict, volatile, former));
  if (preferred && !taken.has(preferred)) return preferred;
  return type + "_" + nextFreeNumber(type, taken, DICT_MIN, DICT_MAX);
}

export function freeVolatilePlaceholder(type, dict, volatile = [], former = []) {
  const taken = new Set(allPlaceholders(dict, volatile, former));
  return type + "_" + nextFreeNumber(type, taken, VOLATILE_MIN, VOLATILE_MAX);
}

/**
 * Flüchtige Einträge ins Wörterbuch übernehmen (der Klick auf Kopieren/Herunterladen ist die Bestätigung).
 * ids: welche flüchtigen Einträge gerade im Text standen. Nicht lernbare bleiben flüchtig.
 * Liefert {dict, volatile, former, learned}: former merkt sich den alten Platzhalter für den Rückweg,
 * weil der kopierte Text noch PERSON_10001 enthält, das Wörterbuch aber PERSON_3 vergibt.
 */
export function promote(dict, volatile, former, ids, origin = "confirmed") {
  const want = new Set(ids);
  const outDict = [...dict], outVol = [], outFormer = [...former], learned = [];
  for (const e of volatile) {
    if (!want.has(e.id) || !learnable(e)) { outVol.push(e); continue; }
    const placeholder = freeDictPlaceholder(e.type, outDict, outVol.concat(volatile), outFormer);
    outFormer.push({ placeholder: e.placeholder, original: e.original, type: e.type });
    const entry = { id: e.id, original: e.original, aliases: e.aliases || [], type: e.type, placeholder, origin };
    outDict.push(entry); learned.push(entry);
  }
  return { dict: outDict, volatile: outVol, former: outFormer, learned };
}

/**
 * Rückweg: Wörterbuch, flüchtige Einträge, die alten Platzhalter schon gelernter Begriffe und die alten
 * Platzhalter zusammengelegter Karten (altLabels). Ein Text mit FIRMA_3 kommt also auch dann zurück,
 * wenn FIRMA_3 inzwischen in FIRMA_1 aufgegangen ist. Zurück kommt immer die Rückweg-Form (original).
 */
export function restoreMapping(dict, volatile = [], former = []) {
  const out = [];
  for (const e of [...dict, ...volatile, ...former]) {
    out.push({ placeholder: e.placeholder, original: e.original });
    for (const a of e.altLabels || []) out.push({ placeholder: a, original: e.original });
  }
  return out;
}

// ---------- Schreibweisen, Rückweg-Form, Zusammenlegen (seit 0.5) ----------

const same = (a, b) => normalizeKey(String(a)) === normalizeKey(String(b));
const uniq = (list) => {
  const out = [];
  for (const s of list) if (s && String(s).trim() && !out.some((o) => same(o, s))) out.push(String(s).trim());
  return out;
};

/** Alle Schreibweisen einer Karte: Rückweg-Form zuerst, dann die weiteren. */
export function spellings(entry) {
  return uniq([entry.original, ...(entry.aliases || [])]);
}

/** Eine Schreibweise dazu (reine Funktion, gibt die neue Karte zurück). Doppelte und die Rückweg-Form selbst werden ignoriert. */
export function addAlias(entry, text) {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t || spellings(entry).some((s) => same(s, t))) return entry;
  return { ...entry, aliases: [...(entry.aliases || []), t] };
}

/** Eine Schreibweise weg. Die Rückweg-Form lässt sich so nicht entfernen. */
export function removeAlias(entry, text) {
  return { ...entry, aliases: (entry.aliases || []).filter((a) => !same(a, text)) };
}

/**
 * Rückweg-Form ändern („FIRMA_3 zurück zu Muster GmbH“). Die alte Form bleibt als Schreibweise geschützt,
 * damit sie im nächsten Text weiter zu FIRMA_3 wird. Steht die neue Form schon als Schreibweise da, rückt sie nach vorn.
 */
export function setRestoreForm(entry, text) {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t || same(t, entry.original)) return entry;
  const aliases = uniq([...(entry.aliases || []).filter((a) => !same(a, t)), entry.original]);
  return { ...entry, original: t, aliases };
}

/** Welche Karte (außer der eigenen) trägt diese Schreibweise? */
export function findBySpelling(dict, text, exceptId = null) {
  const key = normalizeKey(String(text || ""));
  if (!key) return null;
  return dict.find((e) => e.id !== exceptId && spellings(e).some((s) => normalizeKey(s) === key)) || null;
}

/**
 * Vorschläge beim Tippen im Schreibweisen-Feld: Karten, deren Schreibweise die Eingabe enthält.
 * Liefert [{entry, hit}] mit der getroffenen Schreibweise, höchstens max Stück.
 */
export function suggestCards(dict, query, exceptId = null, max = 5) {
  const q = normalizeKey(String(query || ""));
  if (q.length < 2) return [];
  const out = [];
  for (const e of dict) {
    if (e.id === exceptId) continue;
    const hit = spellings(e).find((s) => normalizeKey(s).includes(q));
    if (hit) out.push({ entry: e, hit });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Karte source in Karte target aufnehmen. Alle Schreibweisen von source werden Schreibweisen von target,
 * ihr Platzhalter (und ihre eigenen altLabels) wandern in target.altLabels, damit alte Texte im Rückweg
 * weiter aufgehen und die Nummer nie neu vergeben wird. Die Karte selbst bleibt in target.merged, damit
 * ein × am gestrichelten Chip sie unverändert zurückholt. Reine Funktion: liefert das neue Wörterbuch.
 */
export function mergeInto(dict, targetId, sourceId) {
  const target = dict.find((e) => e.id === targetId);
  const source = dict.find((e) => e.id === sourceId);
  if (!target || !source || target === source) return dict;
  const merged = { ...target, aliases: uniq([...(target.aliases || []), ...spellings(source)].filter((a) => !same(a, target.original))) };
  merged.altLabels = uniq([...(target.altLabels || []), source.placeholder, ...(source.altLabels || [])]);
  const card = { ...source }; delete card.merged;
  // Hat source selbst schon Karten aufgenommen, hängen die jetzt an target und bleiben einzeln zurückholbar
  merged.merged = [...(target.merged || []), card, ...(source.merged || []).map((m) => ({ ...m }))];
  return dict.map((e) => (e === target ? merged : e)).filter((e) => e !== source);
}

/**
 * Eine aufgenommene Karte wieder herauslösen: ihre Schreibweisen und Platzhalter verlassen target,
 * die Karte steht wieder eigenständig im Wörterbuch (direkt hinter target).
 */
export function unmerge(dict, targetId, mergedId) {
  const target = dict.find((e) => e.id === targetId);
  const card = (target && target.merged || []).find((m) => m.id === mergedId);
  if (!target || !card) return dict;
  const cardSpell = spellings(card);
  const cardLabels = [card.placeholder, ...(card.altLabels || [])];
  const rest = {
    ...target,
    aliases: (target.aliases || []).filter((a) => !cardSpell.some((s) => same(s, a))),
    altLabels: (target.altLabels || []).filter((l) => !cardLabels.includes(l)),
    merged: target.merged.filter((m) => m.id !== mergedId),
  };
  if (!rest.altLabels.length) delete rest.altLabels;
  if (!rest.merged.length) delete rest.merged;
  const back = { ...card, aliases: (card.aliases || []).filter((a) => !same(a, card.original)) };
  const out = [];
  for (const e of dict) { out.push(e === target ? rest : e); if (e === target) out.push(back); }
  return out;
}

/** Zu welcher aufgenommenen Karte gehört diese Schreibweise auf der Karte? (für den gestrichelten Chip) */
export function mergedOwner(entry, text) {
  for (const m of entry.merged || []) if (spellings(m).some((s) => same(s, text))) return m;
  return null;
}

// Wörter, die zwei Firmen nicht ähnlich machen
const KERN_IGNORE = new Set([
  "gmbh", "mbh", "ag", "kg", "ug", "se", "ohg", "gbr", "kgaa", "ltd", "inc", "llc", "holding", "group", "gruppe",
  "herr", "herrn", "frau", "dr", "prof", "strasse", "straße", "weg", "platz", "allee", "sparkasse", "volksbank", "bank",
  "und", "the", "and", "von", "der", "die", "das", "des", "dem", "den",
]);

/** Wortkerne einer Karte: Wörter ab vier Buchstaben, klein, ohne Rechtsformen. */
export function wordCores(entry) {
  const out = new Set();
  for (const s of spellings(entry)) {
    for (const w of normalizeKey(s).split(/[^\p{L}\p{N}]+/u)) {
      if (w.length >= 4 && !KERN_IGNORE.has(w)) out.add(w);
    }
  }
  return out;
}

function coresOverlap(a, b) {
  for (const x of a) for (const y of b) {
    if (x === y) return true;
    // Genitiv und Endungen: „muster" und „musters", „meyer" und „meyers"
    if ((x.startsWith(y) || y.startsWith(x)) && Math.min(x.length, y.length) >= 4) return true;
  }
  return false;
}

/**
 * Karten, die einer anderen ähnlich sind: gleicher Typ und ein gemeinsamer Wortkern ab vier Buchstaben.
 * Liefert für eine Karte die Partner (die App zeigt „Ähnlich: FIRMA_3 Muster GmbH“, Klick legt zusammen).
 */
export function similarCards(dict, entry) {
  const mine = wordCores(entry);
  if (!mine.size) return [];
  return dict.filter((e) => e !== entry && e.id !== entry.id && e.type === entry.type && coresOverlap(mine, wordCores(e)));
}

/**
 * Migration der gespeicherten Daten. 0.3 (kein version-Feld) hat jeden Treffer dauerhaft gemerkt, auch
 * Mailadressen und Nummern (origin "regex"). Die fliegen raus, alles andere bleibt. Liefert {data, removed}.
 */
export function migrate(raw) {
  const data = raw && typeof raw === "object" ? { ...raw } : {};
  data.dict = Array.isArray(data.dict) ? data.dict.filter((e) => e && e.original && e.type && e.placeholder) : [];
  data.ignored = Array.isArray(data.ignored) ? data.ignored.filter((e) => e && e.text) : [];
  data.settings = data.settings && typeof data.settings === "object" ? data.settings : {};
  let removed = [];
  const version = +data.version || 0;
  if (version < 4) {
    removed = data.dict.filter((e) => e.origin === "regex");
    data.dict = data.dict.filter((e) => !removed.includes(e));
    // Einträge ohne gültige Nummer im Wörterbuchbereich neu nummerieren (0.3 kannte keine Bereiche)
    for (const e of data.dict) {
      const n = placeholderNumber(e.placeholder, e.type);
      if (n && (n < DICT_MIN || n > DICT_MAX)) e.placeholder = freeDictPlaceholder(e.type, data.dict.filter((x) => x !== e));
      if (!e.id) e.id = makeId();
    }
  }
  // 0.5: optionale Felder altLabels (alte Platzhalter aufgenommener Karten) und merged (die Karten selbst)
  for (const e of data.dict) {
    if (e.altLabels !== undefined && !Array.isArray(e.altLabels)) delete e.altLabels;
    if (Array.isArray(e.altLabels)) { e.altLabels = e.altLabels.filter((x) => typeof x === "string" && x); if (!e.altLabels.length) delete e.altLabels; }
    if (e.merged !== undefined && !Array.isArray(e.merged)) delete e.merged;
    if (Array.isArray(e.merged)) { e.merged = e.merged.filter((m) => m && m.id && m.original && m.type && m.placeholder); if (!e.merged.length) delete e.merged; }
  }
  data.version = STORE_VERSION;
  return { data, removed };
}
