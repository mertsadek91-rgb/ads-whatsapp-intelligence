// BUG-005 coverage — routes/analytics.js powers every dashboard number but
// had zero direct tests. Covers: date-range validation/threading, the
// summary's derived cost-per-qualified math, ads-route filters, entity-daily
// level whitelisting, and the daily/weekly date fragments.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const calls = [];
const state = { rows: [], compareBuckets: [], bestDay: [], ranking: [], owners: [], insights: {}, posts: [], needs: [], captions: [], postMetrics: [], postEvals: [], savedEvals: [], countryContacts: [], countrySpend: [], adCampaigns: [], treeAds: [], treeDaily: [], treeWati: [], employeesCountries: [] };
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("c.phone, c.stage, c.deposit_flag, c.source_ad_id")) return state.countryContacts;
    if (sql.includes("select ad_id, campaign_name from ads_meta_ad_perf")) return state.adCampaigns;
    if (sql.includes("from ads_meta_country_daily")) return state.countrySpend;
    if (sql.includes("countries from ads_employees")) return state.employeesCountries;
    if (sql.includes("ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, status")) return state.treeAds;
    if (sql.includes("where level='ad'")) return state.treeDaily;
    if (sql.includes("count(*) contacts") && sql.includes("group by source_ad_id")) return state.treeWati;
    if (sql.includes("'cur' else 'prev'")) return state.compareBuckets;
    if (sql.includes("from ads_v_daily") && sql.includes("order by qualified desc, contacts desc limit 1")) return state.bestDay;
    if (sql.includes("distinct contact_owner v")) return state.owners.map((v) => ({ v }));
    if (sql.includes("from ads_conversation_analysis a") && sql.includes("last_message_at >= (curdate()")) return state.ranking;
    if (sql.startsWith("select data, generated_at from ads_ai_insights")) {
      const row = state.insights[params[0]];
      return row ? [{ data: row, generated_at: "2026-07-08T10:00:00Z" }] : [];
    }
    if (sql.startsWith("insert into ads_ai_insights")) { state.insights[params[0]] = params[1]; return {}; }
    if (sql.includes("group by w.source_url order by qualified desc")) return state.posts;
    if (sql.includes("p.creative_body") && sql.includes("select distinct")) return state.captions;
    if (sql.includes("a.customer_details")) return state.needs;
    if (sql.includes("from (select distinct source_url, source_ad_id")) return state.postMetrics;
    if (sql.includes("from ads_post_insights")) return state.postEvals;
    if (sql.startsWith("insert into ads_post_insights")) { state.savedEvals.push(params); return {}; }
    if (sql.includes("coalesce(sum(spend_aed),0)")) {
      return [{ spend: 1000, convos: 50, contacts: 200, attributed: 150, qualified: 20 }];
    }
    if (sql.includes("from ads_lead_review where account_type='real'")) {
      return [{ real_accounts: 3, depositors: 2, deposit_total: 5000 }];
    }
    return state.rows;
  }),
}));

const chatJSON = vi.fn();
vi.mock("../src/lib/deepseek.js", () => ({
  hasKey: () => true,
  chatJSON: (...a) => chatJSON(...a),
}));

// analytics.js reads config.meta.accountId to build Meta Ads Manager deep
// links; meta.js (imported for adsManagerUrl) reads apiVersion at load.
vi.mock("../src/config.js", () => ({
  default: { meta: { apiVersion: "v21.0", accountId: "555" } },
}));
vi.mock("../src/lib/metaAuth.js", () => ({ getToken: vi.fn(async () => "t") }));

const analyticsRouter = (await import("../src/routes/analytics.js")).default;

function buildApp() {
  const app = express();
  app.use("/analytics", analyticsRouter);
  return app;
}

beforeEach(() => {
  calls.length = 0; state.rows = []; state.compareBuckets = []; state.bestDay = [];
  state.ranking = []; state.owners = []; state.insights = {}; state.posts = []; state.needs = [];
  state.captions = []; state.postMetrics = []; state.postEvals = []; state.savedEvals = [];
  state.countryContacts = []; state.countrySpend = []; state.adCampaigns = [];
  state.treeAds = []; state.treeDaily = []; state.treeWati = []; state.employeesCountries = [];
  chatJSON.mockReset();
});

