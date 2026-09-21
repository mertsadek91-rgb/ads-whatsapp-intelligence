// BUG-040 fix: CSV exports used to fetch every matching row into memory and
// build the entire response string before sending — fine for hundreds of
// rows, an OOM risk as the dataset grows. Streams the same query in bounded
// batches instead, writing each batch to the response as it arrives.
import { query } from "../db.js";

export function csvEscape(v) {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

/**
 * `sql` must not already have its own LIMIT/OFFSET — this appends them per batch.
 *
 * `cols` are the row keys to read. `headers` are what gets printed on the first
 * line (defaults to `cols`, so existing callers are unchanged) — that is how an
 * export gets Arabic or English column titles. `map(col, value, row)` runs on
 * every cell, which is how enum values (`hot`, `awaiting_human`) become readable
 * labels in the export's language.
 *
 * The leading U+FEFF is what makes Excel read the file as UTF-8; without it,
 * double-clicking a CSV with Arabic in it shows mojibake.
 */
export async function streamCsv(res, { sql, params = [], cols, headers, map, filename, filenameAscii, batchSize = 2000 }) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; ${contentDisposition(filename, filenameAscii)}`);
  const titles = headers && headers.length === cols.length ? headers : cols;
  res.write("﻿" + titles.map(csvEscape).join(",") + "\n");
  let offset = 0;
  for (;;) {
    const rows = await query(`${sql} limit ${batchSize} offset ${offset}`, params);
    if (!rows.length) break;
    for (const r of rows) {
      res.write(cols.map((c) => csvEscape(map ? map(c, r[c], r) : r[c])).join(",") + "\n");
    }
    offset += rows.length;
    if (rows.length < batchSize) break;
  }
  res.end();
}

/**
 * Content-Disposition is latin-1 only, so an Arabic filename has to travel in
 * the RFC 5987 `filename*` parameter. `fallback` is what non-compliant clients
 * save as — stripping non-ASCII from an Arabic name yields "_-_.csv", so the
 * caller passes a real English name instead.
 */
export function contentDisposition(name, fallback) {
  const raw = String(name);
  if (/^[\w.\- ]+$/.test(raw)) return `filename="${raw}"`;
  // Sanitize the base name and the extension separately, so stripping the
  // non-ASCII part of "عربي.csv" can't also eat the dot and leave a bare "csv".
  const src = String(fallback || raw);
  const ext = (src.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1] || "";
  const baseSrc = ext ? src.slice(0, -(ext.length + 1)) : src;
  const base = baseSrc.replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "export";
  const ascii = ext ? `${base}.${ext}` : base;
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(raw)}`;
}

export default { csvEscape, streamCsv, contentDisposition };
