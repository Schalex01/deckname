// Tests für die Dokument-Engine (docx, pptx, PDF-Zeilen, Dateinamen). Ausführen: node --test tests/
// Fixtures werden hier programmatisch als OOXML-Pakete gebaut, es liegen keine Binärdateien im Repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { detect, assignPlaceholders, protect, restore, newSession } from "../deckname/engine.js";
import {
  kindOf, rejectReason, safeName, outName, buildTextMap, applySpans, writeXml,
  protectOffice, restoreOffice, linesFromItems, pdfToText, buildZip,
  decodeText, utf8WithBom, detectDelimiter, detectNewline, parseDelimited, toTsv, toHtmlTable, tableClipboard,
} from "../deckname/docs.js";

const require = createRequire(import.meta.url);
// Im Browser liegt JSZip als klassisches Script auf globalThis, in Node holen die Tests es aus dem Vendor-Ordner.
const JSZip = require("../deckname/vendor/jszip.min.js");
globalThis.JSZip = JSZip;

// ---------- Wörterbuch und Schutz-Funktionen wie in der App ----------

const DICT = [
  { id: "d1", original: "Max Mustermann", aliases: ["Mustermann"], type: "PERSON", placeholder: "PERSON_1" },
  { id: "d2", original: "Müller & Söhne GmbH", aliases: [], type: "FIRMA", placeholder: "FIRMA_1" },
  { id: "d3", original: "Anna Beispiel", aliases: [], type: "PERSON", placeholder: "PERSON_2" },
];

function schuetzer(session = newSession()) {
  const fn = (plain) => {
    const items = assignPlaceholders(detect(plain, DICT, [], new Set()), DICT, session);
    const p = protect(plain, items);
    return { text: p.text, items, used: p.used };
  };
  fn.session = session;
  return fn;
}

function rueckholer(session) {
  const mapping = [
    ...DICT.map((e) => ({ placeholder: e.placeholder, original: e.original })),
    ...Object.entries(session.map).map(([placeholder, v]) => ({ placeholder, original: v.original })),
  ];
  return (plain) => restore(plain, mapping);
}

// ---------- Fixture-Bausteine ----------

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

const CONTENT_TYPES = DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Default Extension="png" ContentType="image/png"/></Types>';
const RELS = DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';

const r = (t) => "<w:r><w:t>" + t + "</w:t></w:r>";
const p = (...inner) => "<w:p>" + inner.join("") + "</w:p>";
const dokument = (inner) => DECL + "<w:document " + W + "><w:body>" + inner + "</w:body></w:document>";

function core(title = "Vertrag mit Max Mustermann") {
  return DECL + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/">'
    + "<dc:title>" + title + "</dc:title><dc:subject>Anna Beispiel</dc:subject>"
    + "<dc:creator>Anna Beispiel</dc:creator><cp:lastModifiedBy>Anna Beispiel</cp:lastModifiedBy>"
    + "<dc:description>Entwurf</dc:description><cp:keywords>Vertrag</cp:keywords></cp:coreProperties>";
}

const APP_XML = DECL + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
  + "<Company>Müller &amp; Söhne GmbH</Company><Manager>Anna Beispiel</Manager><Pages>1</Pages></Properties>";

async function baueZip(dateien) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  for (const [name, inhalt] of Object.entries(dateien)) zip.file(name, inhalt);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

async function lies(bytes, name, alsBytes = false) {
  const zip = await JSZip.loadAsync(bytes);
  const f = zip.file(name);
  assert.ok(f, "Datei fehlt im Paket: " + name);
  return f.async(alsBytes ? "uint8array" : "string");
}

