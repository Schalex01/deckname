// Tests für die Speicherregeln von Deckname 0.4 und 0.5: flüchtiger Kreis, Lernen beim Kopieren, Migration,
// Schreibweisen, Rückweg-Form, Karten zusammenlegen und zurückholen.
// Ausführen: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { detect, assignPlaceholders, protect, restore, newSession } from "../deckname/engine.js";
import {
  learnable, nextFreeNumber, freeDictPlaceholder, freeVolatilePlaceholder, promote, restoreMapping, migrate,
  DICT_MAX, VOLATILE_MIN, STORE_VERSION,
  spellings, addAlias, removeAlias, setRestoreForm, findBySpelling, suggestCards, mergeInto, unmerge, mergedOwner, similarCards, allPlaceholders,
} from "../deckname/store.js";

// Ein Wörterbuch, wie 0.3 es in localStorage (deckname.v2) abgelegt hat: kein version-Feld, jeder Treffer dauerhaft,
// auch Mailadressen, Telefonnummern und IBANs mit origin "regex".
const ALT_0_3 = {
  dict: [
    { id: "a1", original: "Sabine Meyer", aliases: [], type: "PERSON", placeholder: "PERSON_1", origin: "confirmed" },
    { id: "a2", original: "katrin.schulz@example.org", aliases: [], type: "MAIL", placeholder: "MAIL_1", origin: "regex" },
    { id: "a3", original: "+49 172 5551234", aliases: [], type: "TELEFON", placeholder: "TELEFON_1", origin: "regex" },
    { id: "a4", original: "DE89 3704 0044 0532 0130 00", aliases: [], type: "IBAN", placeholder: "IBAN_1", origin: "regex" },
    { id: "a5", original: "Musterstraße 12a", aliases: [], type: "ORT", placeholder: "ORT_1", origin: "regex" },
    { id: "a6", original: "Nordlicht Medien GmbH", aliases: ["Nordlicht"], type: "FIRMA", placeholder: "FIRMA_1", origin: "guess" },
    { id: "a7", original: "Projekt Polarstern", aliases: [], type: "SONSTIGES", placeholder: "CODE_X", origin: "manual" },
    { id: "a8", original: "4539 1488 0343 6467", aliases: [], type: "KARTE", placeholder: "KARTE_1", origin: "regex" },
    { id: "a9", original: "86095742719", aliases: [], type: "NUMMER", placeholder: "NUMMER_1", origin: "regex" },
    { id: "a10", original: "4471-2209", aliases: [], type: "NUMMER", placeholder: "NUMMER_2", origin: "guess" },
  ],
  ignored: [{ text: "Thomas", type: "PERSON" }],
  settings: { preamble: true, tourDone: true, theme: "dark" },
};

test("Migration 0.3 → 0.4: Kontaktdaten und Nummern aus der Mustererkennung fliegen raus, der Rest bleibt", () => {
  const { data, removed } = migrate(structuredClone(ALT_0_3));
  assert.equal(data.version, STORE_VERSION);
  assert.deepEqual(removed.map((e) => e.original).sort(), [
    "+49 172 5551234", "4539 1488 0343 6467", "86095742719", "DE89 3704 0044 0532 0130 00", "Musterstraße 12a", "katrin.schulz@example.org",
  ].sort());
  assert.deepEqual(data.dict.map((e) => e.original), [
    "Sabine Meyer", "Nordlicht Medien GmbH", "Projekt Polarstern", "4471-2209",
  ]);
  // Alles aus der Mustererkennung (auch die Adresse) hat 0.3 ohne Bestätigung gespeichert: raus. Vermutungen und
  // von Hand Markiertes bleiben, Schlüsselwort-Nummern sind Vermutungen.
  assert.deepEqual(data.ignored, [{ text: "Thomas", type: "PERSON" }]);
  assert.equal(data.settings.tourDone, true);
});

test("Migration ist idempotent und verträgt leere oder kaputte Daten", () => {
  const once = migrate(structuredClone(ALT_0_3)).data;
  const twice = migrate(structuredClone(once));
  assert.equal(twice.removed.length, 0);
  assert.deepEqual(twice.data.dict, once.dict);
  assert.deepEqual(migrate(null).data, { dict: [], ignored: [], settings: {}, version: STORE_VERSION });
  assert.deepEqual(migrate({ dict: [null, { original: "x" }], ignored: "nein" }).data.dict, []);
});

