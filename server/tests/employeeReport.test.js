// Per-employee report endpoints (/report/employees, /report/employee/:agent,
// /report/employee/:agent/notes). Covers: date filtering reaches the SQL,
// KPI/theme aggregation from agent_eval, and that the AI notes prompt is
// generated in the requested language and cached per agent+language.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const state = { rows: [], insights: {}, owners: ["Ahmed"], distinct: ["Ahmed"], groups: [], transcripts: {} };

vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    if (sql.includes("distinct contact_owner")) {
      return state.owners.map((v) => ({ v }));
    }
    if (sql.includes("select distinct") && sql.includes("raw from ads_conversation_analysis")) {
      return state.distinct.map((raw) => ({ raw }));
    }
    if (sql.includes("count(*) c") && sql.includes("group by 1")) {
      return state.groups;
    }
    if (sql.includes("join ads_wati_contacts c") && sql.includes("from ads_conversation_analysis a")) {
      state.lastSql = sql; state.lastParams = params;
      return state.rows;
    }
    if (sql.startsWith("select thread_snapshot, analyzed_at from ads_conversation_analysis")) {
      return state.transcripts[params[0]] ? [state.transcripts[params[0]]] : [];
    }
    if (sql.startsWith("select data, generated_at from ads_ai_insights")) {
      const row = state.insights[params[0]];
      return row ? [{ data: row, generated_at: "2026-07-04T10:00:00Z" }] : [];
    }
    if (sql.startsWith("insert into ads_ai_insights")) {
      state.insights[params[0]] = params[1];
      return {};
    }
    throw new Error("unexpected query: " + sql);
  }),
}));

const chatJSON = vi.fn();
vi.mock("../src/lib/deepseek.js", () => ({
  hasKey: () => true,
  chatJSON: (...a) => chatJSON(...a),
}));

const buildReportHtml = vi.fn(() => "<html>fake report</html>");
const htmlToPdf = vi.fn(async () => Buffer.from("%PDF-fake"));
vi.mock("../src/lib/pdfReport.js", () => ({
  buildReportHtml: (...a) => buildReportHtml(...a),
  htmlToPdf: (...a) => htmlToPdf(...a),
}));

const reportRouter = (await import("../src/routes/report.js")).default;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/report", reportRouter);
  return app;
}

const row = (over = {}) => ({
  wa_id: "w1", full_name: "Customer", phone: "9665550001", last_message_at: "2026-07-01T10:00:00Z",
  conv_score: 60, agent_score: 70, lead_intent: "warm", lead_status: "مهتم", summary: "ملخص",
  wrong_persuasion: 0, follow_up_min: 12, message_count: 10,
  agent_eval: JSON.stringify({ improvements: ["سرعة الرد"], strengths: ["لباقة"], wrong_persuasion_examples: [] }),
  flags: "[]", analyzed_at: "2026-07-02T10:00:00Z", ...over,
});

beforeEach(() => {
  state.rows = []; state.insights = {}; state.owners = ["Ahmed"];
  state.distinct = ["Ahmed"]; state.groups = []; state.transcripts = {};
  chatJSON.mockReset(); buildReportHtml.mockClear(); htmlToPdf.mockClear();
});

describe("GET /report/employees — name unification", () => {
  it("merges bot/unknown/multi-agent variants into canonical entries", async () => {
    state.owners = ["Ahmed", "Omar"];
    state.groups = [
      { agent: "Ahmed", c: 10 },
      { agent: "Ahmed و Omar", c: 2 },     // multi-agent -> first mentioned (Ahmed)
      { agent: "بوت آلي", c: 3 },
      { agent: "Bot", c: 5 },
      { agent: "غير مذكور", c: 4 },
      { agent: "غير معروف", c: 1 },
    ];
    const res = await request(buildApp()).get("/report/employees");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { agent: "Ahmed", conversations: 12 },
      { agent: "Bot", conversations: 8 },
      { agent: "(غير معروف)", conversations: 5 },
    ]);
  });
});

