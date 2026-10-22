# Deckname

Deckname replaces people, companies, addresses and numbers in a text with placeholders before the text goes into an AI tool, and puts the real names back into the answer. It runs entirely in the browser.

Live version: https://a-schmitt.com/deckname

## How it works

1. Paste a text, or drop a Word (.docx), PowerPoint (.pptx), PDF, text (.txt, .md) or table (.csv, .tsv) file into the page. Excel files are not read; save them as CSV UTF-8 first.
2. Check the preview. Mark anything that is missing, remove anything that should stay, rename a placeholder if you like (for example `CHEF_M` instead of `PERSON_1`).
3. Copy the protected text into your AI tool. Paste the answer back into step 2. The names come back.

A name you marked by hand or copied keeps its placeholder, also in the next text. E-mail addresses, phone numbers, IBANs, card numbers and tax IDs are never stored. The dictionary lives only in this browser on this device. You can export it as a file; that file contains the real names.

## Privacy

Everything runs in the browser. No server sees the original text or the files.

The protected text you paste into an AI tool still goes to that provider. Deckname only takes the names out beforehand.

The live site on a-schmitt.com counts anonymous usage events via Vercel Analytics (event names such as "protect" or "restore", never content). The counting code checks the hostname and stays silent elsewhere; the Vercel script tag in `index.html` is still requested and returns 404 on other hosts. Remove it in a fork.

## Limits

Names of people, companies, places and streets are guesses, marked with a dashed outline in the preview. E-mail addresses, phone numbers, IBANs, card numbers and German tax IDs are pattern matches with a checksum where one exists. Deckname protects names. It does not make a text unidentifiable, so check the preview yourself.

Old `.doc` and `.ppt` files are not supported; save them as `.docx` or `.pptx` first. A PDF comes back as plain text.

## Run locally

```sh
npm start
```

This starts `python3 -m http.server` on port 8080. Open http://localhost:8080/deckname/ in your browser.

Tests:

```sh
npm test
```

Node 20 or newer, no dependencies. A pdf.js warning about `standardFontDataUrl` during the tests is harmless.

## Forking

`deckname/index.html` carries the canonical URL, Open Graph tags, JSON-LD, the logo link and the Impressum and Datenschutz links of a-schmitt.com, plus the Vercel Analytics tag. Replace or remove them before you publish a copy.

## Third-party components

- pdf.js, Apache 2.0 (`deckname/vendor`)
- JSZip, MIT or GPLv3 (`deckname/vendor`)
- Fonts Geist and Libre Caslon, SIL OFL 1.1 (`deckname/fonts`)

License files are included in the respective folders.

## License

MIT, see `LICENSE`.

## Auf Deutsch

Deckname ersetzt Personen, Firmen, Adressen und Nummern durch Platzhalter, bevor ein Text in ein KI-Werkzeug geht, und setzt sie in der Antwort wieder ein. Alles passiert im Browser. Die Live-Version: https://a-schmitt.com/deckname

Built by Alexander Schmitt in Berlin, https://a-schmitt.com