test("Migration: 0.3-Platzhalter außerhalb des Wörterbuchbereichs werden neu nummeriert", () => {
  const { data } = migrate({ dict: [{ id: "q", original: "Anna Berg", aliases: [], type: "PERSON", placeholder: "PERSON_10002", origin: "guess" }] });
  assert.equal(data.dict[0].placeholder, "PERSON_1");
});

test("Lernregel: Vermutungen und Adressen ja, Mail, Telefon, IBAN, Karte, Steuer-ID nie", () => {
  const v = (type, origin) => ({ type, origin });
  assert.equal(learnable(v("PERSON", "guess")), true);
  assert.equal(learnable(v("FIRMA", "guess")), true);
  assert.equal(learnable(v("NUMMER", "guess")), true);   // Kunden-Nr. per Schlüsselwort
  assert.equal(learnable(v("ORT", "regex")), true);      // Straße, PLZ
  assert.equal(learnable(v("MAIL", "regex")), false);
  assert.equal(learnable(v("TELEFON", "regex")), false);
  assert.equal(learnable(v("IBAN", "regex")), false);
  assert.equal(learnable(v("KARTE", "regex")), false);
  assert.equal(learnable(v("NUMMER", "regex")), false);  // Steuer-ID
  assert.equal(learnable(v("MAIL", "manual")), true);     // von Hand markiert ist immer dauerhaft
});

test("Nummernkreise: Wörterbuch 1 bis 899, flüchtig ab 10000, Lücken werden gefüllt", () => {
  assert.equal(nextFreeNumber("PERSON", ["PERSON_1", "PERSON_2", "PERSON_4"], 1, DICT_MAX), 3);
  assert.equal(nextFreeNumber("PERSON", [], VOLATILE_MIN, 99999), 10000);
  const dict = [{ placeholder: "PERSON_1" }], vol = [{ placeholder: "PERSON_10000" }], former = [{ placeholder: "PERSON_2" }];
  assert.equal(freeDictPlaceholder("PERSON", dict, vol, former), "PERSON_3");
  assert.equal(freeDictPlaceholder("PERSON", dict, vol, former, "CHEF_M"), "CHEF_M");
  assert.equal(freeDictPlaceholder("PERSON", dict, vol, former, "PERSON_1"), "PERSON_3");
  assert.equal(freeVolatilePlaceholder("PERSON", dict, vol, former), "PERSON_10001");
  assert.equal(freeVolatilePlaceholder("FIRMA", dict, vol, former), "FIRMA_10000");
  // Volle 899: es wird nie in den flüchtigen Bereich hochgezählt
  const voll = Array.from({ length: DICT_MAX }, (_, i) => `PERSON_${i + 1}`);
  assert.equal(nextFreeNumber("PERSON", voll, 1, DICT_MAX), DICT_MAX);
});

test("Erkennung: flüchtiger Eintrag schlägt die rohe Vermutung und behält seinen Platzhalter, Regex-Treffer bleiben", () => {
  const volatile = [{ id: "v1", original: "Sabine Meyer", aliases: [], type: "PERSON", placeholder: "PERSON_10000", origin: "guess", reason: "Vorname aus der Liste plus Nachname" }];
  const text = "Sabine Meyer schrieb an anna@example.org. Sabine Meyer antwortete.";
  const matches = detect(text, [], [], new Set(), volatile);
  assert.deepEqual(matches.map((m) => [m.text, m.source]), [["Sabine Meyer", "volatile"], ["anna@example.org", "regex"], ["Sabine Meyer", "volatile"]]);
  assert.equal(matches[0].reason, "Vorname aus der Liste plus Nachname");
  const items = assignPlaceholders(matches, [], newSession(), volatile);
  assert.equal(protect(text, items).text, "PERSON_10000 schrieb an MAIL_1. PERSON_10000 antwortete.");
});

test("Erkennung: Wörterbuch schlägt flüchtig, längerer Volltreffer schlägt kurzen Wörterbucheintrag", () => {
  const dict = [{ id: "d1", original: "Sabine", aliases: [], type: "PERSON", placeholder: "PERSON_1" }];
  const volatile = [{ id: "v1", original: "Sabine Meyer", aliases: [], type: "PERSON", placeholder: "PERSON_10000", origin: "guess" }];
  const text = "Sabine Meyer und Sabine.";
  const items = assignPlaceholders(detect(text, dict, [], new Set(), volatile), dict, newSession(), volatile);
  assert.equal(protect(text, items).text, "PERSON_10000 und PERSON_1.");
});