describe("GET /report/employee/:agent", () => {
  it("aggregates KPIs and themes from the agent's analyzed conversations", async () => {
    state.rows = [
      row(),
      row({ wa_id: "w2", agent_score: 30, conv_score: 40, lead_intent: "hot", wrong_persuasion: 1,
            agent_eval: JSON.stringify({ improvements: ["سرعة الرد", "ذكر المخاطر"], wrong_persuasion_examples: ["وعد بربح مضمون"] }) }),
    ];
    const res = await request(buildApp()).get("/report/employee/Ahmed");
    expect(res.status).toBe(200);
    expect(res.body.kpis.conversations).toBe(2);
    expect(res.body.kpis.avg_agent_score).toBe(50);
    expect(res.body.kpis.wrong_persuasion).toBe(1);
    expect(res.body.kpis.intents).toEqual({ hot: 1, warm: 1, cold: 0 });
    // "سرعة الرد" appears in both conversations -> count 2, sorted first
    expect(res.body.themes.improvements[0]).toEqual({ text: "سرعة الرد", count: 2 });
    expect(res.body.themes.mistakes[0].text).toBe("وعد بربح مضمون");
    expect(res.body.conversations).toHaveLength(2);
  });

  it("passes since/until date filters through to the SQL", async () => {
    await request(buildApp()).get("/report/employee/Ahmed?since=2026-06-01&until=2026-06-30");
    expect(state.lastSql).toMatch(/date\(c\.last_message_at\) >= \?/);
    expect(state.lastSql).toMatch(/date\(c\.last_message_at\) <= \?/);
    expect(state.lastParams).toEqual(["Ahmed", "2026-06-01", "2026-06-30"]);
  });

  it("ignores malformed dates instead of injecting them", async () => {
    await request(buildApp()).get("/report/employee/Ahmed?since=DROP TABLE");
    expect(state.lastSql).not.toMatch(/>=/);
    expect(state.lastParams).toEqual(["Ahmed"]);
  });

  it("fetches ALL raw variants that normalize to the requested canonical agent", async () => {
    state.owners = ["Ahmed", "Omar"];
    state.distinct = ["Ahmed", "Ahmed و Omar", "Omar", "بوت آلي"];
    state.rows = [row()];
    await request(buildApp()).get("/report/employee/Ahmed");
    // "Ahmed" + "Ahmed و Omar" normalize to Ahmed; "Omar" and the bot don't.
    expect(state.lastSql).toMatch(/in \(\?,\?\)/);
    expect(state.lastParams).toEqual(["Ahmed", "Ahmed و Omar"]);
  });
});

