// Phase B: comparison report builders + AI aggregation. The HTML builders are
// pure (no browser); the gatherers make ONE bilingual DeepSeek call, cache it,
// and whitelist-clamp the verdicts.
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = [];
const state = { curRows: [], prevRows: [], campaignRows: [], cache: {} };
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("from ads_ai_insights")) {
      const row = state.cache[params[0]];
      return row ? [{ data: row }] : [];
    }
    if (sql.startsWith("insert into ads_ai_insights")) { state.cache[params[0]] = params[1]; return {}; }
    // employeeRows: distinct agent variants, then the data query
    if (sql.includes("distinct contact_owner")) return [{ v: "Omar" }];
    if (sql.includes("distinct") && sql.includes("agent_name")) return [{ raw: "Omar" }];
    if (sql.includes("from ads_conversation_analysis a") && sql.includes("join ads_wati_contacts")) {
      // cur window uses the first since; distinguish by param date
      return params.includes("2026-07-13") ? state.curRows : state.prevRows;
    }
    if (sql.includes("from ads_meta_campaign_perf c")) return state.campaignRows;
    // cost-of-everything block (gatherCostBlock):
    if (sql.includes("from ads_meta_daily where level='campaign' and date between")) return [{ spend: 1000, impressions: 50000, reach: 30000, clicks: 800, results: 120 }];
    if (sql.includes("interested") && sql.includes("from ads_wati_contacts where created_date between")) return [{ interested: 40 }];
    // analyticsReports (country + hierarchy) queries, gathered for the PDF:
    if (sql.includes("phone, stage, deposit_flag, source_ad_id")) return state.countryContacts;
    if (sql.includes("select ad_id, campaign_name from ads_meta_ad_perf")) return [];
    if (sql.includes("from ads_meta_country_daily")) return [];
    if (sql.includes("ad_id, ad_name, adset_id, adset_name")) return state.treeAds;
    if (sql.includes("where level='ad'")) return [];
    if (sql.includes("count(*) contacts") && sql.includes("group by source_ad_id")) return [];
    return {};
  }),
}));

const chatJSON = vi.fn();
vi.mock("../src/lib/deepseek.js", () => ({ hasKey: () => true, chatJSON: (...a) => chatJSON(...a) }));
// contactStatus is exercised in its own test; here stub it so the campaign
// gather's employee-contact rollup doesn't need the full query plumbing.
vi.mock("../src/lib/contactStatus.js", () => ({
  gatherContactStatus: vi.fn(async () => ({ leads: [] })),
  rollup: vi.fn(() => []),
}));
vi.mock("../src/config.js", () => ({ default: { cronTimezone: "Asia/Dubai", deepseek: {}, meta: { apiVersion: "v21.0", accountId: "555" } } }));
vi.mock("../src/lib/metaAuth.js", () => ({ getToken: vi.fn(async () => "t") }));

const { buildEmployeeWeeklyHtml } = await import("../src/lib/pdfReport.js");
const { buildCampaignReportHtml } = await import("../src/lib/campaignReport.js");
const wr = await import("../src/lib/weeklyReports.js");

beforeEach(() => { calls.length = 0; state.curRows = []; state.prevRows = []; state.campaignRows = []; state.cache = {}; state.countryContacts = []; state.treeAds = []; chatJSON.mockReset(); });

describe("week windows (Dubai)", () => {
  it("computes Mon-Sun cur + prior week from a Monday run", () => {
    // 2026-07-20 is a Monday. cur = Mon 13th .. Sun 19th; prev = Mon 6th .. Sun 12th.
    const w = wr.weekWindows(new Date("2026-07-20T00:30:00+04:00"));
    expect(w.cur).toEqual({ since: "2026-07-13", until: "2026-07-19" });
    expect(w.prev).toEqual({ since: "2026-07-06", until: "2026-07-12" });
  });
  it("dubaiDow returns 1 (Monday) for that run", () => {
    expect(wr.dubaiDow(new Date("2026-07-20T00:30:00+04:00"))).toBe(1);
  });
});

