// Deckname: Dokument-Engine für docx, pptx, pdf, Textdateien und Tabellen (csv, tsv).
// Reine Funktionen, keine DOM-Abhängigkeit. Läuft im Browser (ES-Modul) und in Node (Tests).
// Grundsatz wie in engine.js: nichts verlässt das Gerät, alles ist deterministisch und nachvollziehbar.
//
// Abhängigkeiten werden nicht importiert, sondern gereicht:
//   JSZip liegt als klassisches Script auf globalThis.JSZip (lazy über zipLib()).
//   pdf.js wird als Modul in pdfToText(bytes, pdfjs) hineingegeben.
//
// Zusammenspiel mit der App:
//   protectFn(plain)  → { text, items:[{start,end,placeholder}], used }   (detect → assignPlaceholders → protect)
//   restoreFn(plain)  → { text, spans:[{at,len,original}], count, leftover }  (= engine.restore)

const MAX_BYTES = 25 * 1024 * 1024;

const KINDS = { docx: "docx", pptx: "pptx", pdf: "pdf", txt: "txt", md: "md", markdown: "md", csv: "csv", tsv: "tsv", tab: "tsv" };
/** Formate, die als Klartext durchlaufen (ohne Paketstruktur). */
export const TEXT_KINDS = new Set(["txt", "md", "csv", "tsv"]);
export const TABLE_KINDS = new Set(["csv", "tsv"]);

// Textknoten je Format. delText ist gelöschter Text der Änderungsverfolgung und enthält genauso Namen.
const TEXT_TAGS = { docx: ["w:t", "w:delText"], pptx: ["a:t"] };

function zipLib() {
  const Z = globalThis.JSZip;
  if (!Z) throw new Error("Die ZIP-Bibliothek ist nicht geladen. Lade die Seite neu.");
  return Z;
}

function esc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- Dateinamen und Ablehnungsgründe ----------

export function extOf(name) {
  const m = /\.([A-Za-z0-9]+)\s*$/.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

export function kindOf(name) {
  return KINDS[extOf(name)] || null;
}

const REJECT_TEXT = {
  doc: "Alte Word-Dateien (.doc) kann Deckname nicht lesen. Speichern Sie die Datei in Word einmal als .docx.",
  ppt: "Alte PowerPoint-Dateien (.ppt) kann Deckname nicht lesen. Speichern Sie die Datei einmal als .pptx.",
  xls: "Excel-Dateien kann Deckname nicht lesen. Speichern Sie die Tabelle in Excel als CSV UTF-8 (Datei → Speichern unter), die geht dann durch.",
  bild: "Bilder haben keinen Text, den Deckname ersetzen könnte.",
  unbekannt: "Dieses Format kann Deckname nicht lesen. Es gehen Word (.docx), PowerPoint (.pptx), PDF, Text (.txt, .md) und Tabellen (.csv, .tsv).",
  gross: "Die Datei ist größer als 25 MB. Teilen Sie sie auf oder kopieren Sie den Text in das Textfeld.",
};

const BILD_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp", "svg", "avif"]);

export function rejectReason(name, size) {
  const ext = extOf(name);
  const kind = kindOf(name);
  if (!kind) {
    if (ext === "doc") return REJECT_TEXT.doc;
    if (ext === "ppt" || ext === "pps") return REJECT_TEXT.ppt;
    if (ext === "xls" || ext === "xlsx" || ext === "xlsm" || ext === "xlsb" || ext === "ods" || ext === "numbers") return REJECT_TEXT.xls;
    if (BILD_EXT.has(ext)) return REJECT_TEXT.bild;
    return REJECT_TEXT.unbekannt;
  }
  if (typeof size === "number" && size > MAX_BYTES) return REJECT_TEXT.gross;
  return null;
}

export function safeName(name) {
  return String(name || "")
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/^\s+|\s+$/g, "")
    .replace(/^\.+/, "_") || "Datei";
}

