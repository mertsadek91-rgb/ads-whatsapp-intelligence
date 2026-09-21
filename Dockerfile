# ---- build the React frontend ----
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- runtime: Node server + built frontend ----
FROM node:20-alpine
WORKDIR /app
# Chromium + text-shaping libs for the per-employee PDF export (lib/pdfReport.js
# drives it via puppeteer-core, which has no bundled browser of its own —
# harfbuzz/freetype are required for correct Arabic ligature shaping even
# though the report's own font is embedded separately as base64).
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund
COPY server/ ./server/
COPY --from=web /web/dist ./web/dist
ENV NODE_ENV=production
EXPOSE 3000
# BUG-044 fix: no HEALTHCHECK existed, so Docker/orchestrators had no signal
# to restart a container whose process is alive but its DB connection (or
# event loop) is wedged. Uses Node's own http module — alpine has no curl/wget
# guaranteed — against GET /api/health (server.js), which now also verifies
# DB connectivity, not just that the process is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
# setup.json (database credentials, session secret, encryption key) lives here.
# Mount a volume over it in production — see docker-compose.yml.
RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
ENV DATA_DIR=/app/server/data
# Do not run the application as root.
USER node
CMD ["node", "server/src/server.js"]
