import { useState, useMemo } from "react";
import { useI18n } from "../i18n.jsx";

// columns: [{ key, label, render?(row), num?:bool, cls?(row), filter?:false,
//             match?(filterText, row) — custom column-filter test }]
// `wide` opts a many-columned table into the compact rhythm: smaller cells and
// wrapping headers, so a long label like "Cost / conversation" stops dictating
// the width of a column that only ever holds four digits.
// Per-column filters: text = "contains"; numeric supports  >=n (plain or >n), <n, a-b range.
function matchNum(filter, val) {
  const f = String(filter).trim();
  const n = Number(val);
  if (f === "" || !Number.isFinite(n)) return f === "";
  let m;
  if ((m = f.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/))) return n >= +m[1] && n <= +m[2];
  if ((m = f.match(/^<\s*(\d+(?:\.\d+)?)$/))) return n < +m[1];
  if ((m = f.match(/^>\s*(\d+(?:\.\d+)?)$/))) return n > +m[1];
  const num = parseFloat(f.replace(/[^\d.]/g, ""));
  return Number.isFinite(num) ? n >= num : true;
}

export default function DataTable({ columns, rows, initialSort, wide }) {
  const { t } = useI18n();
  const [sort, setSort] = useState(initialSort || { key: null, dir: "desc" });
  const [filters, setFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);

  const view = useMemo(() => {
    let arr = rows;
    const active = Object.entries(filters).filter(([, v]) => String(v).trim() !== "");
    if (active.length) {
      arr = arr.filter((r) =>
        active.every(([k, v]) => {
          const col = columns.find((c) => c.key === k);
          const cell = r[k];
          if (col && col.match) return col.match(String(v), r);
          if (col && col.num) return matchNum(v, cell);
          return String(cell ?? "").toLowerCase().includes(String(v).toLowerCase());
        }));
    }
    if (sort.key) {
      const c = columns.find((x) => x.key === sort.key);
      arr = [...arr].sort((a, b) => {
        let va = a[sort.key], vb = b[sort.key];
        if (c && c.num) {
          va = Number(va); vb = Number(vb);
          va = Number.isFinite(va) ? va : -Infinity; vb = Number.isFinite(vb) ? vb : -Infinity;
          return sort.dir === "asc" ? va - vb : vb - va;
        }
        va = String(va ?? ""); vb = String(vb ?? "");
        return sort.dir === "asc" ? va.localeCompare(vb, "ar") : vb.localeCompare(va, "ar");
      });
    }
    return arr;
  }, [rows, sort, filters, columns]);

  const toggle = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  const setFilter = (key, v) => setFilters((f) => ({ ...f, [key]: v }));

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <button className="btn ghost" onClick={() => setShowFilters((s) => !s)}>{showFilters ? t("إخفاء فلاتر الأعمدة") : t("🔎 فلاتر الأعمدة")}</button>
        {Object.values(filters).some((v) => String(v).trim() !== "") && (
          <button className="btn ghost" onClick={() => setFilters({})}>{t("مسح الفلاتر")}</button>
        )}
        <span className="muted">{t("{n} صف", { n: view.length })}</span>
      </div>
      <div className={`scroll${wide ? " scroll-wide" : ""}`}>
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} onClick={() => toggle(c.key)} title={t("اضغط للترتيب")}>
                  {c.label}{sort.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : " ⇅"}
                </th>
              ))}
            </tr>
            {showFilters && (
              <tr>
                {columns.map((c) => (
                  <th key={c.key} style={{ background: "var(--surface-2)", padding: 4 }}>
                    {c.filter === false ? null : (
                      <input value={filters[c.key] || ""} onChange={(e) => setFilter(c.key, e.target.value)}
                        placeholder={c.num ? "≥ / <n / a-b" : t("بحث")}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 11 }} />
                    )}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {view.length === 0 && <tr><td colSpan={columns.length} className="muted">{t("لا بيانات")}</td></tr>}
            {view.map((r, i) => (
              <tr key={r.wa_id ?? r.id ?? i}>
                {columns.map((c) => (
                  <td key={c.key} className={[(c.key === columns[0].key ? "nm" : ""), c.cls ? c.cls(r) : ""].join(" ")}>
                    {c.render ? c.render(r) : (r[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
