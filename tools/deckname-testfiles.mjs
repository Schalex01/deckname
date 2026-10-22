#!/usr/bin/env node
// Erzeugt erfundene Testdateien für den Browser-Test von Deckname.
// Aufruf: node tools/deckname-testfiles.mjs <zielordner>
//
// Alle Namen, Firmen, Nummern und Adressen sind frei erfunden. Es steckt nichts Echtes drin.
// Die Pakete sind bewusst minimal gehalten: sie enthalten genau die Teile, die Deckname anfasst
// (Text, Kopfzeile, Kommentar, Notizen, Metadaten, ein Bild), damit man den Weg durch die App sieht.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const hier = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const JSZip = require(path.join(hier, "..", "deckname", "vendor", "jszip.min.js"));

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const NS_P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

// Ein echtes, winziges PNG (1 x 1 Pixel). Dient als Bild, das unverändert durchlaufen muss.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function rels(...eintraege) {
  return DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + eintraege.map(([id, typ, ziel]) => `<Relationship Id="${id}" Type="${typ}" Target="${ziel}"/>`).join("")
    + "</Relationships>";
}

const T = {
  doc: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  core: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  app: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
  header: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
  footnotes: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes",
  comments: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
  image: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  styles: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
  slideMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
  slide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
  slideLayout: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
  notesSlide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide",
  notesMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster",
  theme: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
};

function typen(defaults, overrides) {
  return DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + defaults.map(([ext, ct]) => `<Default Extension="${ext}" ContentType="${ct}"/>`).join("")
    + overrides.map(([teil, ct]) => `<Override PartName="${teil}" ContentType="${ct}"/>`).join("")
    + "</Types>";
}

const CT_CORE = "application/vnd.openxmlformats-package.core-properties+xml";
const CT_APP = "application/vnd.openxmlformats-officedocument.extended-properties+xml";

function coreXml({ titel, autor, thema, stichworte }) {
  return DECL + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"'
    + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${titel}</dc:title><dc:subject>${thema}</dc:subject><dc:creator>${autor}</dc:creator>`
    + `<cp:keywords>${stichworte}</cp:keywords><dc:description>Testdatei für Deckname</dc:description>`
    + `<cp:lastModifiedBy>${autor}</cp:lastModifiedBy>`
    + '<dcterms:created xsi:type="dcterms:W3CDTF">2026-09-10T09:00:00Z</dcterms:created></cp:coreProperties>';
}

function appXml(firma, manager) {
  return DECL + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
    + `<Application>Deckname Testdaten</Application><Company>${firma}</Company><Manager>${manager}</Manager></Properties>`;
}

// ---------- Word ----------

function docxPaket() {
  const abs = (...runs) => "<w:p>" + runs.join("") + "</w:p>";
  const run = (t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;

  const koerper = [
    abs(run("Angebot für Rosa Feld"), run("mann")),                          // Name über zwei Runs
    abs(run("Sehr geehrte Frau Feldmann, anbei unser Angebot für die Halle in der Kaistraße 4, 24103 Kiel.")),
    abs(run("Ihre Ansprechpartnerin ist Marlene Ostwald, erreichbar unter 0431 7788990 oder marlene.ostwald@nordwind-logistik.example.")),
    abs(run("Zahlung auf DE02 1203 0000 0000 2020 51, Kundennummer 884 512 003.")),
    '<w:p><w:del w:author="Marlene Ostwald" w:date="2026-09-08T11:20:00Z" w:id="9">'
      + '<w:r><w:delText xml:space="preserve">Frühere Fassung: Rabatt für Rosa Feldmann auf 12 Prozent.</w:delText></w:r></w:del></w:p>',
    abs(run("Mit freundlichen Grüßen, Jonas Kertesz")),
    '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"'
      + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
      + '<wp:extent cx="457200" cy="457200"/><wp:docPr id="1" name="Logo"/>'
      + `<a:graphic ${NS_A}><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
      + '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
      + '<pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr>'
      + '<pic:blipFill><a:blip r:embed="rId7"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
      + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm>'
      + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
      + "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>",
    '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId4"/>'
      + '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417"/></w:sectPr></w:pPr></w:p>',
  ].join("");

  return {
    "[Content_Types].xml": typen(
      [["rels", "application/vnd.openxmlformats-package.relationships+xml"], ["xml", "application/xml"], ["png", "image/png"]],
      [
        ["/word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"],
        ["/word/header1.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"],
        ["/word/footnotes.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"],
        ["/word/comments.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"],
        ["/word/styles.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"],
        ["/docProps/core.xml", CT_CORE],
        ["/docProps/app.xml", CT_APP],
      ],
    ),
    "_rels/.rels": rels(["rId1", T.doc, "word/document.xml"], ["rId2", T.core, "docProps/core.xml"], ["rId3", T.app, "docProps/app.xml"]),
    "word/_rels/document.xml.rels": rels(
      ["rId4", T.header, "header1.xml"],
      ["rId5", T.footnotes, "footnotes.xml"],
      ["rId6", T.comments, "comments.xml"],
      ["rId7", T.image, "media/logo.png"],
      ["rId8", T.styles, "styles.xml"],
    ),
    "word/document.xml": `${DECL}<w:document ${NS_W} ${NS_R}><w:body>${koerper}</w:body></w:document>`,
    "word/header1.xml": `${DECL}<w:hdr ${NS_W} ${NS_R}>${abs(run("Nordwind Logistik GmbH, Kaistraße 4, 24103 Kiel"))}</w:hdr>`,
    "word/footnotes.xml": `${DECL}<w:footnotes ${NS_W} ${NS_R}><w:footnote w:id="1">`
      + abs(run("Preise geprüft von Rosa Feldmann am 8. September 2026.")) + "</w:footnote></w:footnotes>",
    "word/comments.xml": `${DECL}<w:comments ${NS_W} ${NS_R}><w:comment w:id="1" w:author="Marlene Ostwald" w:initials="MO" w:date="2026-09-09T08:15:00Z">`
      + abs(run("Bitte vor dem Versand mit Jonas Kertesz abstimmen.")) + "</w:comment></w:comments>",
    "word/styles.xml": `${DECL}<w:styles ${NS_W}><w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault><w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults></w:styles>`,
    "word/media/logo.png": PNG_1x1,
    "docProps/core.xml": coreXml({
      titel: "Angebot für Rosa Feldmann",
      autor: "Marlene Ostwald",
      thema: "Halle Kaistraße, Rosa Feldmann",
      stichworte: "Angebot, Feldmann Textil GmbH",
    }),
    "docProps/app.xml": appXml("Nordwind Logistik GmbH", "Jonas Kertesz"),
  };
}

