# Ads × WhatsApp Intelligence

Joins paid-ad spend (Meta) to WhatsApp conversation outcomes (Wati.io), scores
leads and agent performance with AI, and reports on which ads actually produce
qualified customers — not just conversations.

> **Status: in-progress white-label extraction.**
> This tree is being generalised from a single-tenant build into a product any
> business can install. Until the setup wizard lands, configuration is
> `.env`-only — see `.env.example`. The full bilingual README, install guide
> and Docker quick-start are written in the final packaging milestone.

## Layout

| Path | What it is |
|---|---|
| `server/` | Express API, ingestion, scheduled jobs, AI analysis. |
| `web/` | React + Vite dashboard (Arabic RTL, English translation layer). |
| `server/scripts/` | Supported operational scripts. |
| `server/scripts/legacy/` | One-off historical scripts — not supported, read before running. |

## Development

```bash
cd server && npm ci && npm test
cd web    && npm ci && npm test
```

Requires **Node 20+** and **MySQL 8.0.19+** (the app uses `INSERT ... AS new`).