/** Grobe Prüfung auf Wohlgeformtheit: Tags müssen sich schließen, Text darf kein rohes < > & enthalten. */
function wohlgeformt(xml) {
  const rest = xml.replace(/^<\?xml[^>]*\?>/, "");
  const re = /<(\/?)([A-Za-z_][A-Za-z0-9_.:-]*)((?:[^<>"]|"[^"]*")*?)(\/?)>/g;
  const stapel = [];
  let pos = 0;
  let m;
  while ((m = re.exec(rest)) !== null) {
    const text = rest.slice(pos, m.index);
    pos = m.index + m[0].length;
    if (/[<>]/.test(text)) return false;
    if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(text)) return false;
    if (m[1] === "/") { if (stapel.pop() !== m[2]) return false; } else if (m[4] !== "/") stapel.push(m[2]);
  }
  if (/[<>]/.test(rest.slice(pos))) return false;
  return stapel.length === 0;
}

// ---------- 1. Wort über zwei Runs ----------

test("Wort über zwei Runs wird als Ganzes erkannt und ersetzt, XML bleibt wohlgeformt", async () => {
  const bytes = await baueZip({
    "word/document.xml": dokument(p(r("Hallo Muster"), r("mann, alles klar?"))),
  });
  const res = await protectOffice(bytes, "docx", schuetzer());
  assert.equal(res.plain, "Hallo Mustermann, alles klar?\n");
  assert.equal(res.hits.length, 1);

  const xml = await lies(res.bytes, "word/document.xml");
  assert.ok(wohlgeformt(xml), "XML ist nicht wohlgeformt: " + xml);
  const map = buildTextMap(xml, "docx");
  assert.deepEqual(map.nodes.map((n) => n.text), ["Hallo PERSON_1", ", alles klar?"]);
  assert.equal(map.plain, "Hallo PERSON_1, alles klar?\n");
});

// ---------- 2. Kopfzeile, Fußnote, Kommentar, gelöschter Text, Autor, Metadaten ----------

test("Kopfzeile, Fußnote, Kommentar und gelöschter Text werden geschützt, Autor und dc:creator neutralisiert", async () => {
  const bytes = await baueZip({
    "word/document.xml": dokument(
      p(r("Vertrag für Max Mustermann."))
      + '<w:p><w:del w:author="Redaktion" w:date="2026-09-10T10:00:00Z"><w:r><w:delText>Früher stand hier Max Mustermann</w:delText></w:r></w:del></w:p>',
    ),
    "word/header1.xml": DECL + "<w:hdr " + W + ">" + p(r("Kanzlei-Post, Müller &amp; Söhne GmbH")) + "</w:hdr>",
    "word/footnotes.xml": DECL + "<w:footnotes " + W + '><w:footnote w:id="2">' + p(r("Quelle: Anna Beispiel")) + "</w:footnote></w:footnotes>",
    "word/comments.xml": DECL + "<w:comments " + W + '><w:comment w:id="1" w:author="Anna Beispiel" w:initials="AB">'
      + p(r("Bitte an Max Mustermann schicken")) + "</w:comment></w:comments>",
    "docProps/core.xml": core(),
    "docProps/app.xml": APP_XML,
  });

  const res = await protectOffice(bytes, "docx", schuetzer());
  assert.equal(res.stats.parts, 4);

  const doc = await lies(res.bytes, "word/document.xml");
  assert.match(doc, /Vertrag für PERSON_1\./);
  assert.match(doc, /<w:delText>Früher stand hier PERSON_1<\/w:delText>/);
  // "Redaktion" steht in keinem Wörterbuch, also wird der Name neutralisiert statt ersetzt
  assert.match(doc, /w:author="Autor"/, "Autor im gelöschten Absatz ist nicht neutralisiert");
  assert.doesNotMatch(doc, /Redaktion/);

  assert.match(await lies(res.bytes, "word/header1.xml"), /FIRMA_1/);
  assert.match(await lies(res.bytes, "word/footnotes.xml"), /Quelle: PERSON_2/);

  const kommentare = await lies(res.bytes, "word/comments.xml");
  assert.match(kommentare, /w:author="PERSON_2"/);
  assert.match(kommentare, /w:initials="A"/, "Kürzel ohne Treffer muss neutralisiert werden");
  assert.match(kommentare, /Bitte an PERSON_1 schicken/);

  const c = await lies(res.bytes, "docProps/core.xml");
  assert.match(c, /<dc:creator><\/dc:creator>/);
  assert.match(c, /<cp:lastModifiedBy><\/cp:lastModifiedBy>/);
  assert.match(c, /<dc:title>Vertrag mit PERSON_1<\/dc:title>/);
  assert.match(c, /<dc:subject>PERSON_2<\/dc:subject>/);
  assert.doesNotMatch(c, /Mustermann|Beispiel/);

  const a = await lies(res.bytes, "docProps/app.xml");
  assert.match(a, /<Company><\/Company>/);
  assert.match(a, /<Manager><\/Manager>/);
  assert.match(a, /<Pages>1<\/Pages>/);
});

// ---------- 3. Entities ----------

test("Entities werden beim Lesen dekodiert und beim Schreiben wieder kodiert", async () => {
  const session = newSession();
  const bytes = await baueZip({
    "word/document.xml": dokument(p(r("Die Müller &amp; Söhne GmbH &lt;intern&gt; zahlt.")))
  });
  const res = await protectOffice(bytes, "docx", schuetzer(session));
  assert.equal(res.plain, "Die Müller & Söhne GmbH <intern> zahlt.\n");

  const geschuetzt = await lies(res.bytes, "word/document.xml");
  assert.match(geschuetzt, /Die FIRMA_1 &lt;intern&gt; zahlt\./);
  assert.ok(wohlgeformt(geschuetzt));

  const zurueck = await restoreOffice(res.bytes, "docx", rueckholer(session));
  const original = await lies(zurueck.bytes, "word/document.xml");
  assert.match(original, /Die Müller &amp; Söhne GmbH &lt;intern&gt; zahlt\./);
  assert.equal(zurueck.count, 1);
});

// ---------- 4. xml:space="preserve" ----------

test("xml:space=preserve wird ergänzt, wenn der neue Knotentext mit Leerzeichen beginnt oder endet", async () => {
  const bytes = await baueZip({
    "word/document.xml": dokument(p(r("Hallo Max Muster"), r("mann kommt später"))),
  });
  const res = await protectOffice(bytes, "docx", schuetzer());
  const xml = await lies(res.bytes, "word/document.xml");
  assert.match(xml, /<w:t>Hallo PERSON_1<\/w:t>/);
  assert.match(xml, /<w:t xml:space="preserve"> kommt später<\/w:t>/);
  assert.ok(wohlgeformt(xml));

  // Ohne Leerzeichen am Rand bleibt das Attribut weg
  const map = buildTextMap("<w:p><w:r><w:t>abc</w:t></w:r></w:p>", "docx");
  assert.equal(writeXml(map, ["xy"]), "<w:p><w:r><w:t>xy</w:t></w:r></w:p>");
  assert.equal(writeXml(map, [" xy"]), '<w:p><w:r><w:t xml:space="preserve"> xy</w:t></w:r></w:p>');
});

// ---------- 5. pptx ----------

test("pptx: Folie und Notiz werden geschützt", async () => {
  const slide = (inner) => DECL + "<p:sld " + P + " " + A + "><p:cSld><p:spTree><p:sp><p:txBody>" + inner + "</p:txBody></p:sp></p:spTree></p:cSld></p:sld>";
  const bytes = await baueZip({
    "ppt/slides/slide1.xml": slide("<a:p><a:r><a:t>Angebot für Max Muster</a:t></a:r><a:r><a:t>mann</a:t></a:r></a:p>"),
    "ppt/slides/slide2.xml": slide("<a:p><a:r><a:t>Partner: Müller &amp; Söhne GmbH</a:t></a:r></a:p>"),
    "ppt/notesSlides/notesSlide1.xml": DECL + "<p:notes " + P + " " + A + "><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Notiz: Anna Beispiel anrufen</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>",
  });

  const res = await protectOffice(bytes, "pptx", schuetzer());
  assert.equal(res.stats.parts, 3);
  assert.equal(res.plain, "Angebot für Max Mustermann\n\n\nPartner: Müller & Söhne GmbH\n\n\nNotiz: Anna Beispiel anrufen\n");

  const s1 = await lies(res.bytes, "ppt/slides/slide1.xml");
  assert.match(s1, /<a:t>Angebot für PERSON_1<\/a:t>/);
  assert.ok(wohlgeformt(s1));
  assert.match(await lies(res.bytes, "ppt/slides/slide2.xml"), /Partner: FIRMA_1/);
  assert.match(await lies(res.bytes, "ppt/notesSlides/notesSlide1.xml"), /Notiz: PERSON_2 anrufen/);
});

// ---------- 6. Roundtrip und unangetastete Bytes ----------

test("Roundtrip: schützen und zurückholen ergibt den Originaltext, andere Bytes bleiben gleich", async () => {
  const session = newSession();
  const bild = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 250, 251, 252, 253]);
  const originalDoc = dokument(
    p(r("Hallo Max Muster"), r("mann, bitte melden."))
    + p(r("Die Müller &amp; Söhne GmbH zahlt."))
    + p(r("Grüße von Anna Beispiel")),
  );
  const bytes = await baueZip({
    "word/document.xml": originalDoc,
    "word/media/bild1.png": bild,
    "word/settings.xml": DECL + "<w:settings " + W + '><w:zoom w:percent="100"/></w:settings>',
    "docProps/core.xml": core(),
  });

  const vorher = buildTextMap(originalDoc, "docx").plain;
  const res = await protectOffice(bytes, "docx", schuetzer(session));
  assert.equal(res.stats.images, 1);
  assert.match(res.text, /PERSON_1/);

  const zurueck = await restoreOffice(res.bytes, "docx", rueckholer(session));
  const wieder = await lies(zurueck.bytes, "word/document.xml");
  assert.ok(wohlgeformt(wieder));
  assert.equal(buildTextMap(wieder, "docx").plain, vorher);
  assert.equal(zurueck.count, 3);
  assert.deepEqual(zurueck.leftover, []);

  // Unveränderte Knoten kommen Zeichen für Zeichen zurück
  assert.match(wieder, /<w:t>Grüße von Anna Beispiel<\/w:t>/);
  // Bild und nicht angefasste Teile bleiben byteweise gleich
  assert.deepEqual(await lies(zurueck.bytes, "word/media/bild1.png", true), bild);
  assert.equal(await lies(zurueck.bytes, "[Content_Types].xml"), CONTENT_TYPES);
  assert.match(await lies(zurueck.bytes, "word/settings.xml"), /w:percent="100"/);
});

