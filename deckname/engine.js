// Deckname: Erkennungs- und Ersetzungs-Engine.
// Reine Funktionen, keine DOM-Abhängigkeit. Läuft im Browser (ES-Modul) und in Node (Tests).
// Grundsatz: deterministisch und erklärbar. Kein ML, keine Netzwerkaufrufe.

import { VORNAMEN, VORNAMEN_AUSSCHLUSS, VORNAMEN_KURZ } from "./vornamen.js";

export const TYPES = ["PERSON", "FIRMA", "ORT", "MAIL", "TELEFON", "IBAN", "KARTE", "NUMMER", "SONSTIGES"];
export const TYPE_LABEL = {
  PERSON: "Person", FIRMA: "Firma", ORT: "Ort / Adresse", MAIL: "E-Mail", TELEFON: "Telefon",
  IBAN: "IBAN", KARTE: "Kartennummer", NUMMER: "Nummer", SONSTIGES: "Sonstiges",
};
// Was der Nutzer per Hand markieren kann (Regex-Typen vergibt nur die Engine).
export const MANUAL_TYPES = ["PERSON", "FIRMA", "ORT", "NUMMER", "SONSTIGES"];

// volatile = flüchtige Sitzungseinträge (Vermutungen und Regex-Treffer vor dem Kopieren): schlagen die rohe Erkennung,
// damit Platzhalter und Umbenennungen in der Sitzung stabil bleiben, aber nie einen Wörterbucheintrag.
const PRIORITY = { manual: 4, dict: 3, volatile: 2.5, regex: 2, guess: 1 };

// Großgeschriebene Wörter, die nie Teil eines Namens sind (Satzanfänge, Grußformeln, Wochentage …).
const STOP = new Set([
  "Und", "Oder", "Aber", "Der", "Die", "Das", "Den", "Dem", "Des", "Ein", "Eine", "Einen", "Einem", "Einer",
  "Ich", "Du", "Wir", "Ihr", "Sie", "Er", "Es", "Man", "Mein", "Meine", "Dein", "Deine", "Sein", "Seine", "Unser", "Unsere",
  "Am", "Im", "Ab", "An", "Auf", "Aus", "Bei", "Bis", "Mit", "Von", "Vom", "Zu", "Zum", "Zur", "Nach", "Vor", "Über", "Für", "Um", "Als", "Wie", "Wenn", "Weil", "Dass", "Ob",
  "Danke", "Hallo", "Hi", "Hey", "Liebe", "Lieber", "Grüße", "Gruß", "Viele", "Beste", "Herzliche", "Herzlichen", "Freundliche", "Sehr", "Guten", "Gute", "Morgen", "Tag", "Abend",
  "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag",
  "Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember",
  "Heute", "Gestern", "Morgen", "Bitte", "Betreff", "Anbei", "Hier", "Dort", "Dann", "Jetzt", "Noch", "Schon", "Auch", "Nur", "Nicht", "Kein", "Keine",
  "Team", "Firma", "Kunde", "Kundin", "Projekt", "Meeting", "Termin", "Angebot", "Rechnung", "Vertrag",
]);

const CAP = "[A-ZÄÖÜ][\\p{L}'’.-]*";   // darf Punkte enthalten (Dr., Co.)
const CAPW = "[A-ZÄÖÜ][\\p{L}'’-]*";   // ein Wort ohne Punkt (Nachnamen, Orte)
const WORD_BEFORE = "(?<![\\p{L}\\p{N}])";
const WORD_AFTER = "(?![\\p{L}\\p{N}])";

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeKey(s) {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

// ---------- Prüfsummen ----------

export function luhnValid(digits) {
  const d = digits.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

export function ibanValid(raw) {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= "A" ? (ch.charCodeAt(0) - 55).toString() : ch;
    for (const c of v) rem = (rem * 10 + +c) % 97;
  }
  return rem === 1;
}

// Deutsche Steuer-ID (11 Ziffern, ISO 7064 Mod 11,10)
export function steuerIdValid(raw) {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 11 || d[0] === "0") return false;
  let prod = 10;
  for (let i = 0; i < 10; i++) {
    let sum = (+d[i] + prod) % 10;
    if (sum === 0) sum = 10;
    prod = (sum * 2) % 11;
  }
  let check = 11 - prod;
  if (check === 10) check = 0;
  return check === +d[10];
}

