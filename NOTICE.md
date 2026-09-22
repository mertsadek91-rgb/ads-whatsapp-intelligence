# Third-party components

What ships with this project that somebody else wrote, and under what terms.
See `LICENSE` for the project's own position.

## Fonts

| Font | Where | Licence |
|---|---|---|
| **Cairo** | Arabic UI text, and embedded in the PDF export as base64 (`server/src/lib/pdfReport.js` reads it from `@fontsource/cairo`) | SIL Open Font License 1.1 |
| **Inter** | Latin and numeric UI text, loaded from Google Fonts by `web/index.html` | SIL Open Font License 1.1 |

The OFL permits bundling and redistribution, including embedding in a document,
provided the fonts are not sold on their own and the licence travels with them.
Cairo's licence text ships inside `node_modules/@fontsource/cairo`.

Cairo is embedded rather than linked on purpose: the PDF export runs inside a
container with no network access and no guarantee that any Arabic font is
installed, and a fallback font breaks Arabic ligature shaping in a way that is
obvious to the reader.

## Visual language — licensed

The admin UI's look — light lavender canvas, white elevated cards, indigo
accent, uppercase table headers, 8px radii — was informed by the **DashSpace**
admin dashboard template by `freekytheme`, licensed from Envato Elements:

| | |
|---|---|
| Item licence code | `9FJS2WLKE3` |
| Licence date | 22 September 2026 |
| Terms | Envato Elements User Terms and License |
| Certificate | `licenses/dashspace-envato-elements.txt` |

**No file from the template ships in this repository.** `web/src/styles.css` is
614 lines of hand-written CSS that borrows the design language — the palette,
the elevation, the radii, the table treatment — and implements it against this
product's own markup, Arabic-first with logical properties throughout. There is
no vendored theme directory, no template JavaScript, no second stylesheet.

The licence is commercial, worldwide, and runs for the life of this End Product.
What it does not grant is the right to redistribute the design as material
others can build from — which is what publishing this repository publicly would
amount to, regardless of intent. Hence the repository stays private, and hence
`LICENSE` says all rights reserved. It is the only reason it does.

A second product built on the same design needs its own registered item usage,
obtained while an Envato subscription is active. `licenses/README.md` records
that condition where it will be found.

## Runtime dependencies

Installed from npm, not vendored into this repository; each carries its own
licence, readable with `npm ls --long` or in `node_modules/<pkg>/LICENSE`.

Server: `@fontsource/cairo`, `axios`, `bcryptjs`, `cookie-parser`, `dotenv`,
`express`, `express-mysql-session`, `express-rate-limit`, `express-session`,
`mysql2`, `node-cron`, `nodemailer`, `puppeteer-core`.

Web: React and Vite, with their own toolchains.

`puppeteer-core` deliberately has no bundled browser: the image installs
Alpine's Chromium instead, together with `freetype` and `harfbuzz`, which are
what shape Arabic correctly in the PDF.

## External services

The product talks to Meta Graph API, Wati.io and DeepSeek. It ships no
credentials for any of them — each installation supplies its own through the
setup wizard, and they are stored encrypted (AES-256-GCM) in the installation's
own database.