describe("buildEmployeeWeeklyHtml", () => {
  const base = {
    agent: "Omar", lang: "ar", period: { since: "2026-07-13", until: "2026-07-19" },
    prevPeriod: { since: "2026-07-06", until: "2026-07-12" }, generatedAt: new Date("2026-07-20T00:00:00Z"),
    cur: { kpis: { conversations: 20, avg_agent_score: 72, avg_conv_score: 68, wrong_persuasion: 1, intents: { hot: 5, warm: 8, cold: 7 } } },
    prev: { kpis: { conversations: 12, avg_agent_score: 60, avg_conv_score: 55, wrong_persuasion: 4, intents: { hot: 2, warm: 4, cold: 6 } } },
    opening_patterns: [], dropout_patterns: [], conversations: [],
    ai: { verdict: "improved", narrative: "أداء أفضل", tips: ["ركّز على الأسئلة"], mistakes: ["لا تقفز للتسجيل"] },
  };
  it("renders a self-contained doc with the comparison + verdict", () => {
    const html = buildEmployeeWeeklyHtml(base);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("data:font/woff2;base64,");
    expect(html).toContain("Omar");
    expect(html).toContain("تحسّن"); // improved verdict label
    expect(html).toContain("ركّز على الأسئلة"); // tip rendered
  });
  it("shows the no-AI fallback when ai is null (report still builds)", () => {
    const html = buildEmployeeWeeklyHtml({ ...base, ai: null });
    expect(html).toContain("لم يتوفّر تحليل AI");
  });
  it("renders the English variant with LTR dir", () => {
    const html = buildEmployeeWeeklyHtml({ ...base, lang: "en", ai: { verdict: "declined", narrative: "worse", tips: [], mistakes: [] } });
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("Declined");
  });
});

describe("buildCampaignReportHtml", () => {
  it("renders active campaigns with verdict colors + totals", () => {
    const html = buildCampaignReportHtml({
      lang: "ar", cadence: "weekly", period: { since: "2026-07-13", until: "2026-07-19" }, generatedAt: new Date(),
      totals: { active: 2, spend: 5000, results: 120 },
      metrics: { spend: 5000, reach: 30000, impressions: 50000, clicks: 800, conversations: 120, interested: 40,
        cost_per_conversation: 41.7, cost_per_interested: 125, cost_per_click: 6.25, cost_per_1k_impressions: 100 },
      campaigns: [
        { campaign_id: "c1", campaign_name: "Gold", spend: 3000, results: 100, cpr: 30, prev_results: 80, verdict: "keep", adjustment: "زد الميزانية", warning: "" },
        { campaign_id: "c2", campaign_name: "Weak", spend: 2000, results: 20, cpr: 100, prev_results: 60, verdict: "close", adjustment: "", warning: "التكلفة مرتفعة" },
      ],
      tree: [{ campaign_id: "c1", name: "Gold", metrics: { spend_aed: 3000, results: 100, contacts: 200, qualified: 30 },
        adsets: [{ adset_id: "s1", name: "Set A", metrics: { spend_aed: 3000, results: 100, contacts: 200, qualified: 30 },
          ads: [{ ad_id: "a1", name: "Ad One", status: "ACTIVE", metrics: { spend_aed: 3000, results: 100, contacts: 200, qualified: 30 } }] }] }],
      countries: { rows: [{ iso2: "SA", ar: "السعودية", en: "Saudi Arabia", flag: "🇸🇦", contacts: 120, contacted: 90, qualified: 8, qual_rate_pct: 6.7, spend_aed: 300, cost_per_lead: 2.5, verdict: "keep" }] },
      employeeContacts: [{ key: "Omar Sadka", leads: 40, contacted: 30, not_contacted: 10, after_hours: 6, negligence: 4, contact_rate_pct: 75, cost_contacted: 300, cost_not_contacted: 100 }],
    });
    expect(html).toContain("Gold");
    expect(html).toContain("أبقِ");   // keep
    expect(html).toContain("أغلِق");  // close
    expect(html).toContain("زد الميزانية");
    // hierarchy + country sections rendered
    expect(html).toContain("Set A");
    expect(html).toContain("Ad One");
    expect(html).toContain("السعودية");
    expect(html).toContain("🇸🇦");
    // cost-of-everything block + cadence label
    expect(html).toContain("تكلفة كل شيء");
    expect(html).toContain("أسبوعي");
    // staff-contact table + country human-contacted column
    expect(html).toContain("تواصل الموظفين مع العملاء");
    expect(html).toContain("Omar Sadka");
    expect(html).toContain("تواصل بشري");
  });
});

