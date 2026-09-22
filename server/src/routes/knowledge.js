// Knowledge Base review/management API. Lists AI-generated + manual Q&A pairs,
// lets a human edit/approve/delete them, and triggers on-demand generation from
// recent conversations. The approved set is what will later feed an AI chatbot.
import { Router } from "express";
import { wrap } from "../lib/wrap.js";
import { generateKB, listKB, kbStats, createManual, updateKB, deleteKB, kbCategories } from "../lib/knowledgeBase.js";
import { hasKey } from "../lib/deepseek.js";

const router = Router();

router.get("/", wrap(async (req, res) => {
  const { status, category, lang, q } = req.query;
  const [items, stats] = await Promise.all([
    listKB({ status, category, lang, q: q ? String(q).slice(0, 100) : undefined }),
    kbStats(),
  ]);
  res.json({ items, stats, categories: kbCategories(), aiAvailable: hasKey() });
}));

router.post("/generate", async (req, res) => {
  if (!hasKey()) return res.status(400).json({ error: "الذكاء الاصطناعي غير متاح — أضِف DEEPSEEK_API_KEY" });
  try {
    const r = await generateKB({ limit: Number(req.body?.limit) || 150 });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/", async (req, res) => {
  try {
    const { question, answer, category, lang } = req.body || {};
    await createManual({ question, answer, category, lang });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "معرّف غير صالح" });
  try {
    const r = await updateKB(id, req.body || {});
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete("/:id", wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "معرّف غير صالح" });
  await deleteKB(id);
  res.json({ ok: true });
}));

export default router;