describe("GET /report/employee/:agent/export.csv", () => {
  // The export is a report, so its headers, its enum cells and its filename all
  // follow the report language — a spreadsheet full of `lead_intent` / `hot` is
  // not a deliverable in either language.
  it("streams an Arabic CSV by default: Arabic headers, Arabic filename, BOM for Excel", async () => {
    state.rows = [row()];
    const res = await request(buildApp()).get("/report/employee/Ahmed/export.csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    // Arabic can't travel in the plain latin-1 filename, so it goes in filename*
    expect(res.headers["content-disposition"]).toContain("filename*=UTF-8''");
    const lines = res.text.split("\n").filter(Boolean);
    expect(lines[0].startsWith("﻿")).toBe(true);
    expect(lines[0]).toContain("الاسم");
    expect(lines[0]).toContain("النيّة");
    expect(lines[0]).not.toContain("full_name");
    expect(lines).toHaveLength(2); // header + 1 row
    expect(lines[1]).toContain("Customer");
  });

  it("streams an English CSV for ?lang=en, with enum cells translated too", async () => {
    state.rows = [row({ lead_intent: "hot", wrong_persuasion: 1 })];
    const res = await request(buildApp()).get("/report/employee/Ahmed/export.csv?lang=en");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("employee-report.csv");
    const lines = res.text.split("\n").filter(Boolean);
    expect(lines[0]).toContain("Intent");
    expect(lines[0]).toContain("Wrong persuasion");
    expect(lines[0]).not.toContain("النيّة");
    expect(lines[1]).toContain('"Hot"');   // not the raw `hot`
    expect(lines[1]).toContain('"Yes"');   // not the raw `1`
  });

  it("honours Accept-Language when no ?lang is given", async () => {
    state.rows = [row()];
    const res = await request(buildApp())
      .get("/report/employee/Ahmed/export.csv").set("Accept-Language", "en-GB,en;q=0.9");
    expect(res.text.split("\n")[0]).toContain("Name");
  });

  it("returns 404 for an agent with no stored variants", async () => {
    state.distinct = ["SomeoneElse"];
    const res = await request(buildApp()).get("/report/employee/Ahmed/export.csv");
    expect(res.status).toBe(404);
  });
});

describe("POST /report/employee/:agent/notes", () => {
  it("prompts DeepSeek in English when lang=en and caches under the en key", async () => {
    state.rows = [row()];
    chatJSON.mockResolvedValue({ summary: "Good", problems: [], improvements: [], commitments: [], positives: [] });

    const res = await request(buildApp()).post("/report/employee/Ahmed/notes").send({ lang: "en" });
    expect(res.status).toBe(200);
    const [system] = chatJSON.mock.calls[0];
    expect(system).toMatch(/Reply in English/);
    expect(Object.keys(state.insights)).toEqual(["emp:Ahmed:en"]);
  });

  it("prompts in Arabic by default and caches under the ar key", async () => {
    state.rows = [row()];
    chatJSON.mockResolvedValue({ summary: "جيد", problems: [], improvements: [], commitments: [], positives: [] });

    await request(buildApp()).post("/report/employee/Ahmed/notes").send({});
    const [system] = chatJSON.mock.calls[0];
    expect(system).toMatch(/أجب بالعربية/);
    expect(Object.keys(state.insights)).toEqual(["emp:Ahmed:ar"]);
  });

  it("returns 400 (never calls the AI) when there are no conversations in the period", async () => {
    state.rows = [];
    const res = await request(buildApp()).post("/report/employee/Ahmed/notes").send({ lang: "en" });
    expect(res.status).toBe(400);
    expect(chatJSON).not.toHaveBeenCalled();
  });

  it("GET notes returns the cached copy for the requested language only", async () => {
    state.insights["emp:Ahmed:en"] = JSON.stringify({ summary: "cached-en" });
    const en = await request(buildApp()).get("/report/employee/Ahmed/notes?lang=en");
    expect(en.body.generated).toBe(true);
    expect(en.body.summary).toBe("cached-en");
    const ar = await request(buildApp()).get("/report/employee/Ahmed/notes?lang=ar");
    expect(ar.body.generated).toBe(false);
  });
});

describe("GET /report/employee/:agent/coaching", () => {
  it("groups conversations sharing the same pattern_key, keeping the affected customer list", async () => {
    state.rows = [
      row({ wa_id: "w1", full_name: "Sara", agent_eval: JSON.stringify({
        opening_quality: "weak", opening_excerpt: "سجّل من هنا", opening_pattern_key: "premature_registration_push",
      }) }),
      row({ wa_id: "w2", full_name: "Omar", agent_eval: JSON.stringify({
        opening_quality: "weak", opening_excerpt: "سجّل الآن", opening_pattern_key: "premature_registration_push",
      }) }),
      row({ wa_id: "w3", full_name: "Lina", agent_eval: JSON.stringify({
        dropout_detected: true, dropout_point_excerpt: "طيب شكراً", dropout_pattern_key: "ignored_customer_question",
        smart_reply_example: "رد بديل",
      }) }),
    ];
    const res = await request(buildApp()).get("/report/employee/Ahmed/coaching");
    expect(res.status).toBe(200);
    expect(res.body.opening_patterns).toHaveLength(1);
    expect(res.body.opening_patterns[0]).toMatchObject({ pattern_key: "premature_registration_push", count: 2 });
    expect(res.body.opening_patterns[0].customers.map((c) => c.full_name)).toEqual(["Sara", "Omar"]);
    expect(res.body.opening_patterns[0].pattern_label).toBeTruthy();
    expect(res.body.dropout_patterns).toHaveLength(1);
    expect(res.body.dropout_patterns[0]).toMatchObject({ pattern_key: "ignored_customer_question", count: 1 });
    expect(res.body.dropout_patterns[0].smart_reply_examples).toEqual(["رد بديل"]);
  });

  it("excludes rows with no detected pattern (adequate opening, no dropout) from both lists", async () => {
    state.rows = [row({ agent_eval: JSON.stringify({ opening_quality: "strong", dropout_detected: false }) })];
    const res = await request(buildApp()).get("/report/employee/Ahmed/coaching");
    expect(res.body.opening_patterns).toEqual([]);
    expect(res.body.dropout_patterns).toEqual([]);
  });

  it("distinguishes measured (has the new schema keys) from not-yet-backfilled rows", async () => {
    state.rows = [
      row({ wa_id: "w1", agent_eval: JSON.stringify({ opening_quality: "strong" }) }), // measured, clean
      row({ wa_id: "w2", agent_eval: JSON.stringify({ improvements: ["x"] }) }),        // pre-feature row, unmeasured
    ];
    const res = await request(buildApp()).get("/report/employee/Ahmed/coaching");
    expect(res.body.total_conversations).toBe(2);
    expect(res.body.measured_conversations).toBe(1);
  });
});

describe("POST /report/employee/:agent/coaching-script", () => {
  const withPattern = () => [row({ wa_id: "w1", full_name: "Sara", agent_eval: JSON.stringify({
    opening_quality: "weak", opening_excerpt: "سجّل من هنا", opening_pattern_key: "premature_registration_push",
  }) })];

  it("prompts DeepSeek with the business rules and caches under coach:<agent>:<pattern>:<lang>", async () => {
    state.rows = withPattern();
    chatJSON.mockResolvedValue({ diagnosis: "...", smart_script: "...", discovery_questions: [] });
    const res = await request(buildApp()).post("/report/employee/Ahmed/coaching-script")
      .send({ pattern_key: "premature_registration_push", lang: "ar" });
    expect(res.status).toBe(200);
    expect(res.body.affected_count).toBe(1);
    const [system, user] = chatJSON.mock.calls[0];
    expect(system).toMatch(/الدورات التعليمية/);
    expect(user).toMatch(/سجّل من هنا/);
    expect(Object.keys(state.insights)).toEqual(["coach:Ahmed:premature_registration_push:ar"]);
  });

  it("returns 400 (never calls the AI) when the pattern has zero matching conversations", async () => {
    state.rows = withPattern();
    const res = await request(buildApp()).post("/report/employee/Ahmed/coaching-script")
      .send({ pattern_key: "slow_follow_up", lang: "ar" });
    expect(res.status).toBe(400);
    expect(chatJSON).not.toHaveBeenCalled();
  });

  it("GET coaching-script returns {generated:false} until generated, then the cached payload", async () => {
    const miss = await request(buildApp()).get("/report/employee/Ahmed/coaching-script?pattern_key=premature_registration_push&lang=ar");
    expect(miss.body.generated).toBe(false);

    state.insights["coach:Ahmed:premature_registration_push:ar"] = JSON.stringify({ pattern_key: "premature_registration_push", smart_script: "cached" });
    const hit = await request(buildApp()).get("/report/employee/Ahmed/coaching-script?pattern_key=premature_registration_push&lang=ar");
    expect(hit.body.generated).toBe(true);
    expect(hit.body.smart_script).toBe("cached");
  });
});

describe("GET /report/employee/:agent/pdf", () => {
  it("streams a PDF (correct content-type/disposition) built from the same rows the JSON report uses", async () => {
    state.rows = [row(), row({ wa_id: "w2", agent_score: 30 })];
    const res = await request(buildApp()).get("/report/employee/Ahmed/pdf?since=2026-06-01&until=2026-06-30");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="employee-report-Ahmed-/);
    expect(Buffer.from(res.body).toString().startsWith("%PDF-")).toBe(true);

    const [data] = buildReportHtml.mock.calls[0];
    expect(data.agent).toBe("Ahmed");
    expect(data.kpis.conversations).toBe(2);
    expect(data.period).toEqual({ since: "2026-06-01", until: "2026-06-30" });
  });

  it("includes cached AI notes in the language requested, and null when none are cached", async () => {
    state.rows = [row()];
    state.insights["emp:Ahmed:en"] = JSON.stringify({ summary: "cached-en-notes" });

    await request(buildApp()).get("/report/employee/Ahmed/pdf?lang=en");
    expect(buildReportHtml.mock.calls[0][0].notes).toEqual({ summary: "cached-en-notes" });

    buildReportHtml.mockClear();
    await request(buildApp()).get("/report/employee/Ahmed/pdf?lang=ar"); // no ar-language notes cached
    expect(buildReportHtml.mock.calls[0][0].notes).toBeNull();
  });

  it("passes opening/dropout pattern groups through to the HTML builder", async () => {
    state.rows = [row({ agent_eval: JSON.stringify({
      opening_quality: "weak", opening_excerpt: "سجّل من هنا", opening_pattern_key: "premature_registration_push",
    }) })];
    await request(buildApp()).get("/report/employee/Ahmed/pdf");
    const data = buildReportHtml.mock.calls[0][0];
    expect(data.opening_patterns).toHaveLength(1);
    expect(data.opening_patterns[0].pattern_key).toBe("premature_registration_push");
  });
});

describe("GET /report/conversation/:waId/transcript", () => {
  it("returns the stored thread snapshot without any live Wati call (BUG-018)", async () => {
    const t = [{ dir: "in", sender: "customer", body: "مرحباً", ts: "2026-07-01T10:00:00Z" }];
    state.transcripts.w1 = { thread_snapshot: JSON.stringify(t), analyzed_at: "2026-07-02T10:00:00Z" };
    const res = await request(buildApp()).get("/report/conversation/w1/transcript");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.messages).toEqual(t);
  });

  it("reports unavailable for a conversation never analyzed", async () => {
    const res = await request(buildApp()).get("/report/conversation/nope/transcript");
    expect(res.body).toEqual({ available: false });
  });

  it("reports unavailable (not an error) for a row analyzed before this feature shipped (null thread_snapshot)", async () => {
    state.transcripts.w2 = { thread_snapshot: null, analyzed_at: "2026-06-01T10:00:00Z" };
    const res = await request(buildApp()).get("/report/conversation/w2/transcript");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false });
  });
});