// ---------- Erkennung ----------

function pushAll(list, re, text, fn) {
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    const r = fn(m);
    if (r) list.push(r);
  }
}

function dictMatches(text, dict, source) {
  const out = [];
  for (const entry of dict) {
    const variants = [entry.original, ...(entry.aliases || [])].filter(Boolean);
    for (const v of variants) {
      const pattern = esc(v.trim()).replace(/\s+/g, "\\s+");
      if (!pattern) continue;
      // Genitiv-s bleibt stehen: „Sabines Auto" → „PERSON_1s Auto", ersetzt wird nur der Begriff selbst
      const re = new RegExp(WORD_BEFORE + pattern + "(?=(?:['’]?s)?" + WORD_AFTER + ")", "giu");
      pushAll(out, re, text, (m) => ({
        start: m.index, end: m.index + m[0].length, text: m[0], type: entry.type,
        source, dictId: entry.id,
        reason: source === "manual" ? "Von Ihnen markiert" : source === "volatile" ? (entry.reason || "Vermutung, noch nicht gemerkt") : "Im Wörterbuch",
      }));
    }
  }
  return out;
}

function regexMatches(text) {
  const out = [];
  const add = (m, type, reason, group = 0) => {
    const s = m.index + m[0].indexOf(m[group]);
    const t = m[group].replace(/[.,;:!?]+$/, ""); // Satzzeichen am Ende gehören zum Satz, nicht zum Treffer
    return { start: s, end: s + t.length, text: t, type, source: "regex", reason };
  };

  pushAll(out, /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu, text, (m) => add(m, "MAIL", "E-Mail-Adresse"));

  // IBAN mit Prüfsumme
  pushAll(out, /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g, text, (m) =>
    ibanValid(m[0]) ? add(m, "IBAN", "IBAN, Prüfsumme stimmt") : null);

  // Kartennummer (Luhn)
  pushAll(out, /\b(?:\d[ -]?){12,18}\d\b/g, text, (m) => luhnValid(m[0]) ? add(m, "KARTE", "Kartennummer, Prüfsumme stimmt") : null);

  // Steuer-ID
  pushAll(out, /\b\d{2}\s?\d{3}\s?\d{3}\s?\d{3}\b/g, text, (m) => steuerIdValid(m[0]) ? add(m, "NUMMER", "Steuer-ID, Prüfsumme stimmt") : null);

  // Telefon: mit + oder führender 0, mindestens 7 Ziffern, keine Datumsform
  pushAll(out, /(?:\+\d{1,3}[ \-]?\(?\d+\)?(?:[ \-\/]?\d+){1,6}|(?<!\d|\d[.,])0\d{2,5}[ \-\/]?\d+(?:[ \-\/]?\d+){0,4})(?!\d|[.,]\d)/g, text, (m) => {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 16) return null;
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(m[0])) return null;
    return add(m, "TELEFON", "Telefonnummer");
  });

  // Straße + Hausnummer
  pushAll(out, new RegExp("\\b(" + CAP + "(?:straße|strasse|str\\.|weg|allee|platz|gasse|ring|damm|ufer|chaussee|steig|promenade)[ \\t]+\\d{1,4}[ \\t]?[a-zA-Z]?)" + WORD_AFTER, "gu"), text,
    (m) => add(m, "ORT", "Straße mit Hausnummer", 1));

  // PLZ + Ort
  pushAll(out, new RegExp("\\b(\\d{5}[ \\t]+" + CAPW + "(?:[ \\t](?:am|an der|im|bei|an)[ \\t]" + CAPW + ")?)" + WORD_AFTER, "gu"), text,
    (m) => add(m, "ORT", "Postleitzahl mit Ort", 1));

  return out;
}

