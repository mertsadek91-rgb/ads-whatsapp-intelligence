// Account administration + self-service password change.
//
// Until this page existed an install had exactly one account, created once at
// first boot with a random password printed to the server log, and no way to
// add a colleague or rotate that password short of writing SQL by hand.
import { useEffect, useState } from "react";
import api from "../api.js";
import { useI18n } from "../i18n.jsx";

const ROLE_LABEL = { admin: "مدير", manager: "مشرف عمليات", viewer: "اطّلاع فقط" };
const roleLabel = (r) => ROLE_LABEL[r] || r;

const ROLE_HELP = {
  admin: "كل شيء: الإعدادات، المستخدمون، الحملات الجماعية، وإعادة المزامنة.",
  manager: "العمليات اليومية: إسناد المحادثات وتسليم الموظفين.",
  viewer: "اطّلاع فقط على اللوحات والتقارير.",
};

export default function Users() {
  const { t } = useI18n();
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState(["admin", "manager", "viewer"]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", role: "viewer" });
  const [pw, setPw] = useState({ current_password: "", new_password: "", confirm: "" });

  const say = (ok, text) => setMsg({ ok, text });

  async function load() {
    try {
      const d = await api.get("/users");
      setRows(d.users || []);
      if (d.roles?.length) setRoles(d.roles);
    } catch (e) { say(false, e.message); }
  }
  useEffect(() => { load(); }, []);

  async function run(fn, okText) {
    setBusy(true); setMsg(null);
    try { await fn(); await load(); say(true, okText); }
    catch (e) { say(false, e.message); }
    finally { setBusy(false); }
  }

  const addUser = () => run(async () => {
    await api.post("/users", form);
    setForm({ email: "", password: "", role: "viewer" });
  }, t("تمت إضافة المستخدم"));

  const changeRole = (u, role) => run(() => api.patch(`/users/${u.id}`, { role }), t("تم تحديث الصلاحية"));
  const toggleStatus = (u) => run(
    () => api.patch(`/users/${u.id}`, { status: u.status === "active" ? "disabled" : "active" }),
    t("تم تحديث الحالة"));

  const resetPassword = (u) => {
    const next = window.prompt(t("كلمة مرور جديدة لهذا المستخدم (10 أحرف على الأقل)"));
    if (!next) return;
    run(() => api.post(`/users/${u.id}/password`, { password: next }), t("تم تعيين كلمة المرور"));
  };

  const removeUser = (u) => {
    if (!window.confirm(t("حذف {email} نهائياً؟", { email: u.email }))) return;
    run(() => api.del(`/users/${u.id}`), t("تم الحذف"));
  };

  async function changeOwnPassword(e) {
    e.preventDefault();
    if (pw.new_password !== pw.confirm) return say(false, t("كلمتا المرور غير متطابقتين"));
    setBusy(true); setMsg(null);
    try {
      await api.post("/auth/change-password",
        { current_password: pw.current_password, new_password: pw.new_password });
      setPw({ current_password: "", new_password: "", confirm: "" });
      say(true, t("تم تغيير كلمة المرور"));
    } catch (e2) { say(false, e2.message); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <h2>{t("المستخدمون والصلاحيات")}</h2>
      {msg && <div className={msg.ok ? "note ok" : "note err"}>{msg.text}</div>}

      <section className="section">
        <h3>{t("الحسابات")}</h3>
        <table className="table">
          <thead>
            <tr>
              <th>{t("البريد الإلكتروني")}</th><th>{t("الصلاحية")}</th><th>{t("الحالة")}</th>
              <th>{t("آخر دخول")}</th><th>{t("إجراءات")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>
                  <select value={u.role} disabled={busy}
                    onChange={(e) => changeRole(u, e.target.value)}>
                    {roles.map((r) => <option key={r} value={r}>{t(roleLabel(r))}</option>)}
                  </select>
                </td>
                <td>{u.status === "active" ? t("نشط") : t("معطّل")}</td>
                <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}</td>
                <td>
                  <button className="btn ghost sm" disabled={busy} onClick={() => toggleStatus(u)}>
                    {u.status === "active" ? t("تعطيل") : t("تفعيل")}
                  </button>{" "}
                  <button className="btn ghost sm" disabled={busy} onClick={() => resetPassword(u)}>
                    {t("كلمة مرور جديدة")}
                  </button>{" "}
                  <button className="btn ghost sm" disabled={busy} onClick={() => removeUser(u)}>
                    {t("حذف")}
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5}>{t("لا يوجد مستخدمون بعد")}</td></tr>}
          </tbody>
        </table>
        <p className="hint">
          {t("لا يمكن تعطيل أو تخفيض أو حذف آخر حساب مدير نشط — أنشئ مديراً آخر أولاً.")}
        </p>
      </section>

      <section className="section">
        <h3>{t("إضافة مستخدم")}</h3>
        <div className="field">
          <label>{t("البريد الإلكتروني")}</label>
          <input type="email" value={form.email} autoComplete="off"
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="field">
          <label>{t("كلمة المرور")}</label>
          <input type="password" value={form.password} autoComplete="new-password"
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <div className="field">
          <label>{t("الصلاحية")}</label>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {roles.map((r) => <option key={r} value={r}>{t(roleLabel(r))}</option>)}
          </select>
          <p className="hint">{t(ROLE_HELP[form.role] || "")}</p>
        </div>
        <button className="btn" disabled={busy || !form.email || !form.password} onClick={addUser}>
          {t("إضافة")}
        </button>
      </section>

      <section className="section">
        <h3>{t("تغيير كلمة مروري")}</h3>
        <form onSubmit={changeOwnPassword}>
          <div className="field">
            <label>{t("كلمة المرور الحالية")}</label>
            <input type="password" value={pw.current_password} autoComplete="current-password"
              onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
          </div>
          <div className="field">
            <label>{t("كلمة المرور الجديدة")}</label>
            <input type="password" value={pw.new_password} autoComplete="new-password"
              onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
          </div>
          <div className="field">
            <label>{t("تأكيد كلمة المرور الجديدة")}</label>
            <input type="password" value={pw.confirm} autoComplete="new-password"
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </div>
          <button className="btn" type="submit"
            disabled={busy || !pw.current_password || !pw.new_password}>
            {t("تغيير كلمة المرور")}
          </button>
        </form>
      </section>
    </div>
  );
}
