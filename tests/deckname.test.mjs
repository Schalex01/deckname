// Tests für die Deckname-Engine. Ausführen: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detect, assignPlaceholders, protect, restore, buildPreamble, newSession,
  luhnValid, ibanValid, steuerIdValid, normalizeKey, validPlaceholder,
} from "../deckname/engine.js";

const dict = [
  { id: "d1", original: "Max Mustermann", aliases: ["Max", "Herr Mustermann"], type: "PERSON", placeholder: "PERSON_1" },
  { id: "d2", original: "Sparkasse Hohenmoor", aliases: [], type: "FIRMA", placeholder: "FIRMA_1" },
  { id: "d3", original: "Sabine Örtel", aliases: [], type: "PERSON", placeholder: "CHEF_M" },
];

function run(text, d = dict, session = newSession(), sessionDict = [], disabled = new Set()) {
  const matches = detect(text, d, sessionDict, disabled);
  const items = assignPlaceholders(matches, d, session);
  const p = protect(text, items);
  return { matches, items, ...p, session };
}

test("Prüfsummen", () => {
  assert.equal(ibanValid("DE89 3704 0044 0532 0130 00"), true);
  assert.equal(ibanValid("DE89 3704 0044 0532 0130 01"), false);
  assert.equal(luhnValid("4539 1488 0343 6467"), true);
  assert.equal(luhnValid("4539 1488 0343 6468"), false);
  assert.equal(steuerIdValid("86095742719"), true);
  assert.equal(steuerIdValid("86095742718"), false);
});

test("Wörterbuch: fester Platzhalter über alle Vorkommen, Aliasse eingeschlossen", () => {
  const r = run("Max Mustermann kam. Max sagte, Herr Mustermann sei krank. Sabine Örtel lacht.");
  assert.equal(r.text, "PERSON_1 kam. PERSON_1 sagte, PERSON_1 sei krank. CHEF_M lacht.");
  assert.ok(r.items.every((i) => i.source === "dict"));
});

test("Regex: E-Mail, IBAN, Telefon, Karte, Straße, PLZ", () => {
  const t = "Mail an anna.k@example.org, IBAN DE89 3704 0044 0532 0130 00, Tel +49 172 5550198, Karte 4539 1488 0343 6467, Musterstraße 12a, 10115 Berlin.";
  const r = run(t, []);
  const types = r.items.map((i) => i.type);
  assert.deepEqual(types, ["MAIL", "IBAN", "TELEFON", "KARTE", "ORT", "ORT"]);
  assert.equal(r.text, "Mail an MAIL_1, IBAN IBAN_1, Tel TELEFON_1, Karte KARTE_1, ORT_1, ORT_2.");
});

test("Kein Telefon-Fehlalarm bei Datum, Beträgen und Jahreszahlen", () => {
  const r = run("Am 03.09.2026 und am 03/09/2026 wurden 12.500,00 Euro gezahlt, Rechnung 2026-09-037.", []);
  assert.equal(r.items.filter((i) => i.type === "TELEFON").length, 0);
});

test("Vermutung: Vorname aus der Liste zieht Nachnamen mit, stoppt an Satzgrenze und Stoppwort", () => {
  const r = run("Gestern rief Sabine Meyer an. Danach kam Thomas Und wir gingen. Katrin Schulz Danke.", []);
  const persons = r.items.filter((i) => i.type === "PERSON").map((i) => i.text);
  assert.deepEqual(persons, ["Sabine Meyer", "Thomas", "Katrin Schulz"]);
  assert.ok(r.items.every((i) => i.source === "guess"));
});

test("Vermutung: Anrede, Rechtsform, Bankname, Schlüsselwort-Nummer", () => {
  const r = run("Sehr geehrte Frau Dr. Hoffmann, die Nordwind Sisters GmbH i.G. und die Sparkasse Hohenmoor haben Konto-Nr. 123 456 789 bestätigt.", []);
  const got = r.items.map((i) => [i.type, i.text]);
  assert.deepEqual(got, [
    ["PERSON", "Dr. Hoffmann"],
    ["FIRMA", "Nordwind Sisters GmbH i.G."],
    ["FIRMA", "Sparkasse Hohenmoor"],
    ["NUMMER", "123 456 789"],
  ]);
});

test("Produkt- und Doppeldeutigkeits-Namen werden nicht erkannt", () => {
  const r = run("Ich habe Claude gefragt und im August mit Alexa gesprochen.", []);
  assert.equal(r.items.length, 0);
});

test("Kurznamen nur mit Nachnamen: 'Tim' allein bleibt, 'Tim Berger' wird erkannt", () => {
  const r = run("Tim kommt später. Tim Berger auch.", []);
  assert.deepEqual(r.items.map((i) => i.text), ["Tim Berger"]);
  const r2 = run("Tim kommt später.", [{ id: "x", original: "Tim", aliases: [], type: "PERSON", placeholder: "PERSON_1" }]);
  assert.equal(r2.text, "PERSON_1 kommt später.");
});

test("Abwahl (Opt-out) wirkt auf alle gleichen Stellen", () => {
  const disabled = new Set([normalizeKey("Thomas") + "|PERSON"]);
  const r = run("Thomas sagt, Thomas geht.", [], newSession(), [], disabled);
  assert.equal(r.items.length, 0);
});