test("Kopieren lernt: nur die Treffer im Text, nur lernbare, mit Wörterbuchnummer und Rückweg über den alten Platzhalter", () => {
  const dict = [{ id: "d1", original: "Max Berger", aliases: [], type: "PERSON", placeholder: "PERSON_1", origin: "manual" }];
  const volatile = [
    { id: "v1", original: "Sabine Meyer", aliases: [], type: "PERSON", placeholder: "PERSON_10000", origin: "guess" },
    { id: "v2", original: "katrin.schulz@example.org", aliases: [], type: "MAIL", placeholder: "MAIL_10000", origin: "regex" },
    { id: "v3", original: "Nordlicht Medien GmbH", aliases: [], type: "FIRMA", placeholder: "FIRMA_10000", origin: "guess" },
    { id: "v4", original: "Klaus Roth", aliases: [], type: "PERSON", placeholder: "PERSON_10001", origin: "guess" }, // stand nicht im kopierten Text
    { id: "v5", original: "Musterstraße 12a", aliases: [], type: "ORT", placeholder: "ORT_10000", origin: "regex" },
  ];
  const r = promote(dict, volatile, [], ["d1", "v1", "v2", "v3", "v5"]);
  assert.deepEqual(r.learned.map((e) => [e.original, e.placeholder, e.origin]), [
    ["Sabine Meyer", "PERSON_2", "confirmed"], ["Nordlicht Medien GmbH", "FIRMA_1", "confirmed"], ["Musterstraße 12a", "ORT_1", "confirmed"],
  ]);
  assert.deepEqual(r.volatile.map((e) => e.id), ["v2", "v4"]);
  assert.equal(r.dict.length, 4);
  assert.deepEqual(r.former.map((f) => f.placeholder), ["PERSON_10000", "FIRMA_10000", "ORT_10000"]);
  // Eingaben bleiben unverändert (reine Funktion)
  assert.equal(dict.length, 1);
  assert.equal(volatile.length, 5);

  // Der kopierte Text trägt noch die flüchtigen Nummern, der Rückweg muss sie trotzdem auflösen
  const antwort = "PERSON_10000 von FIRMA_10000 (MAIL_10000) wohnt in ORT_10000, PERSON_2 auch, PERSON_1 nicht.";
  const back = restore(antwort, restoreMapping(r.dict, r.volatile, r.former));
  assert.equal(back.text, "Sabine Meyer von Nordlicht Medien GmbH (katrin.schulz@example.org) wohnt in Musterstraße 12a, Sabine Meyer auch, Max Berger nicht.");
  assert.deepEqual(back.leftover, []);

  // Nächster Text in derselben Sitzung: gelernte Begriffe kommen aus dem Wörterbuch mit der neuen Nummer
  const text2 = "Sabine Meyer schreibt Klaus Roth.";
  const items = assignPlaceholders(detect(text2, r.dict, [], new Set(), r.volatile), r.dict, newSession(), r.volatile);
  assert.equal(protect(text2, items).text, "PERSON_2 schreibt PERSON_10001.");
});

test("Kopieren ohne lernbare Treffer ändert nichts", () => {
  const volatile = [{ id: "v2", original: "a@b.de", aliases: [], type: "MAIL", placeholder: "MAIL_10000", origin: "regex" }];
  const r = promote([], volatile, [], ["v2"]);
  assert.equal(r.learned.length, 0);
  assert.deepEqual(r.volatile, volatile);
  assert.deepEqual(r.former, []);
});

// ---------- 0.5: Schreibweisen, Rückweg-Form, Karten aufnehmen ----------

const KARTEN = () => [
  { id: "f1", original: "Kranich GmbH", aliases: [], type: "FIRMA", placeholder: "FIRMA_1", origin: "confirmed" },
  { id: "f3", original: "KRANICH", aliases: ["kranich.de"], type: "FIRMA", placeholder: "FIRMA_3", origin: "manual" },
  { id: "p1", original: "Sabine Meyer", aliases: ["Meyer"], type: "PERSON", placeholder: "PERSON_1", origin: "confirmed" },
  { id: "p2", original: "Sabine Meyers", aliases: [], type: "PERSON", placeholder: "PERSON_2", origin: "guess" },
  { id: "f7", original: "Nordlicht Medien GmbH", aliases: [], type: "FIRMA", placeholder: "FIRMA_7", origin: "guess" },
];

