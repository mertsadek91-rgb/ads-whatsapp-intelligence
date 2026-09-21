import { useEffect, useState, lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import api from "./api.js";
import { DateRangeProvider } from "./components/DateRangeContext.jsx";
import { I18nProvider, useI18n } from "./i18n.jsx";
import { CurrencyProvider } from "./currency.jsx";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";

// BUG-041 fix: these pages used to be static imports, bundling everything
// (incl. recharts) into one 616KB chunk loaded before the user sees anything.
// Lazy-loading splits each route into its own chunk, fetched on navigation.
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Campaigns = lazy(() => import("./pages/Campaigns.jsx"));
const Ads = lazy(() => import("./pages/Ads.jsx"));
const Posts = lazy(() => import("./pages/Posts.jsx"));
const Countries = lazy(() => import("./pages/Countries.jsx"));
const CampaignTree = lazy(() => import("./pages/CampaignTree.jsx"));
const Agents = lazy(() => import("./pages/Agents.jsx"));
const Leads = lazy(() => import("./pages/Leads.jsx"));
const Conversations = lazy(() => import("./pages/Conversations.jsx"));
const Reengagement = lazy(() => import("./pages/Reengagement.jsx"));
const Report = lazy(() => import("./pages/Report.jsx"));
const Employees = lazy(() => import("./pages/Employees.jsx"));
const EmployeesAdmin = lazy(() => import("./pages/EmployeesAdmin.jsx"));
const Knowledge = lazy(() => import("./pages/Knowledge.jsx"));
const Assignment = lazy(() => import("./pages/Assignment.jsx"));
const Handover = lazy(() => import("./pages/Handover.jsx"));
const QualityReview = lazy(() => import("./pages/QualityReview.jsx"));
const Tags = lazy(() => import("./pages/Tags.jsx"));
const Broadcasts = lazy(() => import("./pages/Broadcasts.jsx"));
const Salesboard = lazy(() => import("./pages/Salesboard.jsx"));
const SalesScreen = lazy(() => import("./pages/SalesScreen.jsx"));
const QualityScreen = lazy(() => import("./pages/QualityScreen.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));
const Users = lazy(() => import("./pages/Users.jsx"));
const SetupApp = lazy(() => import("./setup/SetupApp.jsx"));

function AppInner() {
  const { t } = useI18n();
  const [me, setMe] = useState(null); // null = loading
  const [installed, setInstalled] = useState(null);
  const authed = me?.authed ?? null;

  // Checked BEFORE the kiosk bypass and before /auth/me: on an uninstalled
  // instance every API call answers 503, so a wall display pointed here would
  // otherwise render a permanently broken board instead of saying why.
  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((d) => setInstalled(d.installed !== false))
      .catch(() => setInstalled(true));   // assume installed if we cannot tell
  }, []);

  useEffect(() => {
    if (installed !== true) return;
    api.me().then(setMe).catch(() => setMe({ authed: false }));
  }, [installed]);

  if (installed === null) return <div style={{ padding: 40 }}>{t("جارٍ التحميل…")}</div>;
  if (installed === false) {
    return <Suspense fallback={<div style={{ padding: 40 }}>{t("جارٍ التحميل…")}</div>}>
      <SetupApp />
    </Suspense>;
  }

  // Public wall-display (kiosk) — no login, token-gated by the page itself.
  // Checked before the auth gate so a TV can open it without a session.
  // /tv/<code> is the short stable link; /screen/salesboard?token= still works.
  if (window.location.pathname.startsWith("/screen/") || window.location.pathname.startsWith("/tv")) {
    // Two wall displays share the kiosk gate: the original contact-rate board and
    // the quality board. Same token, different screen — /screen/quality or the
    // short /tv/<code>/quality.
    const quality = /(^\/screen\/quality|\/quality\/?$)/.test(window.location.pathname);
    return <Suspense fallback={<div style={{ padding: 40, background: "#f4f7fb", color: "#64748b", minHeight: "100vh" }}>{t("جارٍ التحميل…")}</div>}>
      {quality ? <QualityScreen /> : <SalesScreen />}
    </Suspense>;
  }

  if (authed === null) return <div style={{ padding: 40 }}>{t("جارٍ التحميل…")}</div>;
  if (!authed) return <Login onLogin={() => api.me().then(setMe).catch(() => setMe({ authed: true }))} />;

  return (
    <DateRangeProvider>
      <CurrencyProvider>
        <Suspense fallback={<div style={{ padding: 40 }}>{t("جارٍ التحميل…")}</div>}>
          <Routes>
            <Route element={<Layout onLogout={() => setMe({ authed: false })} role={me?.role} />}>
              <Route path="/salesboard" element={<Salesboard />} />
              <Route path="/" element={<Dashboard />} />
              <Route path="/campaigns" element={<Campaigns />} />
              <Route path="/ads" element={<Ads />} />
              <Route path="/posts" element={<Posts />} />
              <Route path="/countries" element={<Countries />} />
              <Route path="/campaign-tree" element={<CampaignTree />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/conversations" element={<Conversations />} />
              <Route path="/reengagement" element={<Reengagement />} />
              <Route path="/report" element={<Report />} />
              <Route path="/employees" element={<Employees />} />
              <Route path="/employees-admin" element={<EmployeesAdmin />} />
              <Route path="/assignment" element={<Assignment />} />
              <Route path="/handover" element={<Handover />} />
              <Route path="/knowledge" element={<Knowledge />} />
              <Route path="/quality-review" element={<QualityReview />} />
              <Route path="/tags" element={<Tags />} />
              <Route path="/broadcasts" element={<Broadcasts />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/users" element={<Users />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Route>
          </Routes>
        </Suspense>
      </CurrencyProvider>
    </DateRangeProvider>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppInner />
    </I18nProvider>
  );
}