describe("GET /analytics/summary", () => {
  it("computes cost per qualified and per depositor from the raw counts", async () => {
    const res = await request(buildApp()).get("/analytics/summary");
    expect(res.status).toBe(200);
    expect(res.body.cost_per_qualified).toBe(50);   // 1000 / 20
    expect(res.body.cost_per_depositor).toBe(500);  // 1000 / 2
    expect(res.body.depositors).toBe(2);
  });

  it("threads a valid date range into the contact subqueries (3 param groups)", async () => {
    await request(buildApp()).get("/analytics/summary?since=2026-06-01&until=2026-06-30");
    const call = calls.find((c) => c.sql.includes("coalesce(sum(spend_aed),0)"));
    expect(call.sql).toMatch(/created_date >= \?/);
    expect(call.params).toEqual(["2026-06-01", "2026-06-30", "2026-06-01", "2026-06-30", "2026-06-01", "2026-06-30"]);
  });

  it("rejects malformed dates by ignoring them (no injection into SQL)", async () => {
    await request(buildApp()).get("/analytics/summary?since=1;DROP TABLE x");
    const call = calls.find((c) => c.sql.includes("coalesce(sum(spend_aed),0)"));
    expect(call.sql).not.toMatch(/DROP/);
    expect(call.params).toEqual([]);
  });
});

