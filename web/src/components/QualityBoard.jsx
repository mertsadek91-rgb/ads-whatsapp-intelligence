// Sales-room quality board. Everything the floor needs inside ONE viewport:
// no page scroll, no scroll inside the table, no layout shift when data lands.
//
// How the no-scroll promise is kept: the shell is a CSS grid whose rows are
// `auto auto auto 1fr auto` inside a `height:100dvh` box, so the ranking table
// gets exactly the leftover height and nothing can push the page taller. The
// table then MEASURES that leftover and renders only the rows that fit, rotating
// through pages instead of scrolling — a wall display has no mouse.
//
// English-only and direction-pinned: the app sets <html dir="rtl"> for Arabic and
// that used to mirror this whole grid and put the ellipsis on the wrong side of
// every employee name.
import { useEffect, useMemo, useRef, useState } from "react";

const fmt0 = (n) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
const fmt1 = (n) => (n == null ? "—" : Number(n).toFixed(1));
const pct1 = (n) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);

/** Minutes as "9h 27m" — the shape the design asks for, and easier to read from
 *  across a room than "567". */
function hm(min) {
  if (min == null) return "—";
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// Bands mirror lib/qualityScore.js. Colour is never the only signal — every score
// also shows its number, and the bands are spelled out in the legend.
const band = (v) => (v == null ? "none" : v >= 90 ? "exc" : v >= 80 ? "str" : v >= 70 ? "good" : v >= 60 ? "warn" : "bad");
const cBand = (v) => (v == null ? "none" : v >= 98 ? "exc" : v >= 95 ? "str" : v >= 90 ? "good" : v >= 80 ? "warn" : "bad");

const METRICS = [
  { key: "overall", label: "Overall Score", target: null },
  { key: "contact_rate", label: "Contact Rate", target: 90 },
  { key: "persuasion", label: "Quality Score", target: 80 },
  { key: "compliance", label: "Compliance Score", target: 90 },
  { key: "conversion", label: "Conversion Rate", target: null },
  { key: "response", label: "Response SLA", target: null },
];

const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
// Deterministic avatar tint per person, so the same face keeps the same colour
// between refreshes and page rotations.
const AV = ["#6366f1", "#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ec4899", "#ef4444", "#14b8a6"];
const tint = (name) => AV[[...String(name || "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) % AV.length];

const Delta = ({ v, suffix = "" }) => {
  if (v == null) return <span className="qb-d flat">—</span>;
  const up = v > 0, flat = Math.abs(v) < 0.05;
  return (
    <span className={`qb-d ${flat ? "flat" : up ? "up" : "down"}`}>
      {flat ? "→" : up ? "▲" : "▼"} {Math.abs(v).toFixed(1)}{suffix}
    </span>
  );
};

const ICONS = {
  leads: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 8v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.5a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2Z",
  check: "M20 6 9 17l-5-5",
  star: "m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6.1L12 16.8 6.7 19.7l1.1-6.1L3.4 9.4l6-.8L12 3Z",
  arrow: "M7 17 17 7M17 7H8M17 7v9",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0-3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  award: "M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm-3.5 1L7 22l5-2.5L17 22l-1.5-6",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z",
  chat: "M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.4A8 8 0 1 1 20 12Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3.5 2",
  alert: "M12 9v4m0 3h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  cal: "M8 2v4M16 2v4M3.5 9.5h17M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
  refresh: "M20 11A8 8 0 0 0 6.3 6.3L4 8.5M4 5v3.5H7.5M4 13a8 8 0 0 0 13.7 4.7L20 15.5M20 19v-3.5h-3.5",
};
const Ico = ({ d, s = 16 }) => (
  <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

function Kpi({ icon, tone, label, value, delta, deltaSuffix, sub, onDrill }) {
  const clickable = !!onDrill;
  return (
    <div className={`qb-kpi ${clickable ? "click" : ""}`}
      onClick={onDrill} role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDrill(); } } : undefined}
      title={clickable ? "Click for the customer list" : undefined}>
      <div className="qb-kpi-top">
        <span className={`qb-kpi-ic ${tone}`}><Ico d={icon} /></span>
        <span className="qb-kpi-label">{label}</span>
      </div>
      <div className="qb-kpi-val">{value}</div>
      <div className="qb-kpi-foot">
        {delta !== undefined && <Delta v={delta} suffix={deltaSuffix} />}
        <span className="qb-kpi-sub">{sub}</span>
      </div>
    </div>
  );
}

/**
 * The customer list behind a number.
 *
 * Only rendered when a session exists — the TV runs on a kiosk token with no
 * session, so a passer-by never sees a name or a phone number, while a manager
 * logged in at their desk opens the same screen and gets the full list.
 */
// Numbers that are two halves of one question. Opening "29 / 36" and only being
// able to see the 29 leaves the actual question — which 7 were missed — one
// dead end away, so the popup carries both sides and a tab to flip between them.
// Why a lead was never answered, in the words a supervisor would use. The board
// already distinguishes these server-side; the popup used to throw them all into
// one "no reply" and leave the manager to guess which were nobody's fault.
const NOT_CONTACTED_REASON = {
  expired_no_contact: ["24h window closed — too late to reply", "bad"],
  pending_after_hours: ["Arrived outside working hours", "dim"],
  pending_in_hours: ["Arrived during working hours — still open", "warn"],
  no_human_needed: ["No customer message — nothing to answer", "dim"],
  channel_unavailable: ["Second WhatsApp number we cannot read", "dim"],
};

const DRILL_SIDES = {
  contacted: ["contacted", "not_contacted"],
  not_contacted: ["contacted", "not_contacted"],
  next_step: ["next_step", "ghosted"],
  ghosted: ["next_step", "ghosted"],
};

function Drill({ q, days, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  // The metric being shown lives here, not in `q`: flipping the tab must not
  // reopen the modal or lose the agent the caller drilled into.
  const [metric, setMetric] = useState(q.metric);
  useEffect(() => { setMetric(q.metric); }, [q.metric]);
  const sides = DRILL_SIDES[metric] || null;

  useEffect(() => {
    let alive = true;
    setData(null); setErr("");
    const p = new URLSearchParams({ metric, days: String(days), limit: "300" });
    if (q.agent) p.set("agent", q.agent);
    fetch(`/api/quality/drill?${p}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 401 ? "Sign in to see customer details" : "Could not load"))))
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [metric, q.agent, days]);

  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="qb-modal-bg" onClick={onClose}>
      <div className="qb-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="qb-modal-head">
          <div>
            <h3>{data?.label || DRILL_LABEL[metric] || metric}{q.agent ? ` — ${q.agent}` : ""}</h3>
            <p>
              {/* data.window is read defensively: a payload without it used to
                  throw while rendering and white-screen the whole popup, which
                  is a poor trade for a missing date range. */}
              {data ? <>{fmt0(data.total)} customers{data.truncated ? ` · showing the ${data.shown} most recent` : ""}
                {data.window ? ` · ${data.window.since} → ${data.window.until}` : ""}</> : "Loading…"}
            </p>
          </div>
          <button className="qb-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {sides && (
          <div className="qb-tabs">
            {sides.map((m) => (
              <button key={m} className={`qb-tab ${m === metric ? "on" : ""}`}
                onClick={() => setMetric(m)}>{DRILL_LABEL[m] || m}</button>
            ))}
          </div>
        )}
        {err && <p className="qb-modal-err">{err}</p>}
        <div className="qb-modal-body">
          {data && data.rows.length === 0 && <p className="qb-modal-none">No customers in this group</p>}
          {data && data.rows.length > 0 && (
            <table className="qb-dt">
              <thead><tr>
                <th>Customer</th><th>Phone</th><th>Owner</th><th className="c">Msgs</th>
                <th className="c">First reply</th><th>Last activity</th><th>Conversation</th>
              </tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.wa_id}>
                    <td>
                      <b>{r.full_name || "—"}</b>
                      {r.country && <small> · {r.country}</small>}
                      {r.campaign && <div className="qb-dt-sub">{r.campaign}</div>}
                    </td>
                    <td dir="ltr" className="mono">{r.phone || r.wa_id}</td>
                    <td>{r.owner || <span className="dim">unassigned</span>}</td>
                    <td className="c">{fmt0(r.messages)}<small> / {fmt0(r.customer_msgs)}</small></td>
                    <td className="c">
                      {r.contacted
                        ? (r.first_human_response_min == null ? <span className="dim">—</span> : hm(r.first_human_response_min))
                        : <span className={r.after_hours ? "dim" : "bad"}>{r.after_hours ? "after hours" : "no reply"}</span>}
                    </td>
                    <td>{r.last_activity ? String(r.last_activity).replace("T", " ").slice(0, 16) : "—"}</td>
                    <td>
                      {/* For an unanswered lead the reason IS the content: an
                          empty conversation cell says nothing, while "the window
                          closed" and "arrived at 2am" are different problems with
                          different owners. */}
                      {!r.contacted && NOT_CONTACTED_REASON[r.status] && (
                        <div className={`qb-reason ${NOT_CONTACTED_REASON[r.status][1]}`}>
                          {NOT_CONTACTED_REASON[r.status][0]}
                        </div>
                      )}
                      {/* Wati's stage and the AI's reading of the transcript are
                          two different claims. When they disagree the row says so
                          out loud — a lead parked in "Qualified" who actually
                          refused is a pipeline to fix in Wati, not a footnote. */}
                      {r.interest_conflict && (
                        <div className="qb-dt-iss">
                          <span className="qb-risk bad">Wati: {r.stage} · AI: {r.ai_intent} — fix stage in Wati</span>
                        </div>
                      )}
                      {r.lead_status && <div>{r.lead_status}</div>}
                      {r.summary && <div className="qb-dt-sub">{r.summary}</div>}
                      {r.issues?.length > 0 && (
                        <div className="qb-dt-iss">
                          {r.issues.map((i, k) => (
                            <span key={k} className={`qb-risk ${i.severity === "critical" ? "bad" : i.severity === "major" ? "warn" : "mid"}`}>
                              {i.type_label}
                            </span>
                          ))}
                        </div>
                      )}
                      {!r.lead_status && !r.summary && !r.issues?.length && <span className="dim">not analysed</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const DRILL_LABEL = {
  leads: "All leads", contacted: "Contacted", not_contacted: "Not contacted",
  after_hours: "Not contacted — after hours", negligence: "Not contacted — during hours",
  interested: "Interested", qualified: "Qualified", next_step: "Reached a next step",
  ghosted: "Qualified — never replied after we did",
  over_sla: "Over the response target", risk: "Conversations with a finding",
};

/**
 * Line chart with an area fill, a value label per point and a dashed target.
 *
 * A day with no snapshot is a GAP in the path, never a zero — "we had not started
 * measuring" must not read as a catastrophic day, and joining across the gap
 * would invent a trend that never happened.
 */
function Trend({ daily, metric, onMetric }) {
  const meta = METRICS.find((m) => m.key === metric) || METRICS[0];
  const pts = daily.map((d, i) => ({ i, v: d[metric], label: d.label, date: d.date }));
  const has = pts.some((p) => p.v != null);
  const W = 1000, H = 250, PAD = { t: 22, r: 16, b: 26, l: 34 };
  const x = (i) => PAD.l + (pts.length <= 1 ? 0 : (i * (W - PAD.l - PAD.r)) / (pts.length - 1));
  const y = (v) => PAD.t + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - PAD.t - PAD.b);

  // Split into contiguous runs so gaps stay gaps.
  const runs = [];
  let cur = [];
  for (const p of pts) {
    if (p.v == null) { if (cur.length) runs.push(cur); cur = []; } else cur.push(p);
  }
  if (cur.length) runs.push(cur);

  const lineOf = (run) => run.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const areaOf = (run) => run.length < 2 ? "" :
    `${lineOf(run)} L${x(run[run.length - 1].i).toFixed(1)},${y(0)} L${x(run[0].i).toFixed(1)},${y(0)} Z`;
  const best = has ? pts.filter((p) => p.v != null).reduce((a, b) => (b.v > a.v ? b : a)) : null;

  return (
    <section className="qb-panel qb-trend">
      <div className="qb-panel-head">
        <h2><span className="qb-h-ic"><Ico d={ICONS.arrow} s={14} /></span>DAILY PERFORMANCE TREND</h2>
        <select className="qb-sel" value={metric} onChange={(e) => onMetric(e.target.value)} aria-label="Trend metric">
          {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>
      <div className="qb-plot">
        {!has && <div className="qb-empty">Analysis in progress — no scored days yet</div>}
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="qb-svg">
          <defs>
            <linearGradient id="qbfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity=".28" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 25, 50, 75, 100].map((g) => (
            <g key={g}>
              <line x1={PAD.l} y1={y(g)} x2={W - PAD.r} y2={y(g)} stroke="#e8edf4" strokeWidth="1" />
              <text x={PAD.l - 7} y={y(g) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{g}</text>
            </g>
          ))}
          {meta.target != null && (
            <g>
              <line x1={PAD.l} y1={y(meta.target)} x2={W - PAD.r} y2={y(meta.target)}
                stroke="#ef4444" strokeWidth="1.2" strokeDasharray="6 5" />
              <text x={W - PAD.r} y={y(meta.target) - 6} textAnchor="end" fontSize="11"
                fontWeight="700" fill="#ef4444">TARGET {meta.target}</text>
            </g>
          )}
          {runs.map((run, k) => (
            <g key={k}>
              {run.length > 1 && <path d={areaOf(run)} fill="url(#qbfill)" />}
              {run.length > 1 && <path d={lineOf(run)} fill="none" stroke="#3b82f6" strokeWidth="2.4"
                strokeLinejoin="round" strokeLinecap="round" />}
              {run.map((p) => (
                <g key={p.i}>
                  <circle cx={x(p.i)} cy={y(p.v)} r={best && p.i === best.i ? 6 : 4.5}
                    fill="#fff" stroke={best && p.i === best.i ? "#16a34a" : "#3b82f6"} strokeWidth="2.5" />
                  <text x={x(p.i)} y={y(p.v) - 13} textAnchor="middle" fontSize="12.5" fontWeight="700"
                    fill={best && p.i === best.i ? "#16a34a" : "#334155"}>{fmt1(p.v)}</text>
                </g>
              ))}
            </g>
          ))}
        </svg>
        <div className="qb-xaxis">
          {pts.map((p) => (
            <div key={p.date} className={best && p.i === best.i ? "on" : ""}>
              {p.label}<small>{String(p.date).slice(8)}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** One highlight card. Says "Not awarded yet" rather than crowning whoever
 *  happens to top an ineligible list. */
function Highlight({ kind, title, row, metric, scoreLabel, a, b }) {
  if (!row) {
    return (
      <div className={`qb-hl ${kind} empty`}>
        <div className="qb-hl-title">{title}</div>
        <div className="qb-hl-none">Not awarded yet</div>
      </div>
    );
  }
  const v = row[metric];
  return (
    <div className={`qb-hl ${kind}`}>
      <div className="qb-hl-title">{title}</div>
      <div className="qb-av lg" style={{ background: tint(row.name) }}>{initials(row.name)}</div>
      <div className="qb-hl-name" title={row.name}>{row.name}</div>
      <div className="qb-hl-lbl">{scoreLabel}</div>
      <div className={`qb-hl-score ${band(v)}`}>{fmt1(v)}</div>
      <div className="qb-hl-sub">
        <div><span>{a.k}</span><b className={a.cls || ""}>{a.v}</b></div>
        <div><span>{b.k}</span><b className={b.cls || ""}>{b.v}</b></div>
      </div>
    </div>
  );
}

/** Two-point sparkline from the previous snapshot to now. Only real data — with
 *  one snapshot there is nothing to draw, so it degrades to the arrow alone. */
function Spark({ from, to }) {
  if (from == null || to == null) return <span className="qb-d flat">→</span>;
  const up = to >= from;
  const y1 = 18 - (Math.max(0, Math.min(100, from)) / 100) * 16;
  const y2 = 18 - (Math.max(0, Math.min(100, to)) / 100) * 16;
  return (
    <svg viewBox="0 0 56 20" width="56" height="20" aria-hidden="true">
      <path d={`M2,${y1.toFixed(1)} L54,${y2.toFixed(1)}`} fill="none"
        stroke={up ? "#16a34a" : "#dc2626"} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="54" cy={y2.toFixed(1)} r="3" fill={up ? "#16a34a" : "#dc2626"} />
    </svg>
  );
}

const ROTATE_MS = 12000;
const FALLBACK_ROW_H = 56;

export default function QualityBoard({ data, updatedLabel }) {
  const [metric, setMetric] = useState("overall");
  const [page, setPage] = useState(0);
  const [clock, setClock] = useState("");
  const [perPage, setPerPage] = useState(6);
  const [canDrill, setCanDrill] = useState(false);
  const [drillQ, setDrillQ] = useState(null);
  const bodyRef = useRef(null);

  // Drill-down needs a session, not the kiosk token. On the TV this probe fails
  // and the numbers stay plain text; at a desk it succeeds and they become
  // clickable. Nothing about the wall display changes.
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then((r) => { if (alive) setCanDrill(r.ok); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const drillTo = (metric, agent) => (canDrill ? () => setDrillQ({ metric, agent }) : undefined);

  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const daily = data?.daily || [];
  const hl = data?.highlights || {};
  const cov = data?.coverage;

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, []);

  // Measure the space the ROWS got — not the panel, which would count the legend
  // strip as room and make the table scroll instead of paginate. Row height is
  // read from a rendered row so the responsive tightening can't put JS and CSS
  // out of step.
  useEffect(() => {
    const measure = () => {
      const el = bodyRef.current;
      if (!el) return;
      const rowH = el.querySelector("tbody tr")?.getBoundingClientRect().height || FALLBACK_ROW_H;
      const headH = el.querySelector("thead")?.getBoundingClientRect().height || 0;
      const room = el.clientHeight - headH;
      if (room > 0 && rowH > 0) {
        const fits = Math.max(1, Math.floor(room / rowH));
        setPerPage((prev) => (prev === fits ? prev : fits));
      }
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver === "function" && bodyRef.current) {
      ro = new ResizeObserver(measure);
      ro.observe(bodyRef.current);
    }
    window.addEventListener("resize", measure);
    // Belt and braces, and it earns its keep: on a real resolution change the
    // ResizeObserver was observed NOT to fire, leaving one row per page on a
    // 1080p screen. A wall display also has to survive a TV waking from standby
    // and a late webfont reflow, neither of which raises a resize event.
    const tick = setInterval(measure, 5000);
    return () => { ro?.disconnect(); clearInterval(tick); window.removeEventListener("resize", measure); };
  }, [rows.length]);

  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  useEffect(() => { if (page >= pages) setPage(0); }, [pages, page]);
  useEffect(() => {
    if (pages <= 1) return;
    const id = setInterval(() => setPage((p) => (p + 1) % pages), ROTATE_MS);
    return () => clearInterval(id);
  }, [pages]);

  const shown = useMemo(() => rows.slice(page * perPage, page * perPage + perPage), [rows, page, perPage]);
  const period = data?.window
    ? `${String(data.window.since).slice(5)} – ${String(data.window.until).slice(5)} ${String(data.window.until).slice(0, 4)}`
    : "";
  const target = data?.target_compliance ?? 90;

  // Bottom strip. `null` when the server has not sent the SLA counts, so the card
  // shows "—" rather than a confident 0 for a number nobody computed.
  const overSla = totals.sla_answerable == null ? null
    : Math.max(0, totals.sla_answerable - (totals.within_sla || 0));
  const targetProgress = totals.contact_rate_pct == null ? null
    : Math.min(100, Math.round((totals.contact_rate_pct / 90) * 100));

  return (
    <div className="qb" dir="ltr" lang="en">
      <header className="qb-head">
        <div className="qb-brand">
          <span className="qb-logo"><Ico d="M3 13h4v8H3v-8Zm7-6h4v14h-4V7Zm7-4h4v18h-4V3Z" s={22} /></span>
          <div>
            <h1>SALES COMMUNICATION &amp; QUALITY BOARD</h1>
            <p>Live Performance • Quality • Conversion • Compliance</p>
          </div>
        </div>
        <div className="qb-pills">
          <span className="qb-pill live"><i />LIVE</span>
          <span className="qb-pill"><Ico d={ICONS.clock} s={14} />{clock}</span>
          <span className="qb-pill"><Ico d={ICONS.cal} s={14} />{period}</span>
          {cov?.pct != null && (
            <span className={`qb-pill ${cov.pct < 50 ? "warn" : ""}`}>
              Analysed {cov.pct}% ({fmt0(cov.evaluated)}/{fmt0(cov.total)})
            </span>
          )}
          <span className="qb-upd"><Ico d={ICONS.refresh} s={16} />
            <span><small>Last Update</small>{updatedLabel ? updatedLabel.replace(/^\D*/, "") : "—"}</span>
          </span>
        </div>
      </header>

      <section className="qb-kpis">
        <Kpi icon={ICONS.leads} tone="indigo" label="TOTAL LEADS" value={fmt0(totals.leads)}
          onDrill={drillTo("leads")}
          delta={totals.leads_delta_pct} deltaSuffix="%" sub="vs prev. period" />
        <Kpi icon={ICONS.phone} tone="sky" label="CONTACTED" value={fmt0(totals.contacted)}
          onDrill={drillTo("contacted")}
          sub={`${pct1(totals.contact_rate_pct)} of total leads`} />
        <Kpi icon={ICONS.check} tone="green" label="QUALIFIED" value={fmt0(totals.qualified)}
          onDrill={drillTo("qualified")}
          sub="AI-assessed" />
        <Kpi icon={ICONS.star} tone="amber" label="INTERESTED" value={fmt0(totals.interested)}
          onDrill={drillTo("interested")}
          sub={totals.contacted ? `${pct1((100 * (totals.interested || 0)) / totals.contacted)} of contacted` : "of contacted"} />
        {/* Denominator is `convertible`, not `qualified` — the same fix applied to
            the per-employee row. Dividing by everyone qualified (including the
            ones who never replied) understated this by roughly half on live data.
            The card doubles as the CONVERSION popup: clicking opens the same
            next_step/ghosted tab pair the per-row cell uses. */}
        <Kpi icon={ICONS.arrow} tone="violet" label="NEXT STEP CONVERSIONS" value={fmt0(totals.next_step)}
          onDrill={drillTo("next_step")}
          sub={totals.convertible
            ? `${pct1((100 * (totals.next_step || 0)) / totals.convertible)} of convertible${totals.ghosted ? ` · ${fmt0(totals.ghosted)} no reply` : ""}`
            : "of convertible"} />
        <Kpi icon={ICONS.target} tone="sky" label="CONTACT RATE" value={pct1(totals.contact_rate_pct)}
          sub="Target 90%" />
        <Kpi icon={ICONS.award} tone="amber" label="TEAM QUALITY SCORE" value={fmt1(totals.quality_score)}
          sub="Target 80" />
        <Kpi icon={ICONS.shield} tone="green" label="COMPLIANCE SCORE" value={fmt1(totals.compliance_score)}
          sub={`Target ${target}`} />
      </section>

      <section className="qb-mid">
        <section className="qb-panel qb-hls">
          <div className="qb-panel-head">
            <h2><span className="qb-h-ic amber"><Ico d={ICONS.award} s={14} /></span>TODAY&apos;S HIGHLIGHTS</h2>
          </div>
          <div className="qb-hl-row">
            <Highlight kind="gold" title="TOP PERFORMER" row={hl.top_performer} metric="overall"
              scoreLabel="Overall Score"
              a={{ k: "Quality", v: fmt1(hl.top_performer?.persuasion) }}
              b={{ k: "Compliance", v: fmt1(hl.top_performer?.compliance), cls: "g" }} />
            <Highlight kind="blue" title="BEST QUALITY" row={hl.best_persuasion} metric="persuasion"
              scoreLabel="Quality Score"
              a={{ k: "Compliance", v: fmt1(hl.best_persuasion?.compliance) }}
              b={{ k: "Conversion", v: fmt1(hl.best_persuasion?.conversion), cls: "g" }} />
            <Highlight kind="green" title="MOST IMPROVED" row={hl.most_improved} metric="overall"
              scoreLabel="Overall Score"
              a={{ k: "Previous", v: fmt1(hl.most_improved?.prev_overall) }}
              b={{ k: "Change", v: hl.most_improved?.delta_overall == null ? "—" : `+${fmt1(hl.most_improved.delta_overall)}`, cls: "g" }} />
          </div>
        </section>
        <Trend daily={daily} metric={metric} onMetric={setMetric} />
      </section>

      <section className="qb-panel qb-table">
        <div className="qb-rows" ref={bodyRef}>
          <table>
            {/* Explicit widths: with table-layout:fixed and 12 equal columns the
                employee column got 1/12 and a full name collapsed to an ellipsis.
                Names are the one column that must stay readable. */}
            <colgroup>
              <col style={{ width: "5%" }} /><col style={{ width: "18%" }} />
              <col style={{ width: "8%" }} /><col style={{ width: "7.5%" }} />
              <col style={{ width: "8.5%" }} /><col style={{ width: "8.5%" }} />
              <col style={{ width: "9.5%" }} /><col style={{ width: "7%" }} />
              <col style={{ width: "7%" }} /><col style={{ width: "8.5%" }} />
              <col style={{ width: "7.5%" }} /><col style={{ width: "5%" }} />
            </colgroup>
            <thead>
              <tr>
                <th className="c">RANK</th><th>AGENT</th>
                <th className="c">OVERALL</th><th className="c">QUALITY</th>
                <th className="c">COMPLIANCE</th><th className="c">CONVERSION</th>
                <th className="c">HANDLED</th><th className="c">INTERESTED</th>
                <th className="c">NEXT STEP</th><th className="c">RESPONSE SLA</th>
                <th className="c">RISK FLAGS</th><th className="c">TREND</th>
              </tr>
            </thead>
            <tbody className="qb-tbody">
              {shown.length === 0 && <tr><td colSpan={12} className="qb-none">No employees in this period</td></tr>}
              {shown.map((r) => {
                const slaPct = r.sla_answerable ? Math.round((100 * r.within_sla) / r.sla_answerable) : null;
                return (
                  <tr key={r.name} className={r.provisional ? "prov" : ""}>
                    <td className="c"><span className={`qb-rank r${r.rank <= 3 ? r.rank : ""}`}>{r.rank}</span></td>
                    <td>
                      <div className="qb-emp">
                        <span className="qb-av" style={{ background: tint(r.name) }}>{initials(r.name)}</span>
                        <span className="qb-emp-txt">
                          <span className="qb-emp-name" title={r.name}>{r.name}</span>
                          <small>{r.sample_size ? `${r.sample_size} assessed` : "not assessed yet"}</small>
                        </span>
                        {!r.eligible && <span className="qb-tag">{r.provisional ? "Insufficient data" : "Not eligible"}</span>}
                      </div>
                    </td>
                    <td className="c"><span className={`qb-sc ${band(r.overall)}`}>{fmt1(r.overall)}</span>
                      <div className="qb-mini"><Delta v={r.delta_overall} /></div></td>
                    <td className="c"><span className={`qb-sc ${band(r.persuasion)}`}>{fmt1(r.persuasion)}</span></td>
                    <td className="c"><span className={`qb-sc ${cBand(r.compliance)}`}>{fmt1(r.compliance)}</span></td>
                    {/* The ghosted count sits under the score on purpose: it is the
                        context that explains it. These are qualified leads who never
                        answered after the employee replied — excluded from the
                        denominator because nobody can convert silence, but shown
                        because 41% of qualified leads going quiet is an ad problem
                        worth seeing. */}
                    <td className={`c ${canDrill && r.ghosted ? "click" : ""}`}
                      onClick={r.ghosted ? drillTo("ghosted", r.name) : undefined}
                      title={r.ghosted ? `${r.ghosted} qualified leads never replied after the employee did — excluded from the conversion denominator` : undefined}>
                      <span className={`qb-sc ${band(r.conversion)}`}>{fmt1(r.conversion)}</span>
                      {r.ghosted > 0 && <div className="qb-mini">{fmt0(r.ghosted)} no reply</div>}</td>
                    <td className={`c ${canDrill ? "click" : ""}`} onClick={drillTo("contacted", r.name)}>
                      <b>{fmt0(r.contacted)}</b><small> / {fmt0(r.leads)}</small>
                      <div className="qb-mini g">{pct1(r.contact_rate_pct)}</div></td>
                    <td className={`c ${canDrill ? "click" : ""}`} onClick={drillTo("interested", r.name)}>
                      <b>{fmt0(r.interested)}</b>
                      <div className="qb-mini">{r.contacted ? pct1((100 * r.interested) / r.contacted) : "—"}</div></td>
                    <td className={`c ${canDrill ? "click" : ""}`} onClick={drillTo("next_step", r.name)}>
                      {/* Over `convertible`, not `qualified` — the same denominator
                          the conversion score uses, so the two cannot disagree. */}
                      <b>{fmt0(r.next_step)}</b><small> / {fmt0(r.convertible ?? r.qualified)}</small></td>
                    <td className={`c ${canDrill ? "click" : ""}`} onClick={drillTo("over_sla", r.name)}>
                      <b>{hm(r.median_response_min)}</b>
                      {slaPct != null && <span className={`qb-ring ${slaPct >= 90 ? "g" : slaPct >= 70 ? "w" : "b"}`}>{slaPct}%</span>}
                    </td>
                    <td className={`c ${canDrill ? "click" : ""}`} onClick={drillTo("risk", r.name)}>
                      {r.risk?.critical ? <span className="qb-risk bad"><Ico d={ICONS.alert} s={12} />{r.risk.critical} Critical</span>
                        : r.risk?.major ? <span className="qb-risk warn"><Ico d={ICONS.alert} s={12} />{r.risk.major} Major</span>
                        : r.risk?.moderate ? <span className="qb-risk mid">{r.risk.moderate} Moderate</span>
                        : <span className="qb-risk ok">0</span>}
                    </td>
                    <td className="c"><Spark from={r.prev_overall} to={r.overall} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="qb-foot">
          <div className="qb-legend">
            <span><i className="exc" />Excellent 90+</span><span><i className="str" />Strong 80+</span>
            <span><i className="good" />Good 70+</span><span><i className="warn" />Needs work 60+</span>
            <span><i className="bad" />Review &lt;60</span><span><i className="none" />No data</span>
          </div>
          <div className="qb-pager">
            {pages > 1 && <>Page {page + 1} of {pages} · </>}
            {data?.min_sample != null && <span className="dim">ranked from {data.min_sample} assessed conversations</span>}
          </div>
        </div>
      </section>

      <section className="qb-strip">
        <div className={`qb-sc-card ${canDrill ? "click" : ""}`} onClick={drillTo("interested")}>
          <span className="qb-sc-ic sky"><Ico d={ICONS.chat} /></span>
          <b>{fmt0(totals.interested)}</b><span>Interested leads need follow-up</span></div>
        <div className={`qb-sc-card ${canDrill ? "click" : ""}`} onClick={drillTo("over_sla")}>
          <span className="qb-sc-ic amber"><Ico d={ICONS.clock} /></span>
          <b>{fmt0(overSla)}</b><span>Conversations over SLA time</span></div>
        <div className={`qb-sc-card ${canDrill ? "click" : ""}`} onClick={drillTo("risk")}>
          <span className="qb-sc-ic red"><Ico d={ICONS.alert} /></span>
          <b>{fmt0(totals.critical_open)}</b><span>Critical issues need review</span></div>
        <div className="qb-sc-card"><span className="qb-sc-ic green"><Ico d={ICONS.target} /></span>
          <b>{targetProgress == null ? "—" : `${targetProgress}%`}</b><span>Contact-rate target progress</span></div>
        <div className="qb-sc-card"><span className="qb-sc-ic violet"><Ico d={ICONS.leads} /></span>
          <b>{fmt0(totals.qualified)}</b><span>Qualified leads this period</span></div>
      </section>

      {drillQ && <Drill q={drillQ} days={data?.days || 7} onClose={() => setDrillQ(null)} />}

      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
.qb{ --ink:#0f172a; --dim:#64748b; --line:#e6ebf2; --card:#fff;
  --exc:#16a34a; --str:#0284c7; --good:#6366f1; --warn:#d97706; --bad:#dc2626; --none:#94a3b8;
  /* The middle row is CAPPED, not content-sized. The chart's SVG stretches to
     whatever width it is given, so at 1366x768 it grew tall enough to leave the
     ranking table one row per page — technically no-scroll, useless in practice.
     minmax(0,…) lets it shrink; 1fr still gives the table everything left. */
  height:100dvh; display:grid; grid-template-rows:auto auto minmax(0,27vh) 1fr auto; gap:9px;
  padding:11px 14px; box-sizing:border-box; overflow:hidden; direction:ltr;
  font-family:Inter,"Segoe UI",system-ui,sans-serif; color:var(--ink);
  background:radial-gradient(circle at 6% 2%,rgba(99,102,241,.09),transparent 30%),
             radial-gradient(circle at 94% 6%,rgba(14,165,233,.09),transparent 28%),#f5f7fb; }
.qb *{ box-sizing:border-box; }
.qb h1{ margin:0; font-size:clamp(17px,1.42vw,25px); font-weight:800; letter-spacing:-.015em; }
.qb h2{ margin:0; font-size:12.5px; font-weight:800; letter-spacing:.04em; display:flex; align-items:center; gap:7px; }

/* ---------- header ---------- */
.qb-head{ display:flex; align-items:center; justify-content:space-between; gap:14px; }
.qb-brand{ display:flex; align-items:center; gap:11px; min-width:0; }
.qb-brand p{ margin:2px 0 0; color:var(--dim); font-size:12px; }
.qb-logo{ width:40px; height:40px; flex:0 0 40px; border-radius:12px; display:grid; place-items:center;
  background:linear-gradient(135deg,#4f46e5,#0ea5e9); color:#fff; box-shadow:0 8px 20px rgba(79,70,229,.3); }
.qb-pills{ display:flex; align-items:center; gap:7px; flex-wrap:wrap; justify-content:flex-end; }
.qb-pill{ display:inline-flex; align-items:center; gap:6px; background:var(--card); border:1px solid var(--line);
  border-radius:10px; padding:7px 11px; font-size:12px; font-weight:700; font-variant-numeric:tabular-nums;
  white-space:nowrap; box-shadow:0 2px 6px rgba(15,23,42,.04); }
.qb-pill svg{ color:var(--dim); }
.qb-pill.warn{ background:#fff7ed; border-color:#fed7aa; color:#9a3412; }
.qb-pill.live i{ width:8px; height:8px; border-radius:50%; background:#22c55e; animation:qbp 1.8s infinite; }
@keyframes qbp{ 0%{box-shadow:0 0 0 0 rgba(34,197,94,.6)} 70%{box-shadow:0 0 0 7px rgba(34,197,94,0)} 100%{box-shadow:0 0 0 0 rgba(34,197,94,0)} }
.qb-upd{ display:inline-flex; align-items:center; gap:8px; color:var(--dim); font-size:13px; font-weight:700; }
.qb-upd small{ display:block; font-size:10px; font-weight:600; opacity:.8; }
.qb-upd > span{ text-align:end; }

/* ---------- KPI row ---------- */
.qb-kpis{ display:grid; grid-template-columns:repeat(8,1fr); gap:8px; }
.qb-kpi{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:10px 12px;
  box-shadow:0 4px 14px rgba(15,23,42,.05); min-width:0; }
.qb-kpi-top{ display:flex; align-items:center; justify-content:space-between; gap:6px; }
.qb-kpi-ic{ width:28px; height:28px; flex:0 0 28px; border-radius:9px; display:grid; place-items:center; }
.qb-kpi-ic.indigo{ background:#eef2ff; color:#4f46e5 } .qb-kpi-ic.sky{ background:#e0f2fe; color:#0284c7 }
.qb-kpi-ic.green{ background:#dcfce7; color:#15803d } .qb-kpi-ic.amber{ background:#fef3c7; color:#b45309 }
.qb-kpi-ic.violet{ background:#f3e8ff; color:#7e22ce } .qb-kpi-ic.red{ background:#fee2e2; color:#b91c1c }
.qb-kpi-label{ font-size:9.5px; font-weight:800; color:var(--dim); letter-spacing:.05em; text-align:end;
  line-height:1.25; overflow:hidden; }
.qb-kpi-val{ font-size:clamp(19px,1.55vw,27px); font-weight:800; line-height:1.2; margin-top:2px;
  font-variant-numeric:tabular-nums; }
.qb-kpi-foot{ display:flex; align-items:center; gap:6px; font-size:10.5px; color:var(--dim);
  white-space:nowrap; overflow:hidden; }
.qb-d{ font-weight:800; font-size:11px; white-space:nowrap; }
.qb-d.up{ color:#15803d } .qb-d.down{ color:var(--bad) } .qb-d.flat{ color:var(--none) }

/* ---------- middle row ---------- */
.qb-mid{ display:grid; grid-template-columns:40fr 60fr; gap:9px; min-height:0; }
.qb-panel{ background:var(--card); border:1px solid var(--line); border-radius:15px;
  box-shadow:0 4px 14px rgba(15,23,42,.05); display:flex; flex-direction:column; min-height:0; overflow:hidden; }
.qb-panel-head{ display:flex; align-items:center; justify-content:space-between; gap:10px;
  padding:9px 13px; border-bottom:1px solid var(--line); }
.qb-h-ic{ width:20px; height:20px; border-radius:6px; display:grid; place-items:center;
  background:#eef2ff; color:#4f46e5; }
.qb-h-ic.amber{ background:#fef3c7; color:#b45309 }
.qb-sel{ border:1px solid var(--line); background:#f8fafc; border-radius:9px; padding:5px 9px;
  font-size:11.5px; font-weight:700; color:var(--ink); cursor:pointer; }

.qb-hl-row{ display:grid; grid-template-columns:repeat(3,1fr); gap:8px; padding:9px; min-height:0; }
.qb-hl{ border:1px solid var(--line); border-radius:13px; padding:9px 8px; text-align:center;
  display:flex; flex-direction:column; align-items:center; gap:3px; min-width:0; }
.qb-hl.gold{ background:linear-gradient(180deg,#fffbeb,#fff); border-color:#fde68a }
.qb-hl.blue{ background:linear-gradient(180deg,#eff6ff,#fff); border-color:#bfdbfe }
.qb-hl.green{ background:linear-gradient(180deg,#f0fdf4,#fff); border-color:#bbf7d0 }
.qb-hl-title{ font-size:9.5px; font-weight:800; letter-spacing:.05em; color:var(--dim); }
.qb-hl.gold .qb-hl-title{ color:#b45309 } .qb-hl.blue .qb-hl-title{ color:#1d4ed8 }
.qb-hl.green .qb-hl-title{ color:#15803d }
.qb-hl-none{ font-size:12px; color:var(--none); margin:auto 0; }
.qb-hl-name{ font-weight:800; font-size:12.5px; max-width:100%; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; }
.qb-hl-lbl{ font-size:9.5px; color:var(--dim); }
.qb-hl-score{ font-size:22px; font-weight:800; line-height:1.1; font-variant-numeric:tabular-nums; }
.qb-hl-sub{ display:flex; gap:10px; margin-top:auto; padding-top:5px; width:100%; justify-content:center; }
.qb-hl-sub div{ display:flex; flex-direction:column; font-size:9.5px; color:var(--dim); }
.qb-hl-sub b{ font-size:12px; color:var(--ink); font-variant-numeric:tabular-nums; }
.qb-hl-sub b.g{ color:#15803d }
.qb-av{ width:26px; height:26px; flex:0 0 26px; border-radius:9px; display:grid; place-items:center;
  font-size:10px; font-weight:800; color:#fff; }
.qb-av.lg{ width:42px; height:42px; flex:0 0 42px; border-radius:50%; font-size:14px; }
.qb-hl-score.exc{ color:var(--exc) } .qb-hl-score.str{ color:var(--str) } .qb-hl-score.good{ color:var(--good) }
.qb-hl-score.warn{ color:var(--warn) } .qb-hl-score.bad{ color:var(--bad) } .qb-hl-score.none{ color:var(--none) }

.qb-plot{ position:relative; flex:1; min-height:0; padding:6px 12px 4px; display:flex; flex-direction:column; }
.qb-svg{ flex:1; min-height:0; width:100%; }
.qb-xaxis{ display:flex; margin-top:2px; padding-inline:30px 14px; }
.qb-xaxis div{ flex:1; text-align:center; font-size:10.5px; color:var(--dim); font-weight:600; min-width:0; }
.qb-xaxis div small{ display:block; font-size:9px; opacity:.75; font-weight:500; }
.qb-xaxis div.on{ color:#16a34a; font-weight:800; }
.qb-empty{ position:absolute; inset:0; display:grid; place-items:center; color:var(--none); font-size:13px; z-index:1; }

/* ---------- ranking table ---------- */
.qb-table{ min-height:0; }
/* The row area takes the leftover height and clips: the JS reads THIS box to
   decide the page size, and the legend keeps its own strip below it. */
.qb-rows{ flex:1; min-height:0; overflow:hidden; }
.qb-table .qb-foot{ margin-top:auto; }
.qb-table table{ width:100%; border-collapse:collapse; table-layout:fixed; }
.qb-table th{ position:sticky; top:0; background:#f8fafc; font-size:9.5px; font-weight:800; color:var(--dim);
  letter-spacing:.045em; padding:0 6px; height:32px; white-space:nowrap;
  border-bottom:1px solid var(--line); text-align:start; }
.qb-table th.c,.qb-table td.c{ text-align:center; }
.qb-table td{ height:56px; padding:0 6px; border-bottom:1px solid #f1f5f9; font-size:12.5px;
  font-variant-numeric:tabular-nums; overflow:hidden; }
.qb-table td small{ color:var(--dim); font-size:11px; }
.qb-table tbody tr:hover td{ background:#fbfdff; }
.qb-table tr.prov td{ background:#fcfcfd; }
/* Two halves of one number, side by side in the popup. */
.qb-tabs{ display:flex; gap:6px; padding:0 20px 12px; border-bottom:1px solid var(--line) }
.qb-tab{ font:inherit; font-size:12px; font-weight:700; padding:6px 14px; border-radius:999px;
  border:1px solid var(--line); background:#fff; color:var(--dim); cursor:pointer }
.qb-tab:hover{ color:var(--ink) }
.qb-tab.on{ background:var(--ink); border-color:var(--ink); color:#fff }
/* Why a lead went unanswered — the content of an otherwise empty cell. */
.qb-reason{ font-size:11px; font-weight:700; margin-bottom:2px }
.qb-reason.bad{ color:var(--bad) } .qb-reason.warn{ color:var(--warn) } .qb-reason.dim{ color:var(--dim) }
.qb-mini{ font-size:10px; color:var(--dim); line-height:1.15; }
.qb-mini.g{ color:#15803d; font-weight:700 }
.qb-rank{ display:inline-grid; place-items:center; width:26px; height:26px; border-radius:50%;
  background:#eef2f7; font-weight:800; font-size:11.5px; color:#475569; }
.qb-rank.r1{ background:linear-gradient(135deg,#fbbf24,#f59e0b); color:#fff; box-shadow:0 3px 8px rgba(245,158,11,.4) }
.qb-rank.r2{ background:linear-gradient(135deg,#cbd5e1,#94a3b8); color:#fff }
.qb-rank.r3{ background:linear-gradient(135deg,#fdba74,#ea580c); color:#fff }
.qb-emp{ display:flex; align-items:center; gap:8px; min-width:0; }
.qb-emp-txt{ min-width:0; display:flex; flex-direction:column; line-height:1.25; }
.qb-emp-name{ font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.qb-emp-txt small{ font-size:9.5px; }
.qb-tag{ flex:0 0 auto; font-size:9px; font-weight:800; color:#92400e; background:#fef3c7;
  border-radius:6px; padding:2px 5px; white-space:nowrap; }
.qb-sc{ font-weight:800; font-size:15px; }
.qb-sc.exc{ color:var(--exc) } .qb-sc.str{ color:var(--str) } .qb-sc.good{ color:var(--good) }
.qb-sc.warn{ color:var(--warn) } .qb-sc.bad{ color:var(--bad) } .qb-sc.none{ color:var(--none) }
.qb-ring{ display:inline-grid; place-items:center; min-width:34px; height:20px; border-radius:999px;
  font-size:10px; font-weight:800; margin-inline-start:5px; }
.qb-ring.g{ background:#dcfce7; color:#15803d } .qb-ring.w{ background:#fef3c7; color:#92400e }
.qb-ring.b{ background:#fee2e2; color:#b91c1c }
.qb-risk{ display:inline-flex; align-items:center; gap:4px; font-size:10.5px; font-weight:800;
  border-radius:7px; padding:3px 7px; white-space:nowrap; }
.qb-risk.ok{ background:#f1f5f9; color:#64748b } .qb-risk.mid{ background:#eef2ff; color:#4338ca }
.qb-risk.warn{ background:#fff7ed; color:#9a3412 } .qb-risk.bad{ background:#fee2e2; color:var(--bad) }
.qb-none{ text-align:center; color:var(--none); }
.qb-foot{ display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:5px 13px; border-top:1px solid var(--line); font-size:10px; color:var(--dim); }
.qb-legend{ display:flex; gap:10px; flex-wrap:wrap; }
.qb-legend span{ display:inline-flex; align-items:center; gap:4px; }
.qb-legend i{ width:8px; height:8px; border-radius:50%; display:inline-block; }
.qb-legend i.exc{ background:var(--exc) } .qb-legend i.str{ background:var(--str) } .qb-legend i.good{ background:var(--good) }
.qb-legend i.warn{ background:var(--warn) } .qb-legend i.bad{ background:var(--bad) } .qb-legend i.none{ background:var(--none) }
.qb-pager{ font-weight:800; white-space:nowrap; } .qb-pager .dim{ font-weight:500; }

/* ---------- bottom strip ---------- */
.qb-strip{ display:grid; grid-template-columns:repeat(5,1fr); gap:8px; }
.qb-sc-card{ background:var(--card); border:1px solid var(--line); border-radius:13px;
  padding:8px 11px; display:flex; align-items:center; gap:9px; min-width:0;
  box-shadow:0 3px 10px rgba(15,23,42,.04); }
.qb-sc-ic{ width:30px; height:30px; flex:0 0 30px; border-radius:9px; display:grid; place-items:center; }
.qb-sc-ic.sky{ background:#e0f2fe; color:#0284c7 } .qb-sc-ic.amber{ background:#fef3c7; color:#b45309 }
.qb-sc-ic.red{ background:#fee2e2; color:#b91c1c } .qb-sc-ic.green{ background:#dcfce7; color:#15803d }
.qb-sc-ic.violet{ background:#f3e8ff; color:#7e22ce }
.qb-sc-card b{ font-size:20px; font-weight:800; font-variant-numeric:tabular-nums; }
.qb-sc-card span:last-child{ font-size:10.5px; color:var(--dim); line-height:1.25; min-width:0; }

/* ---------- drill-down (desk only: needs a session) ---------- */
.qb .click{ cursor:pointer; transition:background .12s ease, box-shadow .12s ease; }
.qb-kpi.click:hover{ box-shadow:0 6px 20px rgba(79,70,229,.18); border-color:#c7d2fe }
.qb-kpi.click:focus-visible{ outline:2px solid #6366f1; outline-offset:2px }
.qb-sc-card.click:hover{ box-shadow:0 6px 18px rgba(79,70,229,.16); border-color:#c7d2fe }
td.click:hover{ background:#eef2ff !important; }
.qb-modal-bg{ position:fixed; inset:0; background:rgba(15,23,42,.55); backdrop-filter:blur(2px);
  display:flex; align-items:center; justify-content:center; z-index:90; padding:3vh 3vw; }
.qb-modal{ background:#fff; border-radius:16px; width:min(1180px,96vw); max-height:94vh;
  display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 60px rgba(15,23,42,.35); }
.qb-modal-head{ display:flex; align-items:flex-start; justify-content:space-between; gap:14px;
  padding:14px 18px; border-bottom:1px solid var(--line); }
.qb-modal-head h3{ margin:0; font-size:16px; font-weight:800; }
.qb-modal-head p{ margin:3px 0 0; color:var(--dim); font-size:12px; font-variant-numeric:tabular-nums; }
.qb-x{ border:1px solid var(--line); background:#f8fafc; border-radius:9px; width:30px; height:30px;
  cursor:pointer; color:var(--dim); font-size:14px; flex:0 0 30px; }
.qb-x:hover{ background:#fee2e2; color:var(--bad); border-color:#fecaca }
.qb-modal-err{ margin:0; padding:12px 18px; color:var(--bad); font-size:13px; }
.qb-modal-none{ padding:26px; text-align:center; color:var(--none); }
/* The ONE place scrolling is correct: a 300-row list a manager reads at a desk,
   not the wall display. */
.qb-modal-body{ overflow:auto; padding:0 4px 4px; }
.qb-dt{ width:100%; border-collapse:collapse; font-size:12.5px; }
.qb-dt th{ position:sticky; top:0; background:#f8fafc; text-align:start; padding:8px 10px;
  font-size:10px; font-weight:800; color:var(--dim); letter-spacing:.04em; text-transform:uppercase;
  border-bottom:1px solid var(--line); }
.qb-dt th.c,.qb-dt td.c{ text-align:center }
.qb-dt td{ padding:8px 10px; border-bottom:1px solid #f1f5f9; vertical-align:top; }
.qb-dt tr:hover td{ background:#fbfdff }
.qb-dt .mono{ font-family:ui-monospace,Consolas,monospace; font-size:12px }
.qb-dt small{ color:var(--dim) }
.qb-dt-sub{ color:var(--dim); font-size:11px; margin-top:2px; max-width:430px;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.qb-dt-iss{ display:flex; gap:4px; flex-wrap:wrap; margin-top:4px }
.qb-dt .dim{ color:var(--none) } .qb-dt .bad{ color:var(--bad); font-weight:700 }

/* 1600x900 and 1366x768: tighten rather than reflow — the layout must not change
   shape on the sales-room display, only get denser. */
@media (max-width:1700px){
  .qb-kpi-val{ font-size:21px } .qb-table td{ height:50px } .qb-hl-score{ font-size:20px }
}
@media (max-width:1400px){
  .qb{ padding:8px 10px; gap:7px; }
  .qb-kpis{ gap:6px } .qb-kpi{ padding:8px 9px; border-radius:12px }
  .qb-kpi-val{ font-size:18px } .qb-kpi-ic{ width:24px; height:24px; flex:0 0 24px }
  .qb-kpi-label{ font-size:9px } .qb-kpi-foot{ font-size:9.5px }
  .qb-mid{ grid-template-columns:37fr 63fr }
  .qb-table td{ height:44px; font-size:11.5px } .qb-table th{ height:28px; font-size:9px }
  .qb-av{ width:23px; height:23px; flex:0 0 23px } .qb-av.lg{ width:34px; height:34px; flex:0 0 34px }
  .qb-hl-score{ font-size:17px } .qb-sc-card b{ font-size:17px }
  .qb-logo{ width:34px; height:34px; flex:0 0 34px }
}
`;