/** "<protectedBase>.geschuetzt.<ext>"; ein PDF wird zu Text, also .txt. */
export function outName(originalName, kind, protectedBase) {
  const k = kind || kindOf(originalName) || extOf(originalName) || "txt";
  const ext = k === "pdf" ? "txt" : k;
  let base = String(protectedBase == null ? originalName : protectedBase);
  base = base.replace(new RegExp("\\.(?:" + Object.keys(KINDS).join("|") + ")\\s*$", "i"), "");
  return safeName(base) + ".geschuetzt." + ext;
}

// ---------- XML-Entities ----------

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeXml(s) {
  return String(s).replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, g) => {
    if (g[0] === "#") {
      const code = g[1] === "x" || g[1] === "X" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED, g) ? NAMED[g] : m;
  });
}

export function encodeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function encodeAttr(s) {
  return encodeXml(s).replace(/"/g, "&quot;");
}

// ---------- Text-Karte über einen XML-Teil ----------

/**
 * Baut aus einem OOXML-Teil eine Karte: durchgehender Klartext plus die Knoten, aus denen er stammt.
 * Regex statt DOMParser, damit die Datei außerhalb der Textknoten byteweise erhalten bleibt.
 */
export function buildTextMap(xml, kind) {
  const src = String(xml == null ? "" : xml);
  const tags = TEXT_TAGS[kind] || TEXT_TAGS.docx;
  const nodes = [];
  const segments = [];
  let plain = "";
  let lastTag = null;

  const re = new RegExp(
    "<(" + tags.map(esc).join("|") + ")(\\s[^>]*?)?(/?)>" +   // Textknoten
    "|</(w:p|a:p)>" +                                         // Absatzende
    "|<(w:br|w:cr|w:tab|a:br)(\\s[^>]*?)?/?>",                // Umbruch und Tabulator
    "g",
  );

  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) {
      if (m[3] === "/") continue;                       // leerer, selbstschließender Knoten
      const tag = m[1];
      const openEnd = m.index + m[0].length;
      const close = "</" + tag + ">";
      const textEnd = src.indexOf(close, openEnd);
      if (textEnd < 0) continue;
      re.lastIndex = textEnd + close.length;
      const raw = src.slice(openEnd, textEnd);
      if (!raw) continue;                                // leerer Knoten
      // Wechsel zwischen sichtbarem und gelöschtem Text trennt die Gedanken
      if (lastTag && lastTag !== tag && plain && !plain.endsWith("\n")) plain += "\n";
      lastTag = tag;
      const text = decodeXml(raw);
      const start = plain.length;
      plain += text;
      segments.push({ start, end: plain.length, nodeIndex: nodes.length });
      nodes.push({ tag, open: src.slice(m.index, openEnd), close, text, raw, openStart: m.index, textStart: openEnd, textEnd });
    } else if (m[4]) {
      plain += "\n";
    } else if (m[5]) {
      plain += m[5] === "w:tab" ? "\t" : "\n";
    }
  }

  return { xml: src, kind: kind || "docx", plain, segments, nodes };
}

/**
 * Wendet Ersetzungen in Klartext-Koordinaten auf die Knoten an.
 * spans: [{start, end, replacement}], überlappungsfrei. Rückgabe: neue Knotentexte (je Knoten einer).
 * Der erste überlappte Knoten bekommt den Ersatz, jeder weitere verliert nur seinen Anteil.
 */
export function applySpans(map, spans) {
  const out = map.nodes.map((n) => n.text);
  const list = [...(spans || [])].filter((s) => s && s.end > s.start).sort((a, b) => a.start - b.start);
  if (!list.length) return out;
  const gesetzt = new Set();

  for (const seg of map.segments) {
    const node = map.nodes[seg.nodeIndex];
    let res = "";
    let cursor = seg.start;
    let beruehrt = false;
    for (let i = 0; i < list.length; i++) {
      const sp = list[i];
      if (sp.end <= seg.start) continue;
      if (sp.start >= seg.end) break;
      beruehrt = true;
      const s = Math.max(sp.start, cursor);
      const e = Math.min(sp.end, seg.end);
      if (s > cursor) res += node.text.slice(cursor - seg.start, s - seg.start);
      if (!gesetzt.has(i)) { res += sp.replacement == null ? "" : String(sp.replacement); gesetzt.add(i); }
      cursor = Math.max(cursor, e);
    }
    if (!beruehrt) continue;
    res += node.text.slice(cursor - seg.start);
    out[seg.nodeIndex] = res;
  }
  return out;
}