// ---------- 7. PDF-Zeilen ----------

test("linesFromItems: zwei Zeilen, Wortabstand und Absatz", () => {
  const it = (str, x, y, breite, hoehe = 10) => ({ str, transform: [hoehe, 0, 0, hoehe, x, y], width: breite, height: hoehe });
  const items = [
    it("Sehr", 72, 700, 22),
    it("geehrte", 99, 700, 38),      // Lücke von 5 pt: Wortabstand
    it("Frau", 72, 686, 21),         // nächste Zeile, normaler Abstand
    it("Meyer,", 96, 686, 30),
    it("wir", 72, 640, 15),          // großer Sprung: Absatz
  ];
  assert.equal(linesFromItems(items), "Sehr geehrte\nFrau Meyer,\n\nwir");
  assert.equal(linesFromItems([]), "");

  // Zwei Stücke ohne Lücke bleiben ein Wort
  assert.equal(linesFromItems([it("Muster", 72, 700, 30), it("mann", 102, 700, 20)]), "Mustermann");
});

test("pdfToText meldet Passwort und Scan im Klartext", async () => {
  const passwortFehler = Object.assign(new Error("No password given"), { name: "PasswordException" });
  const stubFehler = { getDocument: () => ({ promise: Promise.reject(passwortFehler) }) };
  await assert.rejects(() => pdfToText(new Uint8Array([1]), stubFehler), /Passwort/);

  const seite = { getTextContent: async () => ({ items: [{ str: "x", transform: [10, 0, 0, 10, 0, 0], width: 5, height: 10 }] }) };
  const stubScan = { getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => seite }) }) };
  await assert.rejects(() => pdfToText(new Uint8Array([1]), stubScan), /Scan/);

  const lang = "Sehr geehrte Frau Meyer, anbei der Vertrag zur Prüfung.";
  const stubOk = {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async () => ({ getTextContent: async () => ({ items: [{ str: lang, transform: [10, 0, 0, 10, 0, 0], width: 200, height: 10 }] }) }),
      }),
    }),
  };
  assert.equal(await pdfToText(new Uint8Array([1]), stubOk), lang + "\n\n" + lang);
});

