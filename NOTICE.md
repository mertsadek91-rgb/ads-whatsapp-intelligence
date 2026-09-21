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

## Visual language — unresolved

`web/src/styles.css` states in its own header that the design was adapted from
the **DashSpace** admin template: the light lavender canvas, white elevated
cards, indigo accent, uppercase table headers and 8px radii. That template is a
commercial product, and its licence — not this one — governs whether a derived
stylesheet may be redistributed.

This is the single reason the project ships as "all rights reserved". It is
resolved by either confirming redistribution rights in writing, or restating the
stylesheet as original work. Nothing else here is blocked on it.

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