function withPreserve(open, text) {
  if (!/^\s|\s$/.test(text)) return open;
  if (/\sxml:space\s*=/.test(open)) return open;
  return open.replace(/\s*>$/, ' xml:space="preserve">');
}

/** Schreibt die neuen Knotentexte zurück. Alles außerhalb der geänderten Knoten bleibt Zeichen für Zeichen stehen. */
export function writeXml(map, newTexts) {
  let out = "";
  let pos = 0;
  map.nodes.forEach((node, i) => {
    const text = newTexts[i];
    if (text === undefined || text === node.text) return;
    out += map.xml.slice(pos, node.openStart);
    out += withPreserve(node.open, text) + encodeXml(text);
    pos = node.textEnd;
  });
  out += map.xml.slice(pos);
  return out;
}

// ---------- Teile eines Office-Pakets ----------

function natCompare(a, b) {
  return a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });
}

function fileNames(zip) {
  return Object.keys(zip.files).filter((n) => !zip.files[n].dir);
}

function partNames(zip, kind) {
  const names = fileNames(zip);
  const pick = (re) => names.filter((n) => re.test(n)).sort(natCompare);
  if (kind === "pptx") {
    return {
      fest: [
        ...pick(/^ppt\/slides\/slide[^/]*\.xml$/),
        ...pick(/^ppt\/notesSlides\/[^/]+\.xml$/),
        ...pick(/^ppt\/comments\/[^/]+\.xml$/),
      ],
      weitere: [],
    };
  }
  const fest = [
    ...pick(/^word\/document[^/]*\.xml$/),
    ...pick(/^word\/header[^/]*\.xml$/),
    ...pick(/^word\/footer[^/]*\.xml$/),
    ...pick(/^word\/footnotes\.xml$/),
    ...pick(/^word\/endnotes\.xml$/),
    ...pick(/^word\/comments[^/]*\.xml$/),
  ];
  const weitere = names.filter((n) => /^word\/[^/]+\.xml$/.test(n) && !fest.includes(n)).sort(natCompare);
  return { fest, weitere };
}

async function officeParts(zip, kind) {
  const { fest, weitere } = partNames(zip, kind);
  const tag = "<" + (TEXT_TAGS[kind] || TEXT_TAGS.docx)[0];
  const parts = [];
  for (const name of fest) {
    const xml = await zip.file(name).async("string");
    parts.push({ name, map: buildTextMap(xml, kind) });
  }
  for (const name of weitere) {
    const xml = await zip.file(name).async("string");
    if (!xml.includes(tag)) continue;
    parts.push({ name, map: buildTextMap(xml, kind) });
  }
  return parts;
}

function joinPlain(parts) {
  let plain = "";
  const offsets = [];
  for (const p of parts) {
    if (plain) plain += "\n\n";
    offsets.push(plain.length);
    plain += p.map.plain;
  }
  return { plain, offsets };
}

function spansForPart(items, offset, length) {
  const out = [];
  for (const it of items || []) {
    if (it.end <= offset || it.start >= offset + length) continue;
    out.push({ start: Math.max(it.start, offset) - offset, end: Math.min(it.end, offset + length) - offset, replacement: it.placeholder });
  }
  return out;
}

/** Reicht ein Treffer über die Grenze zweier Dateiteile hinweg? */
function ueberGrenze(items, offsets, parts) {
  return items.some((it) => {
    const i = offsets.findLastIndex((off) => it.start >= off);
    return i < 0 || it.end > offsets[i] + parts[i].map.plain.length;
  });
}

