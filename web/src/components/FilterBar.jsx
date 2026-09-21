import { useDateRange, PRESETS } from "./DateRangeContext.jsx";
import { useI18n } from "../i18n.jsx";

// Shared date-range bar. `children` lets a page add its own filter controls.
export default function FilterBar({ children, note }) {
  const dr = useDateRange();
  const { t } = useI18n();
  return (
    <div className="filterbar">
      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.key}
            className={`chip ${dr.preset === p.key ? "active" : ""}`}
            onClick={() => dr.applyPreset(p)}>{t(p.label)}</button>
        ))}
      </div>
      <div className="daterange">
        <label>{t("من")}</label>
        <input type="date" value={dr.since} onChange={(e) => dr.setSince(e.target.value)} />
        <label>{t("إلى")}</label>
        <input type="date" value={dr.until} onChange={(e) => dr.setUntil(e.target.value)} />
      </div>
      {children}
      {note && <span className="muted">{t(note)}</span>}
    </div>
  );
}