// ---------- PowerPoint ----------

const THEME = (name) => `${DECL}<a:theme ${NS_A} name="${name}"><a:themeElements>`
  + '<a:clrScheme name="Deckname"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>'
  + '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2>'
  + '<a:lt2><a:srgbClr val="E5E7EB"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1>'
  + '<a:accent2><a:srgbClr val="7C3AED"/></a:accent2><a:accent3><a:srgbClr val="059669"/></a:accent3>'
  + '<a:accent4><a:srgbClr val="D97706"/></a:accent4><a:accent5><a:srgbClr val="DC2626"/></a:accent5>'
  + '<a:accent6><a:srgbClr val="0891B2"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>'
  + '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>'
  + '<a:fontScheme name="Deckname"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
  + '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
  + '<a:fmtScheme name="Deckname">'
  + '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
  + '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
  + "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>"
  + '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>'
  + "</a:fmtScheme></a:themeElements></a:theme>";

const LEER_SPTREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
  + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

const CLR_MAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3"'
  + ' accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

function textFeld(id, name, x, y, cx, cy, absaetze, groesse) {
  const laeufe = absaetze.map((zeile) => "<a:p><a:r>"
    + `<a:rPr lang="de-DE" sz="${groesse}" dirty="0"/><a:t>${zeile}</a:t></a:r></a:p>`).join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
    + `<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${laeufe}</p:txBody></p:sp>`;
}

// Zwei getrennte Läufe, damit ein Name auch in der Folie über zwei Knoten geht
const GETEILTER_LAUF = '<p:sp><p:nvSpPr><p:cNvPr id="9" name="Kunde"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="838200" y="3000000"/><a:ext cx="9000000" cy="700000"/></a:xfrm>'
  + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
  + '<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p>'
  + '<a:r><a:rPr lang="de-DE" sz="2400" dirty="0"/><a:t>Kundin: Rosa Feld</a:t></a:r>'
  + '<a:r><a:rPr lang="de-DE" sz="2400" dirty="0"/><a:t>mann, Feldmann Textil GmbH</a:t></a:r>'
  + "</a:p></p:txBody></p:sp>";