async function loadZip(bytes) {
  try {
    return await zipLib().loadAsync(bytes);
  } catch {
    throw new Error("Die Datei lässt sich nicht öffnen. Vermutlich ist sie beschädigt oder mit einem Passwort geschützt.");
  }
}

function zipOut(zip) {
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

// ---------- Metadaten und Autorennamen ----------

function replaceTagText(xml, tag, fn) {
  const re = new RegExp("(<" + esc(tag) + "(?:\\s[^>]*)?>)([\\s\\S]*?)(</" + esc(tag) + ">)");
  return xml.replace(re, (m, open, inner, close) => open + encodeXml(fn(decodeXml(inner))) + close);
}

const AUTOR_ATTRS = {
  docx: [["w:author", "Autor"], ["w:initials", "A"]],
  pptx: [["name", "Autor"], ["initials", "A"]],
};

// Autorennamen stehen in Attributen, nicht in Textknoten. Bleibt der Name nach dem Schutz gleich
// (kein Treffer im Wörterbuch), wird er trotzdem neutralisiert.
function protectAttrs(xml, kind, name, protectFn, used) {
  if (kind === "pptx" && !/authors|comments/i.test(name)) return xml;
  let out = xml;
  for (const [attr, fallback] of AUTOR_ATTRS[kind] || AUTOR_ATTRS.docx) {
    const re = new RegExp("(\\s" + esc(attr) + '=")([^"]*)(")', "g");
    out = out.replace(re, (m, a, val, c) => {
      const orig = decodeXml(val);
      if (!orig.trim()) return m;
      const r = safeProtect(protectFn, orig, used);
      return a + encodeAttr(r === orig ? fallback : r) + c;
    });
  }
  return out;
}

function safeProtect(protectFn, text, used) {
  try {
    const r = protectFn(text);
    if (r && typeof r.text === "string") {
      if (used && Array.isArray(r.used)) for (const u of r.used) used.set(u.placeholder, u.type);
      return r.text;
    }
  } catch { /* Metadaten dürfen den Schutz der Datei nie kippen */ }
  return text;
}

const CORE_LEEREN = ["dc:creator", "cp:lastModifiedBy"];
const CORE_SCHUETZEN = ["dc:title", "dc:subject", "dc:description", "cp:keywords"];
const APP_LEEREN = ["Company", "Manager"];

async function protectMeta(zip, protectFn, used) {
  const core = zip.file("docProps/core.xml");
  if (core) {
    let xml = await core.async("string");
    for (const tag of CORE_LEEREN) xml = replaceTagText(xml, tag, () => "");
    for (const tag of CORE_SCHUETZEN) xml = replaceTagText(xml, tag, (t) => (t.trim() ? safeProtect(protectFn, t, used) : t));
    zip.file("docProps/core.xml", xml);
  }
  const app = zip.file("docProps/app.xml");
  if (app) {
    let xml = await app.async("string");
    for (const tag of APP_LEEREN) xml = replaceTagText(xml, tag, () => "");
    zip.file("docProps/app.xml", xml);
  }
}

// ---------- Schützen und Zurückholen von docx/pptx ----------

/**
 * Schützt eine Office-Datei. protectFn bekommt den Klartext aller Teile am Stück,
 * damit die App eine einzige Vorschau zeigen kann.
 */
export async function protectOffice(bytes, kind, protectFn) {
  const zip = await loadZip(bytes);
  const parts = await officeParts(zip, kind);
  const { plain, offsets } = joinPlain(parts);

  const res = protectFn(plain) || {};
  let items = (res.items || []).filter((i) => i && i.end > i.start).sort((a, b) => a.start - b.start);
  let text = typeof res.text === "string" ? res.text : plain;
  let used = new Map((res.used || []).map((u) => [u.placeholder, u.type]));

  // Notbremse: Die Erkennung findet Firmennamen auch über Zeilenumbrüche hinweg und kann so einen
  // Treffer bilden, der vom Fließtext in die Kopfzeile reicht. Ein solcher Platzhalter stünde für einen
  // Originaltext quer über zwei Dateiteile, und der Rückweg würde die Datei durcheinanderbringen.
  // Dann wird jeder Teil einzeln geschützt.
  if (ueberGrenze(items, offsets, parts)) {
    const einzeln = parts.map((p) => protectFn(p.map.plain) || {});
    items = einzeln.flatMap((r, i) => (r.items || [])
      .filter((it) => it && it.end > it.start)
      .map((it) => ({ ...it, start: it.start + offsets[i], end: it.end + offsets[i] })));
    text = einzeln.map((r, i) => (typeof r.text === "string" ? r.text : parts[i].map.plain)).join("\n\n");
    used = new Map();
    for (const r of einzeln) for (const u of r.used || []) used.set(u.placeholder, u.type);
  }

  let nodes = 0;
  parts.forEach((p, i) => {
    nodes += p.map.nodes.length;
    const spans = spansForPart(items, offsets[i], p.map.plain.length);
    let xml = writeXml(p.map, applySpans(p.map, spans));
    xml = protectAttrs(xml, kind, p.name, protectFn, used);
    zip.file(p.name, xml);
  });

  await protectMeta(zip, protectFn, used);

  // pptx führt Kommentar-Autoren in eigenen Teilen, die keinen Folientext enthalten
  if (kind === "pptx") {
    for (const name of fileNames(zip).filter((n) => /^ppt\/(commentAuthors|authors)\.xml$/.test(n))) {
      zip.file(name, protectAttrs(await zip.file(name).async("string"), kind, name, protectFn, used));
    }
  }

  const images = fileNames(zip).filter((n) => /^(word|ppt)\/media\//.test(n)).length;
  return {
    plain,
    text,
    hits: items,
    used: [...used].map(([placeholder, type]) => ({ placeholder, type })),
    bytes: await zipOut(zip),
    stats: { parts: parts.length, images, nodes },
  };
}

/** Setzt in einer geschützten Office-Datei die Originale wieder ein. Metadaten bleiben unangetastet. */
export async function restoreOffice(bytes, kind, restoreFn) {
  const zip = await loadZip(bytes);
  const parts = await officeParts(zip, kind);
  const { plain, offsets } = joinPlain(parts);

  const res = restoreFn(plain) || {};
  const items = (res.spans || [])
    .map((s) => ({ start: s.at, end: s.at + s.len, placeholder: s.original }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);

  parts.forEach((p, i) => {
    const spans = spansForPart(items, offsets[i], p.map.plain.length);
    zip.file(p.name, writeXml(p.map, applySpans(p.map, spans)));
  });

  return { bytes: await zipOut(zip), count: res.count || 0, leftover: res.leftover || [] };
}

// ---------- PDF ----------

/**
 * Baut aus den Textstücken einer PDF-Seite lesbare Zeilen.
 * Reine Funktion, damit sie ohne pdf.js getestet werden kann.
 */
export function linesFromItems(items) {
  const list = (items || []).filter((it) => it && typeof it.str === "string" && it.str.length && Array.isArray(it.transform));
  if (!list.length) return "";

  const zeilen = [];
  for (const it of list) {
    const y = it.transform[5];
    const hoehe = Math.abs(it.transform[3]) || Math.abs(it.height) || 10;
    let zeile = zeilen.find((z) => Math.abs(z.y - y) <= 2);
    if (!zeile) { zeile = { y, hoehe, stuecke: [] }; zeilen.push(zeile); }
    zeile.hoehe = Math.max(zeile.hoehe, hoehe);
    zeile.stuecke.push({ x: it.transform[4], str: it.str, breite: typeof it.width === "number" ? it.width : 0, hoehe });
  }

  zeilen.sort((a, b) => b.y - a.y);                      // im PDF wächst y nach oben
  const mittel = zeilen.reduce((s, z) => s + z.hoehe, 0) / zeilen.length;

  let out = "";
  zeilen.forEach((z, i) => {
    z.stuecke.sort((a, b) => a.x - b.x);
    let text = "";
    let ende = null;
    let letzteZeichenbreite = 0;
    for (const st of z.stuecke) {
      const zeichenbreite = st.breite > 0 && st.str.length ? st.breite / st.str.length : st.hoehe * 0.5;
      const luecke = ende === null ? 0 : st.x - ende;
      // Wortabstand: eine Lücke von rund einer halben Zeichenbreite reicht schon, weil das Leerzeichen
      // im PDF oft nur als Vorschub steht. Innerhalb eines Wortes ist die Lücke praktisch null.
      if (ende !== null && luecke > Math.max(zeichenbreite, letzteZeichenbreite) * 0.35 && !/\s$/.test(text) && !/^\s/.test(st.str)) text += " ";
      text += st.str;
      ende = st.x + (st.breite > 0 ? st.breite : zeichenbreite * st.str.length);
      letzteZeichenbreite = zeichenbreite;
    }
    if (i > 0) out += zeilen[i - 1].y - z.y > mittel * 1.6 ? "\n\n" : "\n";
    out += text.replace(/[ \t]+$/, "");
  });
  return out.trim();
}

/** Liest den Text aus einem PDF. pdfjs wird von der App per dynamischem Import gereicht. */
export async function pdfToText(bytes, pdfjs) {
  const lib = pdfjs && (pdfjs.getDocument ? pdfjs : pdfjs.default);
  if (!lib || typeof lib.getDocument !== "function") throw new Error("Der PDF-Leser konnte nicht geladen werden.");

  let doc;
  try {
    doc = await lib.getDocument({ data: bytes, isEvalSupported: false }).promise;
  } catch (err) {
    if (err && (err.name === "PasswordException" || /password/i.test(String(err.message || "")))) {
      throw new Error("Das PDF ist mit einem Passwort geschützt.");
    }
    throw new Error("Das PDF lässt sich nicht öffnen. Vermutlich ist die Datei beschädigt.");
  }

  const seiten = [];
  for (let i = 1; i <= doc.numPages; i++) {
    try {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      seiten.push(linesFromItems(content && content.items));
    } catch {
      seiten.push("");                                   // eine kaputte Seite kippt nicht das ganze Dokument
    }
  }
  try { if (typeof doc.destroy === "function") await doc.destroy(); } catch { /* egal */ }

  const text = seiten.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 20) throw new Error("Kein Text im PDF gefunden, vermutlich ein Scan. Scans kann Deckname nicht lesen.");
  return text;
}

// ---------- Textdateien und Tabellen: Kodierung, Trenner, Ausgabe ----------

const BOM = [0xef, 0xbb, 0xbf];

/**
 * Bytes einer Textdatei lesen. UTF-8 wird streng geprüft (mit oder ohne BOM); schlägt das fehl, war es
 * fast immer ein altes Excel- oder Windows-Export in Windows-1252 („Müller“ käme sonst als „M�ller“).
 * Liefert {text, encoding, bom}.
 */
export function decodeText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const bom = u8.length >= 3 && u8[0] === BOM[0] && u8[1] === BOM[1] && u8[2] === BOM[2];
  const body = bom ? u8.subarray(3) : u8;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body), encoding: "utf-8", bom };
  } catch {
    return { text: decode1252(body), encoding: "windows-1252", bom: false };
  }
}