// ---------- 8. Endungen und Ablehnungsgründe ----------

test("kindOf und rejectReason", () => {
  assert.equal(kindOf("Vertrag.DOCX"), "docx");
  assert.equal(kindOf("Folien.pptx"), "pptx");
  assert.equal(kindOf("Scan.PDF"), "pdf");
  assert.equal(kindOf("notiz.TXT"), "txt");
  assert.equal(kindOf("liste.md"), "md");
  assert.equal(kindOf("liste.markdown"), "md");
  assert.equal(kindOf("archiv.zip"), null);

  assert.equal(rejectReason("Vertrag.docx", 1000), null);
  assert.match(rejectReason("Zahlen.xlsx", 1000), /CSV UTF-8/);
  assert.equal(rejectReason("Kunden.csv", 1000), null);
  assert.equal(rejectReason("Kunden.TSV", 1000), null);
  assert.equal(kindOf("Kunden.csv"), "csv");
  assert.equal(kindOf("Kunden.tsv"), "tsv");
  assert.match(rejectReason("Alt.doc", 1000), /\.docx/);
  assert.match(rejectReason("Foto.jpg", 1000), /Bilder/);
  assert.match(rejectReason("Vertrag.docx", 26 * 1024 * 1024), /25 MB/);
  assert.match(rejectReason("Daten.bin", 10), /Format/);
});