// Vermutungen bleiben in einer Zeile: [ \t] statt \s, sonst klebt eine Firma in der Kopfzeile an einem Namen im Fließtext.
function guessMatches(text) {
  const out = [];
  const add = (start, len, type, reason) => {
    const t = text.slice(start, start + len).replace(/(?<!\b(?:i\.G|e\.V|Co|Inc|Ltd))[,;:!?]+$/, "").replace(/(?<![A-Za-z]\.[A-Za-z])\.$/, "");
    return { start, end: start + t.length, text: t, type, source: "guess", reason };
  };

  // Anrede + Name (max. 3 Namensteile, stoppt an Satzzeichen und Stoppwörtern)
  pushAll(out, new RegExp("\\b(?:Herrn?|Frau|Hr\\.|Fr\\.|Dr\\.|Prof\\.)[ \\t]+((?:(?:Dr\\.|Prof\\.)[ \\t]+)?" + CAP + "(?:[ \\t]+" + CAP + "){0,2})", "gu"), text, (m) => {
    const trimmed = trimName(m[1]);
    if (!trimmed) return null;
    const s = m.index + m[0].indexOf(m[1]);
    return add(s, trimmed.length, "PERSON", "Anrede davor");
  });

  // Firma: Name + Rechtsform
  pushAll(out, new RegExp("((?:" + CAP + "(?:[ \\t]+(?:&|und)[ \\t]+)?[ \\t]*){1,4}(?:GmbH|AG|eG|KG|UG|SE|OHG|GbR|KGaA|mbH|Ltd\\.?|Inc\\.?|LLC|e\\.[ \\t]?V\\.))(?:[ \\t]*&[ \\t]*Co\\.?[ \\t]*KG)?(?:[ \\t]*i\\.[ \\t]?G\\.)?(?:[ \\t]*\\(haftungsbeschränkt\\))?", "gu"), text, (m) => {
    // Führende Stoppwörter abschneiden („Die Nordwind Sisters GmbH" → „Nordwind Sisters GmbH")
    let s = m.index, full = m[0];
    for (;;) {
      const first = /^(\S+)(\s+)/u.exec(full);
      if (!first || !STOP.has(first[1].replace(/[^\p{L}]/gu, ""))) break;
      s += first[0].length;
      full = full.slice(first[0].length);
    }
    return add(s, full.length, "FIRMA", "Rechtsform am Ende");
  });

  // Bank/Sparkasse + Ortsname
  pushAll(out, new RegExp("\\b((?:Stadt|Kreis)?[Ss]parkasse|Volksbank|Raiffeisenbank|VR-Bank|VR Bank|Genossenschaftsbank|Landesbank)[ \\t]+" + CAPW + "(?:[ \\t]+(?:am|an der|im|bei)[ \\t]+" + CAPW + "|[ \\t]+" + CAPW + ")?", "gu"), text,
    (m) => add(m.index, m[0].length, "FIRMA", "Bankname"));

  // Schlüsselwort + Nummer (Schlüsselwort beliebig geschrieben, der Wert nur Großbuchstaben/Ziffern)
  pushAll(out, /\b(?:BLZ|Konto(?:-?Nr\.?|nummer)|Kd\.?-?Nr\.?|Kunden(?:-?Nr\.?|nummer)|Vertrags(?:-?Nr\.?|nummer)|Personal(?:-?Nr\.?|nummer)|Mitarbeiter(?:-?Nr\.?|nummer)|Rechnungs(?:-?Nr\.?|nummer)|Aktenzeichen|Az\.|Versicherungs(?:-?Nr\.?|nummer)|Steuernummer|St\.-?Nr\.?|Ticket(?:-?Nr\.?|nummer)|Auftrags(?:-?Nr\.?|nummer))\s*:?\s*/gi, text, (m) => {
    const rest = text.slice(m.index + m[0].length);
    const v = /^[A-Z0-9][A-Z0-9\-\/.]*(?:[ ](?=[A-Z0-9\-\/.]*\d)[A-Z0-9\-\/.]+)*/.exec(rest);
    if (!v || v[0].replace(/\D/g, "").length < 3) return null;
    return add(m.index + m[0].length, v[0].length, "NUMMER", "Schlüsselwort davor");
  });

  // Vornamen aus der Liste, plus folgende großgeschriebene Wörter als Nachname
  const tokenRe = /[\p{L}'’.-]+/gu;
  let m;
  while ((m = tokenRe.exec(text)) !== null) {
    const tok = m[0].replace(/[.'’-]+$/, "");
    if (!isVorname(tok)) continue;
    let end = m.index + tok.length;
    const trailingPunct = /[.!?,;:]/.test(text[end] || "");
    let parts = 1;
    if (!trailingPunct) {
      let cursor = end;
      while (parts < 3) {
        const rest = text.slice(cursor);
        const nm = rest.match(new RegExp("^([ \\t]+)(" + CAPW + ")", "u"));
        if (!nm) break;
        const cand = nm[2].replace(/[.,;:!?]+$/, "");
        if (STOP.has(cand) || VORNAMEN_AUSSCHLUSS.has(cand) || cand.length < 2) break;
        cursor += nm[1].length + cand.length;
        end = cursor;
        parts++;
        if (/[.!?,;:]/.test(text[cursor] || "")) break;
      }
    }
    if (parts === 1 && VORNAMEN_KURZ.has(tok)) continue; // Kurzname ohne Nachnamen: zu unsicher
    out.push(add(m.index, end - m.index, "PERSON", parts > 1 ? "Vorname aus der Liste plus Nachname" : "Vorname aus der Liste"));
  }

  return out;
}

// Vorname aus der Liste; Doppelnamen wie Hans-Peter zählen, wenn beide Hälften Vornamen sind.
function isVorname(tok) {
  if (VORNAMEN_AUSSCHLUSS.has(tok)) return false;
  if (VORNAMEN.has(tok)) return true;
  const parts = tok.split("-");
  return parts.length > 1 && parts.every((p) => VORNAMEN.has(p) && !VORNAMEN_AUSSCHLUSS.has(p));
}

function trimName(s) {
  const parts = s.split(/\s+/);
  while (parts.length && STOP.has(parts[parts.length - 1].replace(/[^\p{L}]/gu, ""))) parts.pop();
  return parts.join(" ").replace(/[.,;:!?]+$/, "");
}

function resolveOverlaps(matches) {
  // Ein längerer Treffer gleichen Typs, der einen Wörterbuchtreffer ganz enthält, gewinnt:
  // steht „Sabine" im Wörterbuch und im Text „Sabine Meyer", wird der volle Name geschützt,
  // sonst bliebe „Meyer" im Klartext.
  const contained = new Set();
  for (const d of matches) {
    if (d.source !== "dict") continue;
    for (const g of matches) {
      if (g === d || g.type !== d.type || g.source === "manual") continue;
      if (!(g.start <= d.start && g.end >= d.end && (g.end - g.start) > (d.end - d.start))) continue;
      // Nur wenn ein ganzes weiteres Wort dazukommt („Sabine Meyer"), nicht bei bloßer Endung („Sabines")
      const prefix = g.text.slice(0, d.start - g.start), suffix = g.text.slice(d.end - g.start);
      if (/\s$/.test(prefix) || /^\s/.test(suffix)) { contained.add(d); break; }
    }
  }
  matches = matches.filter((m) => !contained.has(m));
  matches.sort((a, b) => (PRIORITY[b.source] - PRIORITY[a.source]) || ((b.end - b.start) - (a.end - a.start)) || (a.start - b.start));
  const taken = [];
  const out = [];
  for (const m of matches) {
    if (taken.some((t) => m.start < t.end && t.start < m.end)) continue;
    taken.push(m);
    out.push(m);
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Findet alle schützenswerten Stellen.
 * @param text Originaltext
 * @param dict dauerhafte Wörterbucheinträge [{id, original, aliases, type, placeholder}]
 * @param sessionDict flüchtige, per Hand markierte Einträge (gleiche Form)
 * @param disabled Set aus normalizeKey(text)+"|"+type, die der Nutzer abgewählt hat
 * @param volatile flüchtige Sitzungseinträge (gleiche Form, optional reason), nicht im Wörterbuch
 */
export function detect(text, dict = [], sessionDict = [], disabled = new Set(), volatile = []) {
  if (!text) return [];
  const all = [
    ...dictMatches(text, sessionDict, "manual"),
    ...dictMatches(text, dict, "dict"),
    ...dictMatches(text, volatile, "volatile"),
    ...regexMatches(text),
    ...guessMatches(text),
  ].filter((m) => m.end > m.start && m.text.trim().length > 0);
  const resolved = resolveOverlaps(all);
  return resolved.filter((m) => !disabled.has(normalizeKey(m.text) + "|" + m.type) && !disabled.has(normalizeKey(m.text) + "|*"));
}

// ---------- Platzhalter ----------

export function placeholderNumber(placeholder, type) {
  const m = new RegExp("^" + type + "_(\\d+)$").exec(placeholder || "");
  return m ? +m[1] : 0;
}

export function nextNumber(type, dict, session) {
  let max = 0;
  for (const e of dict) max = Math.max(max, placeholderNumber(e.placeholder, type));
  for (const e of session.entries) max = Math.max(max, placeholderNumber(e.placeholder, type));
  for (const p of Object.keys(session.map)) max = Math.max(max, placeholderNumber(p, type));
  return max + 1;
}

export function newSession() {
  return { entries: [], map: {} }; // entries: manuelle Einträge (session-only); map: placeholder → {original, type}
}

/**
 * Vergibt Platzhalter. Wörterbuch- und Sitzungseinträge behalten ihren; alles andere bekommt
 * je Text+Typ einen festen Platzhalter für diese Sitzung.
 */
export function assignPlaceholders(matches, dict, session, volatile = []) {
  const byId = new Map(dict.map((e) => [e.id, e]));
  const sessById = new Map(session.entries.map((e) => [e.id, e]));
  const volById = new Map(volatile.map((e) => [e.id, e]));
  const byKey = new Map(); // normalizeKey(text)|type → placeholder (Sitzung)
  for (const [ph, v] of Object.entries(session.map)) byKey.set(normalizeKey(v.original) + "|" + v.type, ph);

  return matches.map((m) => {
    let placeholder, remembered = false;
    if (m.source === "dict" && byId.has(m.dictId)) {
      placeholder = byId.get(m.dictId).placeholder; remembered = true;
    } else if (m.source === "manual" && sessById.has(m.dictId)) {
      placeholder = sessById.get(m.dictId).placeholder;
    } else if (m.source === "volatile" && volById.has(m.dictId)) {
      placeholder = volById.get(m.dictId).placeholder;
    } else {
      const key = normalizeKey(m.text) + "|" + m.type;
      placeholder = byKey.get(key);
      if (!placeholder) {
        placeholder = m.type + "_" + nextNumber(m.type, dict, session);
        session.map[placeholder] = { original: m.text.trim(), type: m.type };
        byKey.set(key, placeholder);
      }
    }
    return { ...m, placeholder, remembered };
  });
}

export function protect(text, items) {
  let out = "", pos = 0;
  const used = new Map();
  for (const it of items) {
    out += text.slice(pos, it.start) + it.placeholder;
    pos = it.end;
    used.set(it.placeholder, it.type);
  }
  out += text.slice(pos);
  return { text: out, used: [...used].map(([placeholder, type]) => ({ placeholder, type })) };
}

export function buildPreamble(used) {
  if (!used.length) return "";
  const list = used.map((u) => `${u.placeholder} (${TYPE_LABEL[u.type] || u.type})`).join(", ");
  return "Hinweis: Dieser Text enthält Platzhalter für Namen und Daten. Bitte übernimm sie unverändert in deine Antwort und erfinde keine Namen dafür. Verwendete Platzhalter: " + list + ".\n\n---\n\n";
}

// ---------- Rückweg ----------

function placeholderPattern(ph) {
  // PERSON_1 → PERSON[ _-]?1 ; CHEF_M → CHEF[ _-]?M ; toleriert **fett**, __fett__, `code`, <spitz>, [eckig], {geschweift}.
  // Runde Klammern bleiben Text („(PERSON_1)" wird zu „(Max)"), weil sie im Fließtext normal sind.
  const core = esc(ph).replace(/_/g, "[ _-]?");
  const bare = "(?<![\\p{L}\\p{N}_])" + core + "(?![\\p{L}\\p{N}])";
  const wrapped = ["<" + bare + ">", "\\[" + bare + "\\]", "\\{" + bare + "\\}", "\\*\\*" + bare + "\\*\\*", "__" + bare + "__", "`" + bare + "`", bare];
  return "(?:" + wrapped.join("|") + ")";
}

/**
 * Setzt Originale wieder ein. mapping: [{placeholder, original}]
 * Liefert Text + Liste der Treffer (für die Hervorhebung) + Anzahl.
 */
/** Platzhalter, die nach dem Rückweg noch im Text stehen (unbekannt, z. B. aus einem anderen Wörterbuch).
 * KI-Antworten schreiben auch „Firma 3" oder „Person_9". Kleinschreibung mit Leerzeichen zählt aber nur bei kurzen
 * Zahlen ohne führende Null, sonst wird „Telefon 0431 …" als TELEFON_431 gemeldet. */
export function leftoverPlaceholders(text) {
  const re = new RegExp("(?<![\\p{L}\\p{N}_])(" + TYPES.join("|") + ")([ _-]?)(\\d+)(?![\\p{L}\\p{N}])", "giu");
  const out = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    const upper = m[1] === m[1].toUpperCase();
    const joined = m[2] === "_" || m[2] === "-";
    if (!upper && !joined && (m[3].length > 2 || m[3][0] === "0")) continue;
    out.add(m[1].toUpperCase() + "_" + parseInt(m[3], 10));
  }
  return [...out];
}

export function restore(text, mapping) {
  if (!text || !mapping.length) return { text: text || "", spans: [], count: 0, leftover: leftoverPlaceholders(text || "") };
  const sorted = [...mapping].sort((a, b) => b.placeholder.length - a.placeholder.length);
  const re = new RegExp(sorted.map((m) => "(" + placeholderPattern(m.placeholder) + ")").join("|"), "giu");
  const spans = [];
  let count = 0;
  const out = text.replace(re, (...args) => {
    const groups = args.slice(1, 1 + sorted.length);
    const idx = groups.findIndex((g) => g !== undefined);
    const orig = sorted[idx].original;
    const offset = args[args.length - 2];
    spans.push({ placeholder: sorted[idx].placeholder, original: orig, at: offset, len: args[0].length });
    count++;
    return orig;
  });
  return { text: out, spans, count, leftover: leftoverPlaceholders(out) };
}

// ---------- Wörterbuch-Hilfen ----------

export function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function validPlaceholder(label) {
  return /^[A-ZÄÖÜ][A-ZÄÖÜ0-9_]{1,23}$/.test(label);
}
