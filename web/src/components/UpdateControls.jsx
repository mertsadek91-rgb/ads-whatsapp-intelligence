import { useEffect, useRef, useState } from "react";
import api from "../api.js";
import { useI18n } from "../i18n.jsx";

function summarize(source, job, t) {
  if (!job || job.state === "idle") return null;
  if (job.state === "running") return { cls: "u-run", text: t("جارٍ التحديث…") };
  if (job.state === "error") return { cls: "u-err", text: "✗ " + (job.error || t("خطأ")) };
  // done
  const r = job.result || {};
  if (source === "wati") return { cls: "u-ok", text: t("✓ حُدّثت {n} جهة (فُحِصت {m})", { n: r.kept ?? 0, m: r.scanned ?? 0 }) };
  if (r.skipped) return { cls: "u-warn", text: t("⚠ تخطّي Meta — لا يوجد توكن") };
  return { cls: "u-ok", text: t("✓ {n} إعلان · {m} يوم", { n: r.ads ?? 0, m: r.daily ?? 0 }) };
}

/**
 * @param {{compact?: boolean}} props - `compact` renders an inline row sized
 *   for the app bar (short labels, status as a chip beside the buttons)
 *   instead of the stacked sidebar box.
 */
export default function UpdateControls({ compact = false }) {
  const { t } = useI18n();
  const [jobs, setJobs] = useState({ wati: null, meta: null });
  const timer = useRef(null);

  async function poll() {
    try { setJobs(await api.get("/admin/status")); } catch { /* ignore */ }
  }
  function ensurePolling() {
    if (timer.current) return;
    timer.current = setInterval(async () => {
      const s = await api.get("/admin/status").catch(() => null);
      if (s) setJobs(s);
      if (s && s.wati?.state !== "running" && s.meta?.state !== "running") {
        clearInterval(timer.current); timer.current = null;
      }
    }, 2500);
  }
  useEffect(() => { poll(); return () => timer.current && clearInterval(timer.current); }, []);

  async function run(source) {
    setJobs((j) => ({ ...j, [source]: { state: "running" } }));
    try { await api.post(`/admin/update-${source}`); }
    catch (e) {
      setJobs((j) => ({ ...j, [source]: { state: "error", error: e.message } }));
      return;
    }
    ensurePolling();
  }

  const running = (s) => jobs[s]?.state === "running";

  if (compact) {
    // Newest meaningful status wins — the app bar has room for one line, not
    // one per source.
    const st = summarize("wati", jobs.wati, t) || summarize("meta", jobs.meta, t);
    return (
      <div className="sync-inline">
        {[["wati", "تحديث واتساب", "واتساب"], ["meta", "تحديث Meta", "Meta"]].map(([src, title, short]) => (
          <button key={src} className="btn ghost sm" title={t(title)}
            disabled={running(src)} onClick={() => run(src)}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={running(src) ? "spin" : undefined} aria-hidden="true">
              <path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.5M4 5v3.5H7.5M4 13a8 8 0 0 0 13.7 4.7L20 15.5M20 19v-3.5h-3.5" />
            </svg>
            <span className="sync-label">{t(short)}</span>
          </button>
        ))}
        {st && <span className={`sync-status ${st.cls}`} title={st.text}>{st.text}</span>}
      </div>
    );
  }

  return (
    <div className="update-box">
      <div className="update-title">{t("تحديث البيانات")}</div>
      {[["wati", "تحديث واتساب"], ["meta", "تحديث Meta"]].map(([src, label]) => {
        const st = summarize(src, jobs[src], t);
        return (
          <div key={src} className="update-row">
            <button className="btn orange" disabled={running(src)} onClick={() => run(src)}>
              {running(src) ? "…" : t(label)}
            </button>
            {st && <div className={`update-status ${st.cls}`}>{st.text}</div>}
          </div>
        );
      })}
    </div>
  );
}