// ---------- 9. ZIP für den Download ----------

test("buildZip enthält alle Dateien samt KI-Hinweis", async () => {
  const hinweis = "Verwendete Platzhalter: PERSON_1 (Person), FIRMA_1 (Firma).";
  const bytes = await buildZip([
    { name: "Vertrag PERSON_1.geschuetzt.docx", bytes: new Uint8Array([1, 2, 3]) },
    { name: "Folien.geschuetzt.pptx", bytes: new Uint8Array([4, 5]) },
    { name: "KI-Hinweis.txt", text: hinweis },
  ]);
  const zip = await JSZip.loadAsync(bytes);
  assert.deepEqual(Object.keys(zip.files).sort(), ["Folien.geschuetzt.pptx", "KI-Hinweis.txt", "Vertrag PERSON_1.geschuetzt.docx"]);
  assert.equal(await zip.file("KI-Hinweis.txt").async("string"), hinweis);
  assert.doesNotMatch(await zip.file("KI-Hinweis.txt").async("string"), /Mustermann/);
  assert.deepEqual(await zip.file("Folien.geschuetzt.pptx").async("uint8array"), new Uint8Array([4, 5]));
});

// ---------- 10. Dateinamen ----------

test("outName und safeName", () => {
  assert.equal(outName("Vertrag Mustermann.docx", "docx", "Vertrag PERSON_1"), "Vertrag PERSON_1.geschuetzt.docx");
  assert.equal(outName("Folien.pptx", "pptx", "Folien"), "Folien.geschuetzt.pptx");
  assert.equal(outName("Bericht.pdf", "pdf", "Bericht PERSON_1"), "Bericht PERSON_1.geschuetzt.txt");
  assert.equal(outName("Notiz.txt", "txt", "Notiz"), "Notiz.geschuetzt.txt");
  assert.equal(outName("Vertrag Mustermann.docx", "docx", "Vertrag PERSON_1.docx"), "Vertrag PERSON_1.geschuetzt.docx");

  assert.equal(safeName('a/b\\c:d*e?f"g<h>i|j'), "a_b_c_d_e_f_g_h_i_j");
  assert.equal(safeName("  Vertrag PERSON_1  "), "Vertrag PERSON_1");
});