test("Sitzung: gleicher Text bekommt gleichen Platzhalter, Nummern laufen hinter dem Wörterbuch weiter", () => {
  const session = newSession();
  const r = run("Anna Berg traf Anna Berg und Klaus Roth.", dict, session);
  assert.equal(r.text, "PERSON_2 traf PERSON_2 und PERSON_3.");
  const r2 = run("Klaus Roth wieder.", dict, session);
  assert.equal(r2.text, "PERSON_3 wieder.");
});

test("Manuelle Sitzungseinträge schlagen Vermutungen und behalten ihren Platzhalter", () => {
  const session = newSession();
  session.entries.push({ id: "s1", original: "Projekt Nordlicht", aliases: ["Nordlicht"], type: "SONSTIGES", placeholder: "SONSTIGES_1" });
  const r = run("Projekt Nordlicht startet, Nordlicht läuft bis Ende.", [], session, session.entries);
  assert.equal(r.text, "SONSTIGES_1 startet, SONSTIGES_1 läuft bis Ende.");
});

test("Rückweg toleriert Schreibvarianten des Modells", () => {
  const mapping = [
    { placeholder: "PERSON_1", original: "Max Mustermann" },
    { placeholder: "PERSON_12", original: "Zwölf" },
    { placeholder: "CHEF_M", original: "Sabine Örtel" },
    { placeholder: "FIRMA_1", original: "Nordwind Sisters GmbH" },
  ];
  const t = "**PERSON_1** traf <PERSON_12>, Person 1 und [Chef_M] bei `FIRMA_1`. PERSON-1 war da; PERSON_13 nicht.";
  const r = restore(t, mapping);
  assert.equal(r.text, "Max Mustermann traf Zwölf, Max Mustermann und Sabine Örtel bei Nordwind Sisters GmbH. Max Mustermann war da; PERSON_13 nicht.");
  assert.equal(r.count, 6);
});

test("Präambel listet nur verwendete Platzhalter, nie Originale", () => {
  const r = run("Max Mustermann und Sparkasse Hohenmoor.");
  const p = buildPreamble(r.used);
  assert.match(p, /PERSON_1 \(Person\)/);
  assert.match(p, /FIRMA_1 \(Firma\)/);
  assert.doesNotMatch(p, /Mustermann|Hohenmoor/);
});

test("Platzhalter-Label-Regel", () => {
  assert.equal(validPlaceholder("CHEF_M"), true);
  assert.equal(validPlaceholder("PERSON_1"), true);
  assert.equal(validPlaceholder("chef"), false);
  assert.equal(validPlaceholder("A B"), false);
});

test("Roundtrip: schützen und wiederherstellen ergibt den Originaltext", () => {
  const text = "Hallo Sabine Meyer, bitte überweise an DE89 3704 0044 0532 0130 00 und ruf +49 172 5550198 an. Grüße, Max Mustermann (Musterstraße 12a, 10115 Berlin).";
  const session = newSession();
  const r = run(text, dict, session);
  const mapping = [
    ...dict.map((e) => ({ placeholder: e.placeholder, original: e.original })),
    ...Object.entries(session.map).map(([placeholder, v]) => ({ placeholder, original: v.original })),
  ];
  assert.equal(restore(r.text, mapping).text, text);
});

test("Genitiv-s bleibt stehen, nur der Begriff wird ersetzt", () => {
  const r = run("Sabine Örtels Auto und Max Mustermanns Hund. Sabine Örtel selbst.");
  assert.equal(r.text, "CHEF_Ms Auto und PERSON_1s Hund. CHEF_M selbst.");
});

test("Doppelnamen aus zwei Vornamen werden erkannt", () => {
  const r = run("Hans-Peter Klein kam mit Anna-Lena. Nord-Süd blieb.", []);
  assert.deepEqual(r.items.map((i) => i.text), ["Hans-Peter Klein", "Anna-Lena"]);
});

test("Längerer Treffer gleichen Typs schlägt den kürzeren Wörterbuchtreffer", () => {
  const d = [{ id: "s", original: "Sabine", aliases: [], type: "PERSON", placeholder: "PERSON_1" }];
  const r = run("Heute kam Sabine Meyer. Sabine lacht.", d);
  assert.deepEqual(r.items.map((i) => [i.text, i.placeholder]), [["Sabine Meyer", "PERSON_2"], ["Sabine", "PERSON_1"]]);
});

test("Rückweg meldet unbekannte Platzhalter", () => {
  const r = restore("PERSON_1 traf PERSON_9 und Firma 3.", [{ placeholder: "PERSON_1", original: "Max" }]);
  assert.equal(r.text, "Max traf PERSON_9 und Firma 3.");
  assert.deepEqual(r.leftover, ["PERSON_9", "FIRMA_3"]);
});

test("Vermutungen enden an der Zeile: Name im Text klebt nicht an der Firma in der Kopfzeile", () => {
  const r = run("Jonas Kertesz\nNordwind Logistik GmbH\nFrau Dr. Meier\nAG", []);
  assert.deepEqual(r.items.map((i) => i.text), ["Jonas Kertesz", "Nordwind Logistik GmbH", "Dr. Meier"]);
});

test("Leftover: Firma 3 und Person_9 zählen, Telefon 0431 nicht", () => {
  const r = restore("Telefon 0431 7788990, Telefon 431 2233, Firma 3, Person_9, PERSON 12, person-4", []);
  assert.deepEqual(r.leftover, ["FIRMA_3", "PERSON_9", "PERSON_12", "PERSON_4"]);
});