test("Schreibweisen: dazu, weg, doppelte und die Rückweg-Form selbst werden ignoriert", () => {
  const e = KARTEN()[0];
  const a = addAlias(e, " Kranich ");
  assert.deepEqual(spellings(a), ["Kranich GmbH", "Kranich"]);
  assert.equal(addAlias(a, "kranich"), a, "gleiche Schreibweise in anderer Groß/Kleinschreibung bleibt eine");
  assert.equal(addAlias(a, "Kranich GmbH"), a);
  assert.equal(addAlias(a, "  "), a);
  assert.deepEqual(removeAlias(a, "KRANICH").aliases, []);
  assert.equal(e.aliases.length, 0, "reine Funktion, Eingabe unverändert");
});

test("Rückweg-Form ändern: alte Form bleibt als Schreibweise geschützt, vorhandene rückt nach vorn", () => {
  const e = KARTEN()[1]; // KRANICH, Schreibweise kranich.de
  const n = setRestoreForm(e, "Kranich GmbH");
  assert.equal(n.original, "Kranich GmbH");
  assert.deepEqual(n.aliases, ["kranich.de", "KRANICH"]);
  assert.deepEqual(restoreMapping([n]), [{ placeholder: "FIRMA_3", original: "Kranich GmbH" }]);
  // Steht die neue Form schon als Schreibweise drauf, verschwindet sie dort und die alte Form kommt dazu
  const m = setRestoreForm(n, "kranich.de");
  assert.equal(m.original, "kranich.de");
  assert.deepEqual(m.aliases, ["KRANICH", "Kranich GmbH"]);
  assert.equal(setRestoreForm(e, "kranich"), e, "nur Groß/Kleinschreibung anders: keine Änderung");
  // Im Text werden weiter alle Formen zu FIRMA_3
  const text = "KRANICH und kranich.de und Kranich GmbH";
  assert.equal(protect(text, assignPlaceholders(detect(text, [m]), [m], newSession())).text, "FIRMA_3 und FIRMA_3 und FIRMA_3");
});

test("Vorschläge beim Tippen und Suche nach Schreibweise, die eigene Karte ausgenommen", () => {
  const dict = KARTEN();
  assert.deepEqual(suggestCards(dict, "kra", "f1").map((s) => [s.entry.placeholder, s.hit]), [["FIRMA_3", "KRANICH"]]);
  assert.deepEqual(suggestCards(dict, "kra").map((s) => s.entry.placeholder), ["FIRMA_1", "FIRMA_3"]);
  assert.deepEqual(suggestCards(dict, "r"), [], "erst ab zwei Zeichen");
  assert.equal(findBySpelling(dict, "meyer").id, "p1");
  assert.equal(findBySpelling(dict, "Meyer", "p1"), null);
  assert.equal(findBySpelling(dict, "Niemand"), null);
});

test("Karte aufnehmen: Schreibweisen wandern mit, alter Platzhalter bleibt reserviert und im Rückweg auflösbar", () => {
  const dict = KARTEN();
  const out = mergeInto(dict, "f1", "f3");
  assert.equal(out.length, 4);
  assert.equal(out.find((e) => e.id === "f3"), undefined);
  const f1 = out.find((e) => e.id === "f1");
  assert.deepEqual(spellings(f1), ["Kranich GmbH", "KRANICH", "kranich.de"]);
  assert.deepEqual(f1.altLabels, ["FIRMA_3"]);
  assert.equal(f1.merged.length, 1);
  assert.equal(f1.merged[0].placeholder, "FIRMA_3");
  assert.equal(mergedOwner(f1, "kranich.de").id, "f3");
  assert.equal(mergedOwner(f1, "Kranich GmbH"), null);
  assert.equal(dict.length, 5, "reine Funktion");
  assert.equal(mergeInto(dict, "f1", "f1"), dict);
  assert.equal(mergeInto(dict, "f1", "gibtsnicht"), dict);

  // Im Text werden alle Formen zu FIRMA_1
  const text = "Die KRANICH (Kranich GmbH, kranich.de) lädt ein.";
  assert.equal(protect(text, assignPlaceholders(detect(text, out), out, newSession())).text, "Die FIRMA_1 (FIRMA_1, FIRMA_1) lädt ein.");

  // Eine ältere KI-Antwort mit FIRMA_3 kommt trotzdem zurück, und zwar in der Rückweg-Form der Karte
  const back = restore("FIRMA_3 und FIRMA_1 arbeiten mit PERSON_1.", restoreMapping(out));
  assert.equal(back.text, "Kranich GmbH und Kranich GmbH arbeiten mit Sabine Meyer.");
  assert.deepEqual(back.leftover, []);

  // FIRMA_3 wird nie neu vergeben, solange es als alter Platzhalter an der Karte hängt
  assert.ok(allPlaceholders(out).includes("FIRMA_3"));
  assert.equal(freeDictPlaceholder("FIRMA", out), "FIRMA_2");
  const ohneZwei = out.concat([{ id: "x", original: "X", type: "FIRMA", placeholder: "FIRMA_2" }]);
  assert.equal(freeDictPlaceholder("FIRMA", ohneZwei), "FIRMA_4");
});