// Die 32 Stellen, an denen Windows-1252 von Latin-1 abweicht (0x80 bis 0x9F); undefinierte bleiben Steuerzeichen.
const CP1252 = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];
function decode1252(u8) {
  try { return new TextDecoder("windows-1252").decode(u8); } catch { /* ohne ICU von Hand */ }
  let out = "";
  for (const b of u8) out += String.fromCharCode(b >= 0x80 && b <= 0x9f ? CP1252[b - 0x80] : b);
  return out;
}

/** Text als UTF-8 mit BOM, damit Excel unter Windows die Umlaute richtig liest. */
export function utf8WithBom(text) {
  const body = new TextEncoder().encode(String(text == null ? "" : text));
  const out = new Uint8Array(body.length + 3);
  out.set(BOM, 0); out.set(body, 3);
  return out;
}

/** Zeilenumbruch der Datei: \r\n (Windows, Excel) oder \n. */
export function detectNewline(text) {
  const i = String(text || "").indexOf("\n");
  return i > 0 && text[i - 1] === "\r" ? "\r\n" : "\n";
}

/**
 * Trenner einer Tabelle erraten: Semikolon (deutsches Excel), Komma, Tabulator oder senkrechter Strich.
 * Gezählt wird außerhalb von Anführungszeichen über die ersten Zeilen; gewinnt, was am gleichmäßigsten vorkommt.
 */