describe("GET /analytics/ads", () => {
  it("applies status/q/minQualified filters as HAVING params after the join-date params", async () => {
    await request(buildApp()).get("/analytics/ads?since=2026-06-01&status=ACTIVE&q=gold&minQualified=5");
    const call = calls.find((c) => c.sql.includes("from ads_meta_ad_perf p"));
    expect(call.sql).toMatch(/having p\.status = \? and p\.ad_name like \? and qualified >= \?/);
    expect(call.params).toEqual(["2026-06-01", "ACTIVE", "%gold%", 5]);
  });

  it("omits the HAVING clause entirely when no filters are set", async () => {
    await request(buildApp()).get("/analytics/ads");
    const call = calls.find((c) => c.sql.includes("from ads_meta_ad_perf p"));
    expect(call.sql).not.toMatch(/having/);
  });

  it("returns ad/campaign/adset ids and a Meta Ads Manager deep link per row", async () => {
    state.rows = [{ ad_id: "a1", campaign_id: "c1", adset_id: "s1", ad_name: "Gold" }];
    const res = await request(buildApp()).get("/analytics/ads");
    const call = calls.find((c) => c.sql.includes("from ads_meta_ad_perf p"));
    expect(call.sql).toMatch(/p\.ad_id, p\.campaign_id, p\.adset_id/);
    expect(res.body[0]).toMatchObject({ ad_id: "a1", campaign_id: "c1", adset_id: "s1" });
    expect(res.body[0].manage_url).toBe(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?act=555&selected_ad_ids=a1");
  });
});

describe("GET /analytics/countries", () => {
  it("groups leads by phone-derived country, counts interested, and attributes campaigns", async () => {
    state.countryContacts = [
      { phone: "966500000001", stage: "qualified", deposit_flag: 1, source_ad_id: "a1", human_contacted: 1 },
      { phone: "966500000002", stage: "new", deposit_flag: 0, source_ad_id: "a1", human_contacted: 0 },
      { phone: "201000000003", stage: "interested", deposit_flag: 0, source_ad_id: "a2", human_contacted: 1 },
    ];
    state.adCampaigns = [{ ad_id: "a1", campaign_name: "KSA Camp" }, { ad_id: "a2", campaign_name: "EG Camp" }];
    const res = await request(buildApp()).get("/analytics/countries");
    expect(res.status).toBe(200);
    const sa = res.body.rows.find((r) => r.iso2 === "SA");
    expect(sa).toMatchObject({ contacts: 2, contacted: 1, qualified: 1, deposits: 1, flag: "🇸🇦" });
    expect(sa.top_campaigns[0]).toEqual({ name: "KSA Camp", n: 2 });
    expect(res.body.totals.contacts).toBe(3);
    expect(res.body.totals.qualified).toBe(2); // qualified + interested both count
  });

  it("merges Meta spend-by-country and derives cost-per-lead; flags no-spend", async () => {
    state.countryContacts = Array.from({ length: 20 }, () => ({ phone: "966500000000", stage: "qualified", deposit_flag: 0, source_ad_id: "a1" }));
    state.adCampaigns = [{ ad_id: "a1", campaign_name: "KSA" }];
    state.countrySpend = [{ country: "SA", spend: 400 }];
    const res = await request(buildApp()).get("/analytics/countries");
    const sa = res.body.rows.find((r) => r.iso2 === "SA");
    expect(sa.spend_aed).toBe(400);
    expect(sa.cost_per_lead).toBe(20); // 400 / 20
    expect(res.body.totals.has_spend).toBe(true);
  });

  it("puts unmatched phones in an Unknown bucket instead of guessing", async () => {
    state.countryContacts = [{ phone: "", stage: "new", deposit_flag: 0, source_ad_id: null }];
    const res = await request(buildApp()).get("/analytics/countries");
    expect(res.body.rows[0].iso2).toBeNull();
    expect(res.body.rows[0].ar).toBe("غير محدَّد");
  });

  it("attaches the employees who work each country (from the directory)", async () => {
    state.countryContacts = [{ phone: "966500000001", stage: "new", deposit_flag: 0, source_ad_id: null }];
    state.employeesCountries = [
      { name: "Omar", countries: JSON.stringify(["SA", "EG"]) },
      { name: "Sara", countries: ["SA"] },
    ];
    const res = await request(buildApp()).get("/analytics/countries");
    const sa = res.body.rows.find((r) => r.iso2 === "SA");
    expect(sa.employees).toEqual(["Omar", "Sara"]);
  });
});

describe("GET /analytics/campaign-tree", () => {
  it("nests ads under ad sets under campaigns and rolls metrics up each level", async () => {
    state.treeAds = [
      { ad_id: "a1", ad_name: "Ad1", adset_id: "s1", adset_name: "Set1", campaign_id: "c1", campaign_name: "Camp1", status: "ACTIVE" },
      { ad_id: "a2", ad_name: "Ad2", adset_id: "s1", adset_name: "Set1", campaign_id: "c1", campaign_name: "Camp1", status: "PAUSED" },
    ];
    state.treeDaily = [
      { entity_id: "a1", spend: 100, results: 10, impressions: 1000, clicks: 20 },
      { entity_id: "a2", spend: 50, results: 4, impressions: 500, clicks: 8 },
    ];
    state.treeWati = [
      { source_ad_id: "a1", contacts: 30, qualified: 5 },
      { source_ad_id: "a2", contacts: 12, qualified: 1 },
    ];
    const res = await request(buildApp()).get("/analytics/campaign-tree");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const c = res.body[0];
    expect(c.metrics).toMatchObject({ spend_aed: 150, results: 14, contacts: 42, qualified: 6 });
    expect(c.adsets).toHaveLength(1);
    expect(c.adsets[0].metrics).toMatchObject({ spend_aed: 150, contacts: 42 });
    expect(c.adsets[0].ads).toHaveLength(2);
    expect(c.adsets[0].ads[0]).toMatchObject({ ad_id: "a1", status: "ACTIVE" });
    expect(c.manage_url).toContain("selected_campaign_ids=c1");
    expect(c.adsets[0].ads[0].manage_url).toContain("selected_ad_ids=a1");
  });

  it("returns an empty array when there are no ads", async () => {
    const res = await request(buildApp()).get("/analytics/campaign-tree");
    expect(res.body).toEqual([]);
  });
});

describe("GET /analytics/entity-daily", () => {
  it("whitelists the level (garbage falls back to 'ad') and requires an id", async () => {
    const missing = await request(buildApp()).get("/analytics/entity-daily");
    expect(missing.status).toBe(400);

    await request(buildApp()).get("/analytics/entity-daily?level='; DROP--&id=x1");
    const call = calls.find((c) => c.sql.includes("from ads_meta_daily"));
    expect(call.params[0]).toBe("ad"); // not the injected garbage
    expect(call.params[1]).toBe("x1");
  });

  it("accepts the three valid levels", async () => {
    for (const level of ["ad", "adset", "campaign"]) {
      calls.length = 0;
      await request(buildApp()).get(`/analytics/entity-daily?level=${level}&id=x1`);
      expect(calls.find((c) => c.sql.includes("from ads_meta_daily")).params[0]).toBe(level);
    }
  });
});

describe("GET /analytics/daily + /weekly + /agents", () => {
  it("daily filters on the view's day column", async () => {
    await request(buildApp()).get("/analytics/daily?since=2026-06-01");
    const call = calls.find((c) => c.sql.includes("from ads_v_daily"));
    expect(call.sql).toMatch(/day >= \?/);
    expect(call.params).toEqual(["2026-06-01"]);
  });

  it("weekly groups by week start and respects the range", async () => {
    await request(buildApp()).get("/analytics/weekly?until=2026-06-30");
    const call = calls.find((c) => c.sql.includes("weekday(created_date)"));
    expect(call.sql).toMatch(/created_date <= \?/);
    expect(call.params).toEqual(["2026-06-30"]);
  });

  it("agents buckets unassigned owners under a single label", async () => {
    await request(buildApp()).get("/analytics/agents");
    const call = calls.find((c) => c.sql.includes("qual_rate_pct"));
    expect(call.sql).toMatch(/coalesce\(nullif\(contact_owner,''\),'\(غير مُسند\)'\)/);
  });
});

describe("GET /analytics/compare", () => {
  it("computes derived cost metrics and % changes between the two windows", async () => {
    state.compareBuckets = [
      { bucket: "cur", spend: 1200, contacts: 300, qualified: 30 },
      { bucket: "prev", spend: 1000, contacts: 250, qualified: 40 },
    ];
    state.bestDay = [{ day: "2026-07-05", contacts: 40, qualified: 8 }];
    const res = await request(buildApp()).get("/analytics/compare?period=week");
    expect(res.status).toBe(200);
    expect(res.body.period).toBe("week");
    expect(res.body.days).toBe(7);
    expect(res.body.current.cost_per_contact).toBe(4);      // 1200/300
    expect(res.body.current.cost_per_qualified).toBe(40);   // 1200/30
    expect(res.body.previous.cost_per_qualified).toBe(25);  // 1000/40
    expect(res.body.change.spend_pct).toBe(20);             // (1200-1000)/1000
    expect(res.body.change.contacts_pct).toBe(20);
    expect(res.body.change.qualified_pct).toBe(-25);        // 30 vs 40
    expect(res.body.change.cost_per_qualified_pct).toBe(60); // 40 vs 25
    expect(res.body.current.best_day).toEqual({ day: "2026-07-05", contacts: 40, qualified: 8 });
  });

  it("passes the right day windows to SQL (7 for week, 30 default, 365 for year) and rejects garbage periods", async () => {
    await request(buildApp()).get("/analytics/compare?period=week");
    expect(calls.find((c) => c.sql.includes("'cur' else 'prev'")).params).toEqual([6, 13]);
    calls.length = 0;
    await request(buildApp()).get("/analytics/compare?period='; DROP--");
    const call = calls.find((c) => c.sql.includes("'cur' else 'prev'"));
    expect(call.params).toEqual([29, 59]); // falls back to month, never interpolates the input
  });

  it("returns null % change (not division-by-zero garbage) when the previous window is empty", async () => {
    state.compareBuckets = [{ bucket: "cur", spend: 500, contacts: 100, qualified: 10 }];
    const res = await request(buildApp()).get("/analytics/compare");
    expect(res.body.previous.spend).toBe(0);
    expect(res.body.change.spend_pct).toBeNull();
    expect(res.body.change.cost_per_qualified_pct).toBeNull();
    expect(res.body.current.best_day).toBeNull();
  });
});

describe("GET /analytics/posts — filters and per-post ad metrics", () => {
  it("applies country/campaign/adset/platform filters to the WHERE clause", async () => {
    state.rows = [];
    await request(buildApp()).get("/analytics/posts?country=السعودية&campaignId=c1&adsetId=s1&platform=instagram");
    const call = calls.find((c) => c.sql.includes("group by w.source_url") && c.sql.includes("post_url"));
    expect(call.sql).toMatch(/w\.country = \?/);
    expect(call.sql).toMatch(/p\.campaign_id = \?/);
    expect(call.sql).toMatch(/p\.adset_id = \?/);
    expect(call.sql).toMatch(/instagram\.com/);
    expect(call.params).toEqual(expect.arrayContaining(["السعودية", "c1", "s1"]));
  });

  it("merges distinct-ad delivery metrics per post (no contact-row multiplication)", async () => {
    state.rows = [{ post_url: "u1", sample_ad: "x", ad_count: 2, contacts: 50, qualified: 5, deposits: 0, qual_rate_pct: 10 }];
    state.postMetrics = [{ post_url: "u1", impressions: 400000, reach: 150000, clicks: 900, spend_aed: 1200, frequency: 2.6, ctr_pct: 0.23 }];
    const res = await request(buildApp()).get("/analytics/posts");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ impressions: 400000, reach: 150000, frequency: 2.6, ctr_pct: 0.23 });
    // the metrics query must aggregate over DISTINCT (post, ad) pairs
    const mCall = calls.find((c) => c.sql.includes("select distinct source_url, source_ad_id"));
    expect(mCall).toBeTruthy();
  });

  it("derives ad_status (any ACTIVE ad -> active, else paused, unknown -> null) and passes media_type through", async () => {
    state.rows = [
      { post_url: "u1", media_type: "video", has_active: 1, has_status: 1 },
      { post_url: "u2", media_type: "image", has_active: 0, has_status: 1 },
      { post_url: "u3", media_type: null, has_active: 0, has_status: 0 },
    ];
    const res = await request(buildApp()).get("/analytics/posts");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ media_type: "video", ad_status: "active" });
    expect(res.body[1].ad_status).toBe("paused");
    expect(res.body[2].ad_status).toBeNull();
    // the raw flag columns must not leak into the API response
    expect(res.body[0].has_active).toBeUndefined();
    expect(res.body[0].has_status).toBeUndefined();
  });
});