function pptxPaket() {
  return {
    "[Content_Types].xml": typen(
      [["rels", "application/vnd.openxmlformats-package.relationships+xml"], ["xml", "application/xml"]],
      [
        ["/ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"],
        ["/ppt/slideMasters/slideMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"],
        ["/ppt/slideLayouts/slideLayout1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"],
        ["/ppt/slides/slide1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"],
        ["/ppt/slides/slide2.xml", "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"],
        ["/ppt/notesMasters/notesMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"],
        ["/ppt/notesSlides/notesSlide1.xml", "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"],
        ["/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"],
        ["/ppt/theme/theme2.xml", "application/vnd.openxmlformats-officedocument.theme+xml"],
        ["/docProps/core.xml", CT_CORE],
        ["/docProps/app.xml", CT_APP],
      ],
    ),
    "_rels/.rels": rels(["rId1", T.doc, "ppt/presentation.xml"], ["rId2", T.core, "docProps/core.xml"], ["rId3", T.app, "docProps/app.xml"]),
    "ppt/presentation.xml": `${DECL}<p:presentation ${NS_A} ${NS_R} ${NS_P}>`
      + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
      + '<p:notesMasterIdLst><p:notesMasterId r:id="rId4"/></p:notesMasterIdLst>'
      + '<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst>'
      + '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
    "ppt/_rels/presentation.xml.rels": rels(
      ["rId1", T.slideMaster, "slideMasters/slideMaster1.xml"],
      ["rId2", T.slide, "slides/slide1.xml"],
      ["rId3", T.slide, "slides/slide2.xml"],
      ["rId4", T.notesMaster, "notesMasters/notesMaster1.xml"],
      ["rId5", T.theme, "theme/theme1.xml"],
    ),
    "ppt/slideMasters/slideMaster1.xml": `${DECL}<p:sldMaster ${NS_A} ${NS_R} ${NS_P}><p:cSld>${LEER_SPTREE}</p:spTree></p:cSld>${CLR_MAP}`
      + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": rels(["rId1", T.slideLayout, "../slideLayouts/slideLayout1.xml"], ["rId2", T.theme, "../theme/theme1.xml"]),
    "ppt/slideLayouts/slideLayout1.xml": `${DECL}<p:sldLayout ${NS_A} ${NS_R} ${NS_P} type="blank" preserve="1"><p:cSld name="Leer">${LEER_SPTREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels(["rId1", T.slideMaster, "../slideMasters/slideMaster1.xml"]),
    "ppt/slides/slide1.xml": `${DECL}<p:sld ${NS_A} ${NS_R} ${NS_P}><p:cSld>${LEER_SPTREE}`
      + textFeld(2, "Titel", 838200, 1200000, 10515600, 1200000, ["Nordwind Logistik GmbH"], 4000)
      + GETEILTER_LAUF
      + "</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>",
    "ppt/slides/_rels/slide1.xml.rels": rels(["rId1", T.slideLayout, "../slideLayouts/slideLayout1.xml"], ["rId2", T.notesSlide, "../notesSlides/notesSlide1.xml"]),
    "ppt/slides/slide2.xml": `${DECL}<p:sld ${NS_A} ${NS_R} ${NS_P}><p:cSld>${LEER_SPTREE}`
      + textFeld(2, "Kontakt", 838200, 1200000, 10515600, 3000000, [
        "Kontakt: Marlene Ostwald",
        "marlene.ostwald@nordwind-logistik.example",
        "Telefon 0431 7788990",
        "Lager: Kaistraße 4, 24103 Kiel",
      ], 2400)
      + "</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>",
    "ppt/slides/_rels/slide2.xml.rels": rels(["rId1", T.slideLayout, "../slideLayouts/slideLayout1.xml"]),
    "ppt/notesMasters/notesMaster1.xml": `${DECL}<p:notesMaster ${NS_A} ${NS_R} ${NS_P}><p:cSld>${LEER_SPTREE}</p:spTree></p:cSld>${CLR_MAP}</p:notesMaster>`,
    "ppt/notesMasters/_rels/notesMaster1.xml.rels": rels(["rId1", T.theme, "../theme/theme2.xml"]),
    "ppt/notesSlides/notesSlide1.xml": `${DECL}<p:notes ${NS_A} ${NS_R} ${NS_P}><p:cSld>${LEER_SPTREE}`
      + textFeld(2, "Notizen", 0, 0, 6858000, 4000000, ["Notiz: Vor dem Termin Jonas Kertesz anrufen, Rabatt mit Rosa Feldmann klären."], 1200)
      + "</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>",
    "ppt/notesSlides/_rels/notesSlide1.xml.rels": rels(["rId1", T.slide, "../slides/slide1.xml"], ["rId2", T.notesMaster, "../notesMasters/notesMaster1.xml"]),
    "ppt/theme/theme1.xml": THEME("Deckname Folien"),
    "ppt/theme/theme2.xml": THEME("Deckname Notizen"),
    "docProps/core.xml": coreXml({
      titel: "Nordwind Logistik für Feldmann Textil GmbH",
      autor: "Marlene Ostwald",
      thema: "Angebot Rosa Feldmann",
      stichworte: "Folien, Angebot",
    }),
    "docProps/app.xml": appXml("Nordwind Logistik GmbH", "Jonas Kertesz"),
  };
}

// ---------- PDF ----------

// Handgeschriebenes PDF mit drei Textzeilen. Keine Umlaute, damit ohne Zeichensatz-Tabelle nichts verrutscht.
function baueTextPdf() {
  const zeilen = [
    "Rechnung 2026-1188 an Rosa Feldmann",
    "Feldmann Textil GmbH, Kaistrasse 4, 24103 Kiel",
    "Betrag 4.820,00 EUR, IBAN DE02 1203 0000 0000 2020 51",
    "Rueckfragen an Marlene Ostwald, Telefon 0431 7788990",
  ];
  const strom = "BT /F1 12 Tf 72 780 Td 18 TL "
    + zeilen.map((z) => `(${z.replace(/([()\\])/g, "\\$1")}) Tj T*`).join(" ")
    + " ET";

  const objekte = [
    "<</Type /Catalog /Pages 2 0 R>>",
    "<</Type /Pages /Kids [3 0 R] /Count 1>>",
    "<</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>>",
    "<</Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding>>",
    `<</Length ${Buffer.byteLength(strom, "latin1")}>>\nstream\n${strom}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const positionen = [];
  objekte.forEach((inhalt, i) => {
    positionen.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${inhalt}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`;
  for (const pos of positionen) pdf += String(pos).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<</Size ${objekte.length + 1} /Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

// ---------- Textdateien ----------

const TXT = `Notiz vom 10.09.2026

Rosa Feldmann hat wegen des Angebots angerufen. Sie will den Rabatt auf 12 Prozent.
Jonas Kertesz prueft das bis Freitag und meldet sich bei marlene.ostwald@nordwind-logistik.example.
Rueckruf unter 0431 7788990, Kundennummer 884 512 003.
`;

const MD = `# Protokoll Nordwind Logistik, 10.09.2026

**Dabei:** Rosa Feldmann (Feldmann Textil GmbH), Jonas Kertesz, Marlene Ostwald

## Themen
- Halle in der Kaistraße 4, 24103 Kiel ab Januar 2027
- Zahlung auf DE02 1203 0000 0000 2020 51
- Rabatt: Rosa Feldmann will 12 Prozent, Jonas Kertesz bietet 8 Prozent

## Nächste Schritte
| Wer | Was | Bis |
| --- | --- | --- |
| Marlene Ostwald | Angebot neu rechnen | 12.09.2026 |
| Jonas Kertesz | Rücksprache mit der Geschäftsführung | 15.09.2026 |
`;

// ---------- Schreiben ----------

async function schreibePaket(ziel, dateien) {
  const zip = new JSZip();
  for (const [name, inhalt] of Object.entries(dateien)) zip.file(name, inhalt);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(ziel, bytes);
  return bytes.length;
}

async function main() {
  const ziel = process.argv[2];
  if (!ziel) {
    console.error("Aufruf: node tools/deckname-testfiles.mjs <zielordner>");
    process.exit(1);
  }
  fs.mkdirSync(ziel, { recursive: true });

  const gebaut = [];
  const p = (name) => path.join(ziel, name);

  gebaut.push([p("Angebot Rosa Feldmann.docx"), await schreibePaket(p("Angebot Rosa Feldmann.docx"), docxPaket())]);
  gebaut.push([p("Nordwind Folien.pptx"), await schreibePaket(p("Nordwind Folien.pptx"), pptxPaket())]);

  fs.writeFileSync(p("Rechnung Feldmann.pdf"), baueTextPdf());
  gebaut.push([p("Rechnung Feldmann.pdf"), fs.statSync(p("Rechnung Feldmann.pdf")).size]);

  fs.writeFileSync(p("Notiz Rosa Feldmann.txt"), TXT, "utf8");
  gebaut.push([p("Notiz Rosa Feldmann.txt"), fs.statSync(p("Notiz Rosa Feldmann.txt")).size]);

  fs.writeFileSync(p("Protokoll Nordwind.md"), MD, "utf8");
  gebaut.push([p("Protokoll Nordwind.md"), fs.statSync(p("Protokoll Nordwind.md")).size]);

  // Datei, die Deckname ablehnen muss (für die Fehlerzeile in der Oberfläche)
  fs.writeFileSync(p("Zahlen wird abgelehnt.xlsx"), "keine echte Tabelle, nur zum Testen der Ablehnung\n", "utf8");
  gebaut.push([p("Zahlen wird abgelehnt.xlsx"), fs.statSync(p("Zahlen wird abgelehnt.xlsx")).size]);

  console.log("Testdateien geschrieben (alle Namen und Nummern sind erfunden):");
  for (const [datei, groesse] of gebaut) console.log("  " + datei + "  (" + groesse + " Byte)");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