describe("campaign windows + gatherCampaignReport", () => {
  it("monthWindows returns the last completed calendar month vs the one before", () => {
    const w = wr.monthWindows(new Date("2026-08-01T00:30:00+04:00"));
    expect(w.cur).toEqual({ since: "2026-07-01", until: "2026-07-31" });
    expect(w.prev).toEqual({ since: "2026-06-01", until: "2026-06-30" });
    expect(w.key).toBe("2026-07");
  });
  it("dailyWindows returns yesterday vs the day before", () => {
    const w = wr.dailyWindows(new Date("2026-07-21T00:30:00+04:00"));
    expect(w.cur).toEqual({ since: "2026-07-20", until: "2026-07-20" });
    expect(w.prev).toEqual({ since: "2026-07-19", until: "2026-07-19" });
  });
  it("gatherCampaignReport attaches the cost-of-everything metrics block", async () => {
    state.campaignRows = [];
    const g = await wr.gatherCampaignReport({ cadence: "monthly", now: new Date("2026-08-01T00:30:00+04:00") });
    expect(g.cadence).toBe("monthly");
    expect(g.metrics).toMatchObject({ spend: 1000, reach: 30000, conversations: 120, interested: 40 });
    expect(g.metrics.cost_per_interested).toBe(25); // 1000/40
    expect(g.metrics.new_followers).toBeNull();
  });
});

describe("gatherEmployeeWeekly", () => {
  const now = new Date("2026-07-20T00:30:00+04:00");
  it("makes ONE bilingual AI call, clamps a bad verdict, and caches the result", async () => {
    state.curRows = [{ wa_id: "1", full_name: "A", phone: "9", last_message_at: "2026-07-15", agent_score: 70, conv_score: 65, lead_intent: "hot", lead_status: "qualified", wrong_persuasion: 0, agent_eval: "{}" }];
    state.prevRows = [];
    chatJSON.mockResolvedValue({ ar: { verdict: "BOGUS", narrative: "n", tips: ["a"], mistakes: [] }, en: { verdict: "improved", narrative: "n", tips: [], mistakes: [] } });
    const g = await wr.gatherEmployeeWeekly("Omar", { now });
    expect(chatJSON).toHaveBeenCalledOnce();
    expect(g.ai.ar.verdict).toBe("steady"); // BOGUS clamped
    expect(g.ai.en.verdict).toBe("improved");
    // cached: a second call hits cache, no new AI call
    chatJSON.mockClear();
    await wr.gatherEmployeeWeekly("Omar", { now });
    expect(chatJSON).not.toHaveBeenCalled();
  });
});

describe("gatherCampaignDaily", () => {
  const now = new Date("2026-07-20T00:30:00+04:00");
  it("clamps campaign verdicts and shapes per-language data", async () => {
    state.campaignRows = [{ campaign_id: "c1", campaign_name: "Gold", spend: 3000, results: 100, prev_spend: 2000, prev_results: 80 }];
    chatJSON.mockResolvedValue({ campaigns: [{ campaign_id: "c1", verdict: "explode", adjustment_ar: "عدّل", adjustment_en: "adjust", warning_ar: "", warning_en: "" }] });
    const g = await wr.gatherCampaignDaily({ now });
    expect(g.ai.c1.verdict).toBe("watch"); // clamped
    const data = wr.campaignReportData(g, "en");
    expect(data.campaigns[0].verdict).toBe("watch");
    expect(data.campaigns[0].adjustment).toBe("adjust");
    expect(data.totals.active).toBe(1);
  });
});