// ---------- Text-Karte im Detail ----------

test("buildTextMap: Trenner, leere Knoten und applySpans über Knotengrenzen", () => {
  const xml = "<w:p><w:r><w:t>Eins</w:t><w:tab/><w:t></w:t><w:t>Zwei</w:t><w:br/><w:t>Drei</w:t></w:r></w:p><w:p><w:r><w:t>Vier</w:t></w:r></w:p>";
  const map = buildTextMap(xml, "docx");
  assert.equal(map.plain, "Eins\tZwei\nDrei\nVier\n");
  assert.equal(map.nodes.length, 4);

  // Ein Span über zwei Knoten hinweg: der erste bekommt den Platzhalter, der zweite verliert seinen Anteil
  const texte = applySpans(map, [{ start: 0, end: 9, replacement: "X_1" }]);
  assert.deepEqual(texte, ["X_1", "", "Drei", "Vier"]);
  const neu = writeXml(map, texte);
  assert.ok(wohlgeformt(neu));
  assert.match(neu, /<w:tab\/>/, "Trenner innerhalb eines Spans bleiben stehen");

  // Endet der Span mitten im zweiten Knoten, bleibt dessen Rest erhalten
  assert.deepEqual(applySpans(map, [{ start: 0, end: 8, replacement: "X_1" }]), ["X_1", "i", "Drei", "Vier"]);
});

// ---------- Treffer über die Grenze zweier Dateiteile ----------

test("Ein Treffer über zwei Dateiteile hinweg zerlegt die Datei nicht", async () => {
  // Die Engine erkennt Firmennamen auch über Zeilenumbrüche: "Jonas Kertesz" am Ende des Fließtextes
  // plus "Nordwind Logistik GmbH" aus der Kopfzeile ergäbe sonst EINEN Treffer über beide Teile.
  const session = newSession();
  const frei = (plain) => {
    const items = assignPlaceholders(detect(plain, [], [], new Set()), [], session);
    const prot = protect(plain, items);
    return { text: prot.text, items, used: prot.used };
  };
  const bytes = await baueZip({
    "word/document.xml": dokument(p(r("Mit freundlichen Grüßen, Jonas Kertesz"))),
    "word/header1.xml": DECL + "<w:hdr " + W + ">" + p(r("Nordwind Logistik GmbH")) + "</w:hdr>",
  });

  const res = await protectOffice(bytes, "docx", frei);
  const doc = await lies(res.bytes, "word/document.xml");
  const kopf = await lies(res.bytes, "word/header1.xml");
  assert.doesNotMatch(doc, /Kertesz/);
  assert.doesNotMatch(kopf, /Nordwind/);
  assert.match(kopf, /<w:t>FIRMA_\d<\/w:t>/, "Die Kopfzeile muss ihren eigenen Platzhalter bekommen");
  assert.ok(wohlgeformt(doc) && wohlgeformt(kopf));

  const mapping = Object.entries(session.map).map(([placeholder, v]) => ({ placeholder, original: v.original }));
  const zurueck = await restoreOffice(res.bytes, "docx", (t) => restore(t, mapping));
  assert.equal(buildTextMap(await lies(zurueck.bytes, "word/document.xml"), "docx").plain, "Mit freundlichen Grüßen, Jonas Kertesz\n");
  assert.equal(buildTextMap(await lies(zurueck.bytes, "word/header1.xml"), "docx").plain, "Nordwind Logistik GmbH\n");
});