describe("GET /analytics/employee-ranking", () => {
  const row = (agent, over = {}) => ({ agent, agent_score: 60, lead_intent: "warm", wrong_persuasion: 0, ...over });

  it("ranks by results (hot+warm), excludes Bot/unknown, and applies the min-N winner gate", async () => {
    state.owners = ["Ahmed", "Sara"];
    state.ranking = [
      // Sara: 6 conversations, 4 results
      ...Array.from({ length: 4 }, () => row("Sara")),
      row("Sara", { lead_intent: "cold" }), row("Sara", { lead_intent: "cold" }),
      // Ahmed: 2 conversations, 2 hot results — better ratio but below MIN_N
      row("Ahmed", { lead_intent: "hot", agent_score: 90 }), row("Ahmed", { lead_intent: "hot", agent_score: 90 }),
      // noise that must be excluded entirely
      row("Bot"), row("غير معروف"),
    ];
    const res = await request(buildApp()).get("/analytics/employee-ranking?period=week");
    expect(res.status).toBe(200);
    expect(res.body.min_n).toBe(5);
    const agents = res.body.ranking.map((a) => a.agent);
    expect(agents).toEqual(["Sara", "Ahmed"]); // Bot/unknown gone
    // Sara wins: Ahmed has more results-per-conversation but only 2 convs (< min_n 5)
    expect(res.body.winner.agent).toBe("Sara");
    expect(res.body.winner.results).toBe(4);
  });

  it("returns a null winner (not a tiny-sample 'winner') when nobody meets min-N", async () => {
    state.owners = ["Ahmed"];
    state.ranking = [row("Ahmed", { lead_intent: "hot" })];
    const res = await request(buildApp()).get("/analytics/employee-ranking?period=month");
    expect(res.body.min_n).toBe(10);
    expect(res.body.winner).toBeNull();
    expect(res.body.ranking).toHaveLength(1); // still listed, just can't win
  });
});

