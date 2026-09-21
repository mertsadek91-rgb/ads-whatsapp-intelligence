import { useState } from "react";
import { useI18n } from "../i18n.jsx";

// A Meta entity id shown compactly with a one-click copy button and an
// optional deep link into Meta Ads Manager (manage_url from the API). Lets the
// owner find the exact same ad/campaign inside their ad account. The full id is
// always the copied value and the title tooltip — only the display is trimmed.
export default function IdCell({ id, url, tail = 10 }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  if (!id) return <span className="muted">—</span>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(String(id));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard blocked (insecure context) — ignore */ }
  }

  const shown = String(id).length > tail ? "…" + String(id).slice(-tail) : String(id);
  return (
    <span className="id-cell" dir="ltr">
      <code className="id-code" title={String(id)}>{shown}</code>
      <button type="button" className="id-btn" onClick={copy} title={t("نسخ")}>
        {copied ? "✓" : "⧉"}
      </button>
      {url && (
        <a className="id-btn" href={url} target="_blank" rel="noreferrer" title={t("افتح في مدير إعلانات Meta")}>↗</a>
      )}
    </span>
  );
}