// ---------- Echtes PDF mit dem Vendor-Modul ----------

/** Winziges PDF mit ein paar Textzeilen, von Hand gebaut (Offsets für die xref-Tabelle mitgezählt). */
function minimalPdf(zeilen) {
  const strom = "BT /F1 12 Tf 72 780 Td 18 TL "
    + zeilen.map((z) => "(" + z.replace(/([()\\])/g, "\\$1") + ") Tj T*").join(" ") + " ET";
  const objekte = [
    "<</Type /Catalog /Pages 2 0 R>>",
    "<</Type /Pages /Kids [3 0 R] /Count 1>>",
    "<</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>>",
    "<</Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding>>",
    "<</Length " + Buffer.byteLength(strom, "latin1") + ">>\nstream\n" + strom + "\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const positionen = [];
  objekte.forEach((inhalt, i) => {
    positionen.push(Buffer.byteLength(pdf, "latin1"));
    pdf += (i + 1) + " 0 obj\n" + inhalt + "\nendobj\n";
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += "xref\n0 " + (objekte.length + 1) + "\n0000000000 65535 f \n";
  for (const pos of positionen) pdf += String(pos).padStart(10, "0") + " 00000 n \n";
  pdf += "trailer\n<</Size " + (objekte.length + 1) + " /Root 1 0 R>>\nstartxref\n" + xref + "\n%%EOF\n";
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

test("pdfToText liest ein echtes PDF mit dem Vendor-Modul", async (t) => {
  // Der Browser-Build von pdf.js erwartet ein paar DOM-Globals, die Node nicht hat.
  if (typeof globalThis.DOMMatrix === "undefined") {
    globalThis.DOMMatrix = class { constructor(v = [1, 0, 0, 1, 0, 0]) { [this.a, this.b, this.c, this.d, this.e, this.f] = v; } };
  }
  if (typeof globalThis.ImageData === "undefined") globalThis.ImageData = class { constructor(w, h) { this.width = w; this.height = h; } };
  if (typeof globalThis.Path2D === "undefined") globalThis.Path2D = class { };

  let pdfjs;
  try {
    pdfjs = await import("../deckname/vendor/pdf.min.mjs");
  } catch (err) {
    t.skip("pdf.js laesst sich unter diesem Node nicht laden: " + err.message);
    return;
  }

  // Wie in der App: der Worker wird ausdrücklich benannt, sonst sucht pdf.js die unminifizierte Datei
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../deckname/vendor/pdf.worker.min.mjs", import.meta.url).href;

  const zeilen = ["Rechnung 2026-1188 an Rosa Feldmann", "Betrag 4.820,00 EUR", "Rueckfragen an Marlene Ostwald"];
  const text = await pdfToText(minimalPdf(zeilen), pdfjs);
  assert.equal(text, zeilen.join("\n"));
});

// ---------- 11. CSV (0.5): Kodierung, BOM, Trenner, Tabelle kopieren ----------

const CSV_UTF8 = "Name;Firma;Ort\r\nMax Mustermann;Müller & Söhne GmbH;Köln\r\nAnna Beispiel;\"Groß; Klein\";Düsseldorf\r\n";

test("CSV: UTF-8 mit und ohne BOM wird erkannt, Windows-1252 als Rückfall", () => {
  const ohne = new TextEncoder().encode(CSV_UTF8);
  const mit = new Uint8Array(ohne.length + 3); mit.set([0xef, 0xbb, 0xbf], 0); mit.set(ohne, 3);
  assert.deepEqual(decodeText(ohne), { text: CSV_UTF8, encoding: "utf-8", bom: false });
  assert.deepEqual(decodeText(mit), { text: CSV_UTF8, encoding: "utf-8", bom: true });
  // „Müller“ aus altem Excel: 0xFC ist in UTF-8 ungültig
  const cp = new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x3b, 0x80, 0x20, 0x4b, 0xf6, 0x6c, 0x6e]);
  const d = decodeText(cp);
  assert.equal(d.encoding, "windows-1252");
  assert.equal(d.text, "Müller;€ Köln");
  assert.equal(decodeText(new Uint8Array([])).text, "");
});

test("CSV: Ausgabe ist immer UTF-8 mit BOM, Trenner und Umbrüche bleiben wie im Original", () => {
  const session = newSession();
  const items = assignPlaceholders(detect(CSV_UTF8, DICT, [], new Set()), DICT, session);
  const geschuetzt = protect(CSV_UTF8, items).text;
  assert.equal(geschuetzt, "Name;Firma;Ort\r\nPERSON_1;FIRMA_1;Köln\r\nPERSON_2;\"Groß; Klein\";Düsseldorf\r\n");
  assert.equal((geschuetzt.match(/;/g) || []).length, (CSV_UTF8.match(/;/g) || []).length);
  assert.equal(detectNewline(geschuetzt), "\r\n");

  const bytes = utf8WithBom(geschuetzt);
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const wieder = decodeText(bytes);
  assert.equal(wieder.bom, true);
  assert.equal(wieder.text, geschuetzt);

  // Rückweg aus der geschützten Tabelle ergibt wieder das Original
  const mapping = [...DICT.map((e) => ({ placeholder: e.placeholder, original: e.original }))];
  assert.equal(restore(wieder.text, mapping).text, CSV_UTF8);
  assert.equal(outName("Kunden.csv", "csv", "Kunden"), "Kunden.geschuetzt.csv");
  assert.equal(outName("Kunden.tsv", "tsv", "Kunden"), "Kunden.geschuetzt.tsv");
});

test("CSV: Trenner erraten (Semikolon, Komma, Tab, Strich), Anführungszeichen zählen nicht", () => {
  assert.equal(detectDelimiter(CSV_UTF8), ";");
  assert.equal(detectDelimiter("a,b,c\n1,2,3\n"), ",");
  assert.equal(detectDelimiter("a\tb\tc\n1\t2\t3\n"), "\t");
  assert.equal(detectDelimiter("a|b|c\n1|2|3\n"), "|");
  assert.equal(detectDelimiter("egal", "tsv"), "\t");
  // Kommas nur innerhalb von Anführungszeichen machen das Komma nicht zum Trenner
  assert.equal(detectDelimiter('Name;Notiz\n"Meyer, Max";"ja, sicher"\n'), ";");
  assert.equal(detectDelimiter(""), ";");
});

test("CSV: Tabelle kopieren liefert Tab-getrennt plus HTML-Tabelle, Felder mit Trenner im Text bleiben ganz", () => {
  const rows = parseDelimited(CSV_UTF8, ";");
  assert.deepEqual(rows, [["Name", "Firma", "Ort"], ["Max Mustermann", "Müller & Söhne GmbH", "Köln"], ["Anna Beispiel", "Groß; Klein", "Düsseldorf"]]);
  assert.deepEqual(parseDelimited('a,"b ""c"" d",e\n', ","), [["a", 'b "c" d', "e"]]);
  assert.deepEqual(parseDelimited('a,"zwei\nZeilen",e', ","), [["a", "zwei\nZeilen", "e"]]);

  const t = tableClipboard("Name;Firma\r\nPERSON_1;FIRMA_1\r\n", ";");
  assert.equal(t.text, "Name\tFirma\r\nPERSON_1\tFIRMA_1");
  assert.equal(t.html, "<table><tr><td>Name</td><td>Firma</td></tr><tr><td>PERSON_1</td><td>FIRMA_1</td></tr></table>");
  assert.equal(t.rows, 2);
  assert.equal(t.columns, 2);
  assert.equal(toTsv([["a\tb", 'c"d']]), '"a\tb"\t"c""d"');
  assert.equal(toHtmlTable([["<x>", "&"]]), "<table><tr><td>&lt;x&gt;</td><td>&amp;</td></tr></table>");
});
