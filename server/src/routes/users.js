// Account administration. Before this existed, createUser() was called from
// exactly one place — ensureBootstrapAdmin() — so an install had precisely one
// account forever, with a random password printed once to the server log. A
// second employee could not be onboarded, and a missed container log meant the
// install was unrecoverable without direct SQL.
//
// Mounted behind requireRole("admin") in server.js.
import { Router } from "express";
import * as users from "../lib/authUsers.js";
import { wrap } from "../lib/wrap.js";

const router = Router();

router.get("/", wrap(async (req, res) => {
  res.json({ users: await users.listUsers(), roles: users.ROLES });
}));

router.post("/", wrap(async (req, res) => {
  const email = String(req.body?.email || "").trim();
  const password = req.body?.password || "";
  const role = users.clampRole(req.body?.role);
  if (!email) return res.status(400).json({ error: "البريد الإلكتروني مطلوب" });
  try { users.assertPasswordStrength(password); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  if (await users.findByEmail(email)) {
    return res.status(409).json({ error: "هذا البريد مسجّل بالفعل" });
  }
  const created = await users.createUser(email, password, role);
  res.json({ ok: true, user: { id: created.id, email: created.email, role: created.role } });
}));

// Guard every change that could strand the install with no one able to
// administer it — demoting, disabling or deleting the last active admin.
async function refuseIfLastAdmin(id, res, action) {
  if (await users.isLastActiveAdmin(id)) {
    res.status(409).json({
      error: `لا يمكن ${action} آخر حساب مدير نشط — أنشئ مديراً آخر أولاً`,
    });
    return true;
  }
  return false;
}

router.patch("/:id", wrap(async (req, res) => {
  const id = Number(req.params.id);
  const target = await users.findById(id);
  if (!target) return res.status(404).json({ error: "المستخدم غير موجود" });

  const demoting = req.body?.role != null && users.clampRole(req.body.role) !== "admin";
  const disabling = req.body?.status === "disabled";
  if ((demoting || disabling) && await refuseIfLastAdmin(id, res, "تعطيل أو تخفيض")) return;

  await users.updateUser(id, { role: req.body?.role, status: req.body?.status });
  res.json({ ok: true });
}));

// An admin resetting someone else's password. Distinct from /auth/change-password,
// which is a user changing their own and requires the current one.
router.post("/:id/password", wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!(await users.findById(id))) return res.status(404).json({ error: "المستخدم غير موجود" });
  try { await users.setPassword(id, req.body?.password || ""); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  res.json({ ok: true });
}));

router.delete("/:id", wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.userId) {
    return res.status(409).json({ error: "لا يمكنك حذف حسابك الخاص" });
  }
  if (!(await users.findById(id))) return res.status(404).json({ error: "المستخدم غير موجود" });
  if (await refuseIfLastAdmin(id, res, "حذف")) return;
  await users.deleteUser(id);
  res.json({ ok: true });
}));

export default router;