describe("GET/POST /analytics/post-insights", () => {
  it("GET returns {generated:false} before any generation, then the cached payload per language", async () => {
    const miss = await request(buildApp()).get("/analytics/post-insights?lang=ar");
    expect(miss.body.generated).toBe(false);
    state.insights["posts:ar"] = JSON.stringify({ posts: [{ post_url: "u1", why_it_worked: "cached" }], overall: [] });
    const hit = await request(buildApp()).get("/analytics/post-insights?lang=ar");
    expect(hit.body.generated).toBe(true);
    expect(hit.body.posts[0].why_it_worked).toBe("cached");
  });

  it("POST runs two phases: derives the success playbook, then judges EVERY post against it and persists verdicts", async () => {
    state.posts = [
      { post_url: "https://instagram.com/p/x/", sample_ad: "الوعود بالأرباح السريعة", contacts: 100, qualified: 12, qual_rate_pct: 12 },
      { post_url: "https://instagram.com/p/y/", sample_ad: "بونص", contacts: 200, qualified: 0, qual_rate_pct: 0 },
    ];
    state.captions = [{ post_url: "https://instagram.com/p/x/", creative_body: "احذر من الوعود بالأرباح المضمونة — التداول ينطوي على مخاطر حقيقية" }];
    state.needs = [{ post_url: "https://instagram.com/p/x/", customer_details: JSON.stringify({ needs: "يريد تعلم التداول من الصفر" }) }];
    chatJSON
      .mockResolvedValueOnce({ overall: ["التعليم المجاني يجذب مؤهلين"] }) // phase 1: playbook
      .mockResolvedValueOnce({ posts: [ // phase 2: judgments
        { post_url: "https://instagram.com/p/x/", verdict: "successful", score: 85, why: "...", improve: "..." },
        { post_url: "https://instagram.com/p/y/", verdict: "hallucinated-verdict", score: 999, why: "...", improve: "..." },
      ] });

    const res = await request(buildApp()).post("/analytics/post-insights").send({ lang: "ar" });
    expect(res.status).toBe(200);
    expect(res.body.evaluated).toBe(2);

    // Phase 1 prompt: real caption present + honesty guards (the exact live
    // incident: a label saying "profit promises" on a post whose actual text
    // WARNS AGAINST profit promises).
    const [lessonsSystem, lessonsUser] = chatJSON.mock.calls[0];
    expect(lessonsSystem).toMatch(/لا تختلق تفاصيل بصرية/);
    expect(lessonsSystem).toMatch(/تسمية داخلية.*وليست محتوى|ليست محتوى/);
    expect(lessonsUser).toContain("احذر من الوعود بالأرباح المضمونة");
    expect(Object.keys(state.insights)).toEqual(["posts:ar"]);

    // Phase 2 prompt carries the derived playbook so weak ads are judged
    // against the winning formula.
    const [judgeSystem] = chatJSON.mock.calls[1];
    expect(judgeSystem).toContain("التعليم المجاني يجذب مؤهلين");

    // Persisted per post per language; off-schema verdict clamped to average,
    // score clamped into 0-100.
    expect(state.savedEvals).toHaveLength(2);
    expect(state.savedEvals[0].slice(0, 4)).toEqual(["https://instagram.com/p/x/", "ar", "successful", 85]);
    expect(state.savedEvals[1][2]).toBe("average");
    expect(state.savedEvals[1][3]).toBe(100);
  });

  it("GET /posts merges the stored verdict/why/improve onto each row for the requested language", async () => {
    state.rows = [{ post_url: "u1", sample_ad: "x", ad_count: 1, contacts: 50, qualified: 5, deposits: 0, qual_rate_pct: 10 }];
    state.postEvals = [{ post_url: "u1", verdict: "unsuccessful", score: 30, why: "قصّر لأنه...", improve: "أضف..." }];
    const res = await request(buildApp()).get("/analytics/posts?lang=ar");
    expect(res.body[0]).toMatchObject({ verdict: "unsuccessful", ai_score: 30, ai_why: "قصّر لأنه...", ai_improve: "أضف..." });
  });

  it("POST returns 400 without calling the AI when there are no posts", async () => {
    const res = await request(buildApp()).post("/analytics/post-insights").send({});
    expect(res.status).toBe(400);
    expect(chatJSON).not.toHaveBeenCalled();
  });
});

describe("GET /analytics/filters", () => {
  it("returns flattened country/owner lists", async () => {
    state.rows = [{ c: "السعودية", o: "Ahmed" }];
    const res = await request(buildApp()).get("/analytics/filters");
    expect(res.status).toBe(200);
    expect(res.body.countries).toEqual(["السعودية"]);
    expect(res.body.owners).toEqual(["Ahmed"]);
  });
});