export function detectDelimiter(text, kind = "csv") {
  if (kind === "tsv") return "\t";
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  if (!lines.length) return ";";
  const cands = [";", ",", "\t", "|"];
  let best = ";", bestScore = -1;
  for (const d of cands) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const nonzero = counts.filter((c) => c > 0).length;
    if (!nonzero) continue;
    const min = Math.min(...counts), max = Math.max(...counts);
    // Gleichmäßigkeit (jede Zeile gleich viele Trenner) zählt mehr als die reine Menge
    const score = nonzero * 10 + (max === min ? 5 : 0) + Math.min(max, 9) * 0.1;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function countOutsideQuotes(line, d) {
  let n = 0, q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

/** Tabelle in Zeilen und Felder zerlegen (RFC 4180: Anführungszeichen, "" als Zeichen, Umbrüche im Feld). */
export function parseDelimited(text, delimiter) {
  const d = delimiter || detectDelimiter(text);
  const src = String(text || "");
  const rows = [];
  let row = [], field = "", q = false, i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { q = true; i++; continue; }
    if (ch === d) { row.push(field); field = ""; i++; continue; }
    if (ch === "\r" && src[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i += 2; continue; }
    if (ch === "\n" || ch === "\r") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // Leere Schlusszeile (Datei endet mit Umbruch) fällt weg
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
  return rows;
}

function tsvField(v) {
  const s = String(v == null ? "" : v);
  return /[\t\n\r"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function htmlEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Zeilen Tab-getrennt (was Excel beim Kopieren liefert). */
export function toTsv(rows) {
  return (rows || []).map((r) => r.map(tsvField).join("\t")).join("\r\n");
}

/** Zeilen als HTML-Tabelle, damit Excel, Word und Mail-Programme die Zellen erkennen. */
export function toHtmlTable(rows) {
  const body = (rows || []).map((r) => "<tr>" + r.map((c) => "<td>" + htmlEsc(c) + "</td>").join("") + "</tr>").join("");
  return "<table>" + body + "</table>";
}

/**
 * Was „Tabelle kopieren“ in die Zwischenablage legt: Tab-getrennt als Text plus HTML-Tabelle,
 * also genau das, was Excel bei Strg+C liefert. Der Trenner der Datei spielt dafür keine Rolle mehr.
 */
export function tableClipboard(text, delimiter) {
  const rows = parseDelimited(text, delimiter);
  return { text: toTsv(rows), html: toHtmlTable(rows), rows: rows.length, columns: rows.reduce((m, r) => Math.max(m, r.length), 0) };
}

// ---------- ZIP für den Download ----------

/** files: [{name, bytes}] oder [{name, text}]. Text wird als UTF-8 abgelegt. */
export async function buildZip(files) {
  const zip = new (zipLib())();
  for (const f of files || []) {
    if (!f || !f.name) continue;
    const inhalt = f.bytes !== undefined ? f.bytes : f.text !== undefined ? f.text : f.content;
    zip.file(safeName(f.name), inhalt == null ? "" : inhalt);
  }
  return zipOut(zip);
}
