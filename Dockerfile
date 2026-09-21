# ---- build the React frontend ----
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm install --no-audit --no-fund
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
RUN cd server && npm install --omit=dev --no-audit --no-fund
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
CMD ["node", "server/src/server.js"]