test("Karte zurückholen: × am gestrichelten Chip stellt die Karte unverändert wieder her", () => {
  const dict = KARTEN();
  const merged = mergeInto(dict, "f1", "f3");
  const back = unmerge(merged, "f1", "f3");
  assert.equal(back.length, 5);
  const f1 = back.find((e) => e.id === "f1");
  const f3 = back.find((e) => e.id === "f3");
  assert.deepEqual(f1, dict[0]);
  assert.deepEqual(f3, dict[1]);
  assert.equal(back.indexOf(f3), back.indexOf(f1) + 1, "die Karte steht direkt hinter der, aus der sie kommt");
  assert.equal(unmerge(merged, "f1", "gibtsnicht"), merged);
  // Kette: f7 in f3, f3 in f1, dann f7 einzeln zurück
  const kette = mergeInto(mergeInto(dict, "f3", "f7"), "f1", "f3");
  const k1 = kette.find((e) => e.id === "f1");
  assert.deepEqual(k1.altLabels, ["FIRMA_3", "FIRMA_7"]);
  assert.deepEqual(k1.merged.map((m) => m.id), ["f3", "f7"]);
  assert.equal(restore("FIRMA_7", restoreMapping(kette)).text, "Kranich GmbH");
  const wieder7 = unmerge(kette, "f1", "f7");
  assert.deepEqual(spellings(wieder7.find((e) => e.id === "f1")), ["Kranich GmbH", "KRANICH", "kranich.de"]);
  assert.deepEqual(wieder7.find((e) => e.id === "f1").altLabels, ["FIRMA_3"]);
  assert.equal(wieder7.find((e) => e.id === "f7").placeholder, "FIRMA_7");
});

test("Ähnlich: gleicher Typ und gemeinsamer Wortkern ab vier Buchstaben, Rechtsformen zählen nicht", () => {
  const dict = KARTEN();
  assert.deepEqual(similarCards(dict, dict[0]).map((e) => e.placeholder), ["FIRMA_3"], "Kranich GmbH ~ KRANICH, nicht Nordlicht Medien GmbH (nur GmbH gemeinsam)");
  assert.deepEqual(similarCards(dict, dict[2]).map((e) => e.placeholder), ["PERSON_2"], "Meyer ~ Meyers (Genitiv)");
  assert.deepEqual(similarCards(dict, dict[4]), []);
  const kurz = [{ id: "a", original: "Max Ott", type: "PERSON", placeholder: "PERSON_1" }, { id: "b", original: "Max Roth", type: "PERSON", placeholder: "PERSON_2" }];
  assert.deepEqual(similarCards(kurz, kurz[0]), [], "drei Buchstaben reichen nicht");
  const typen = [{ id: "a", original: "Kranich GmbH", type: "FIRMA", placeholder: "FIRMA_1" }, { id: "b", original: "Kranich", type: "SONSTIGES", placeholder: "SONSTIGES_1" }];
  assert.deepEqual(similarCards(typen, typen[0]), [], "andere Art wird nicht vorgeschlagen");
});

test("Migration 0.4 → 0.5 behält Karten mit altLabels und merged, wirft kaputte Felder weg", () => {
  const { data } = migrate({ version: 4, dict: [
    { id: "f1", original: "Kranich GmbH", aliases: ["KRANICH"], type: "FIRMA", placeholder: "FIRMA_1", origin: "confirmed", altLabels: ["FIRMA_3", 7], merged: [{ id: "f3", original: "KRANICH", aliases: [], type: "FIRMA", placeholder: "FIRMA_3" }, null] },
    { id: "f2", original: "X AG", aliases: [], type: "FIRMA", placeholder: "FIRMA_2", altLabels: "nein", merged: [] },
  ] });
  assert.equal(data.version, STORE_VERSION);
  assert.deepEqual(data.dict[0].altLabels, ["FIRMA_3"]);
  assert.equal(data.dict[0].merged.length, 1);
  assert.equal(data.dict[1].altLabels, undefined);
  assert.equal(data.dict[1].merged, undefined);
  assert.deepEqual(restoreMapping(data.dict).map((m) => m.placeholder), ["FIRMA_1", "FIRMA_3", "FIRMA_2"]);
});
