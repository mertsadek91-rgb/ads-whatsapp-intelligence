// App shell — DashSpace-style admin layout: a fixed sidebar whose links are
// grouped into labelled sections with icons, a sticky translucent app bar
// holding the global switchers, and a slide-in drawer on mobile.
// Icons are inline SVG (no icon dependency) and inherit currentColor.
import { useState, useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import api from "../api.js";
import { useI18n } from "../i18n.jsx";
import { useCurrency } from "../currency.jsx";
import { useIdentity, brandName, brandTagline } from "../identity.jsx";
import UpdateControls from "./UpdateControls.jsx";
import OnboardingPanel from "./OnboardingPanel.jsx";

const I = {
  dash: "M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z",
  megaphone: "M3 11v2a1 1 0 0 0 1 1h2l3 4V6L6 10H4a1 1 0 0 0-1 1Zm11-5v12a4 4 0 0 0 0-12Z",
  tree: "M4 4h6v4H4V4Zm10 12h6v4h-6v-4Zm0-8h6v4h-6V8ZM7 8v9h7M7 13h7",
  image: "M4 5h16v14H4V5Zm3 9 3-3 3 3 2-2 3 3",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.5 2.5 2.5 15.5 0 18M3 12h18",
  users: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 8v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  star: "m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6.1L12 16.8 6.7 19.7l1.1-6.1L3.4 9.4l6-.8L12 3Z",
  chat: "M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.4A8 8 0 1 1 20 12Z",
  refresh: "M20 11A8 8 0 0 0 6.3 6.3L4 8.5M4 5v3.5H7.5M4 13a8 8 0 0 0 13.7 4.7L20 15.5M20 19v-3.5h-3.5",
  report: "M6 3h9l4 4v14H6V3Zm9 0v4h4M9 12h7M9 16h7",
  board: "M4 4h16v12H4V4Zm5 16h6M12 16v4",
  book: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm3 4h8M8 12h8",
  cog: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm8-3.2c0-.6-.1-1.1-.2-1.7l2-1.5-2-3.4-2.3 1a8 8 0 0 0-2.9-1.7L14.2 2H9.8l-.4 2.7a8 8 0 0 0-2.9 1.7l-2.3-1-2 3.4 2 1.5a8.4 8.4 0 0 0 0 3.4l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 2.9 1.7l.4 2.7h4.4l.4-2.7a8 8 0 0 0 2.9-1.7l2.3 1 2-3.4-2-1.5c.1-.6.2-1.1.2-1.7Z",
  tag: "M20.6 13.4 12 22l-9-9V4h9l8.6 8.6a1 1 0 0 1 0 1.4ZM7.5 7.5h.01",
  idcard: "M3 6h18v12H3V6Zm4 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM14 9h4M14 12h4M14 15h2M5 16c.6-1.3 1.8-2 3-2s2.4.7 3 2",
  send: "M22 2 11 13M22 2 15 22l-4-9-9-4 20-7Z",
};
const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

// [path, arabic label, icon] grouped into labelled sections.
const GROUPS = [
  ["عام", [
    ["/", "لوحة المؤشرات", I.dash],
  ]],
  ["الإعلانات", [
    ["/campaigns", "الحملات", I.megaphone],
    ["/campaign-tree", "شجرة الحملات", I.tree],
    ["/ads", "الإعلانات", I.image],
    ["/posts", "البوستات", I.image],
    ["/countries", "تحليل البلدان", I.globe],
  ]],
  ["العملاء", [
    ["/leads", "العملاء المؤهّلون", I.users],
    ["/conversations", "المحادثات + AI", I.chat],
    ["/tags", "وسوم العملاء", I.tag],
    ["/assignment", "إسناد المحادثات", I.idcard, ["admin", "manager"]],
    ["/broadcasts", "حملات واتساب الجماعية", I.send, ["admin"]],
    ["/reengagement", "إعادة التواصل", I.refresh],
  ]],
  ["الفريق", [
    ["/agents", "المسؤولون", I.users],
    ["/employees", "تقارير الموظفين", I.report],
    ["/salesboard", "لوحة المبيعات التحفيزية", I.board],
    ["/quality-review", "مراجعة الجودة والالتزام", I.star],
    ["/employees-admin", "إدارة الموظفين والإيميلات", I.idcard, ["admin"]],
    ["/handover", "خروج موظف — تسليم", I.refresh, ["admin", "manager"]],
  ]],
  ["النظام", [
    ["/report", "التقرير الشامل", I.report],
    ["/knowledge", "قاعدة المعرفة", I.book],
    ["/business-profile", "ملف نشاط الشركة", I.book, ["admin"]],
    ["/users", "المستخدمون والصلاحيات", I.idcard, ["admin"]],
    ["/settings", "الإعدادات", I.cog, ["admin"]],
  ]],
];

export default function Layout({ onLogout, role }) {
  const { t, lang, setLang } = useI18n();
  const { currency, setCurrency, currencies } = useCurrency();
  const { identity } = useIdentity();
  const [drawer, setDrawer] = useState(false);
  const { pathname } = useLocation();

  // Close the mobile drawer whenever the route changes, so tapping a link
  // doesn't leave the overlay covering the page you just navigated to.
  useEffect(() => { setDrawer(false); }, [pathname]);

  async function logout() { await api.logout().catch(() => {}); onLogout(); }

  return (
    <div className="app">
      <div className={`drawer-backdrop ${drawer ? "show" : ""}`} onClick={() => setDrawer(false)} />

      <aside className={`sidebar ${drawer ? "open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">{identity.monogram}</div>
          <div>
            <h1>{brandName(identity, lang)}</h1>
            <div className="sub">{brandTagline(identity, lang) || t("حملات Meta × واتساب")}</div>
          </div>
        </div>

        <nav className="nav">
          {GROUPS.map(([group, links]) => {
            // Hide what this account cannot use. The server is the access
            // control (requireRole in server.js); this just avoids showing a
            // link that can only answer 403. A whole section disappears when
            // nothing in it is visible, rather than leaving an empty heading.
            const visible = links.filter(([, , , roles]) => !roles || roles.includes(role));
            if (!visible.length) return null;
            return (
              <div key={group}>
                <div className="nav-group-title">{t(group)}</div>
                {visible.map(([to, label, icon]) => (
                  <NavLink key={to} to={to} end={to === "/"}>
                    <Icon d={icon} />{t(label)}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

      </aside>

      <main className="main">
        <header className="appbar">
          <button className="hamburger" onClick={() => setDrawer((v) => !v)}
            aria-label={t("القائمة")} aria-expanded={drawer}>
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <div className="spacer" />
          <div className="appbar-actions">
            <UpdateControls compact />
            <select className="currency-switch" value={currency} onChange={(e) => setCurrency(e.target.value)}
              title={t("العملة المعروضة")}>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
              ))}
            </select>
            <button className="btn ghost sm" title={lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}
              onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
              {lang === "ar" ? "EN" : "عربي"}
            </button>
            <button className="btn ghost sm" onClick={logout}>{t("تسجيل الخروج")}</button>
          </div>
        </header>

        <div className="page"><Outlet /></div>
      </main>

      {/* Outside <main> so it stays put while the page scrolls. */}
      <OnboardingPanel role={role} />
    </div>
  );
}
