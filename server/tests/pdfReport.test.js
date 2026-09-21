// lib/pdfReport.js: buildReportHtml() is a pure function (the bulk of the
// testable logic — escaping, i18n, conditional sections, chart math) kept
// deliberately separate from htmlToPdf()'s real-browser driving so it's
// fully testable without launching Chromium. htmlToPdf itself is tested
// against a mocked puppeteer-core — the real Chromium/Docker path is
// verified live, not here (see the batch-9-style live verification notes).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildReportHtml, buildEmployeeWeeklyHtml, buildEmployeeMonthlyHtml, resolveExecutablePath } from "../src/lib/pdfReport.js";

// vi.mock is hoisted above all imports, so the mock fns it references must
// come from vi.hoisted() rather than plain consts declared later in the file.
const puppeteerMocks = vi.hoisted(() => {
  // Real Puppeteer (v22+) returns a plain Uint8Array from page.pdf(), NOT a
  // Node Buffer — mocking it as a Buffer here would hide exactly the bug
  // this suite exists to catch (a real incident: Express's res.send()
  // doesn't recognize a bare Uint8Array as binary and silently JSON-encodes
  // every byte instead, producing a "PDF" that's actually corrupted text).
  const pdfMock = vi.fn(async () => new TextEncoder().encode("%PDF-fake\n%%EOF"));
  const setContentMock = vi.fn(async () => {});
  const closeMock = vi.fn(async () => {});
  const newPageMock = vi.fn(async () => ({ setContent: setContentMock, pdf: pdfMock, close: closeMock }));
  const browserCloseMock = vi.fn(async () => {});
  const launchMock = vi.fn(async () => ({ newPage: newPageMock, close: browserCloseMock }));
  return { pdfMock, setContentMock, closeMock, newPageMock, browserCloseMock, launchMock };
});
vi.mock("puppeteer-core", () => ({ launch: (...a) => puppeteerMocks.launchMock(...a) }));

function baseData(over = {}) {
  return {
    agent: "Ahmed", lang: "ar", period: { since: "2026-06-01", until: "2026-06-30" }, generatedAt: "2026-07-07T10:00:00Z",
    kpis: { conversations: 12, avg_agent_score: 72, avg_conv_score: 65, avg_follow_up_min: 8.4, wrong_persuasion: 1,
      intents: { hot: 3, warm: 5, cold: 4 } },
    opening_patterns: [], dropout_patterns: [], measured_conversations: 12, total_conversations: 12,
    notes: null, conversations: [],
    ...over,
  };
}

describe("buildReportHtml — structure & i18n", () => {
  it("renders RTL Arabic by default and LTR English when lang=en", () => {
    const ar = buildReportHtml(baseData());
    expect(ar).toMatch(/<html dir="rtl" lang="ar">/);
    expect(ar).toContain("تقرير أداء الموظف");

    const en = buildReportHtml(baseData({ lang: "en" }));
    expect(en).toMatch(/<html dir="ltr" lang="en">/);
    expect(en).toContain("Employee Performance Report");
  });

  it("embeds the Cairo font as base64 (self-contained, no external font request)", () => {
    const html = buildReportHtml(baseData());
    expect(html).toMatch(/@font-face[^}]*font-family:'Cairo'[^}]*src: url\(data:font\/woff2;base64,[A-Za-z0-9+/=]{100,}\)/s);
  });

  it("includes the agent name and score-derived gauge value", () => {
    const html = buildReportHtml(baseData());
    expect(html).toContain("Ahmed");
    expect(html).toMatch(/>72</); // the gauge's centered score text
  });

  it("sets an explicit white page background (a real bug caught live: a transparent body rendered black in Chrome's screenshot/PDF output)", () => {
    const html = buildReportHtml(baseData());
    expect(html).toMatch(/html,\s*body\s*\{\s*background:\s*#ffffff/);
  });
});

describe("buildReportHtml — XSS/HTML-injection safety", () => {
  it("escapes a malicious customer name instead of injecting raw HTML/script", () => {
    const html = buildReportHtml(baseData({
      conversations: [{ full_name: '<script>alert(1)</script>', phone: "123", date: "2026-06-15", agent_score: 50, conv_score: 40, lead_intent: "warm", lead_status: "x", follow_up_min: 3 }],
    }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes malicious content inside AI-generated notes text", () => {
    const html = buildReportHtml(baseData({
      notes: { summary: '"><img src=x onerror=alert(1)>', problems: [], improvements: [], commitments: [], positives: [] },
    }));
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });
});

describe("buildReportHtml — conditional sections", () => {
  it("shows the empty-patterns message when no coaching patterns were detected", () => {
    const html = buildReportHtml(baseData());
    expect(html).toContain("لا أنماط ضعف مرصودة في هذه الفترة.");
  });

  it("renders a pattern card with its label, count, and one smart-reply example", () => {
    const html = buildReportHtml(baseData({
      opening_patterns: [{ pattern_key: "premature_registration_push", pattern_label: "قفز لطلب التسجيل دون شرح القيمة", count: 7, smart_reply_examples: ["رد بديل واحد"] }],
    }));
    expect(html).toContain("قفز لطلب التسجيل دون شرح القيمة");
    expect(html).toContain("7");
    expect(html).toContain("رد بديل واحد");
  });

  it("shows the not-generated message when AI notes are absent, and renders them when present", () => {
    const withoutNotes = buildReportHtml(baseData());
    expect(withoutNotes).toContain("لم تُولَّد ملاحظات AI لهذه الفترة.");

    const withNotes = buildReportHtml(baseData({
      notes: { summary: "ملخص الأداء", problems: ["مشكلة 1"], improvements: ["تحسين 1"], commitments: [], positives: ["قوة 1"] },
    }));
    expect(withNotes).toContain("ملخص الأداء");
    expect(withNotes).toContain("مشكلة 1");
    expect(withNotes).toContain("قوة 1");
  });

  it("shows the measured-vs-total disclosure only when some conversations aren't yet measured", () => {
    const partial = buildReportHtml(baseData({ measured_conversations: 3, total_conversations: 12 }));
    expect(partial).toMatch(/3.*12|قِيس 3 من إجمالي 12/);

    const full = buildReportHtml(baseData({ measured_conversations: 12, total_conversations: 12 }));
    expect(full).not.toContain("قِيس");
  });

  it("renders the conversation table with rows, or the empty-state message with none", () => {
    const empty = buildReportHtml(baseData());
    expect(empty).toContain("لا توجد محادثات في هذه الفترة.");

    const withRows = buildReportHtml(baseData({
      conversations: [{ full_name: "Sara", phone: "9665551234", date: "2026-06-10", agent_score: 80, conv_score: 70, lead_intent: "hot", lead_status: "مهتم", follow_up_min: 2.5 }],
    }));
    expect(withRows).toContain("Sara");
    expect(withRows).toContain("9665551234");
    expect(withRows).toMatch(/display:table-header-group/); // repeating header across PDF pages
  });
});

describe("contact-cost block (weekly + monthly employee reports)", () => {
  const contacts = { key: "Omar", leads: 40, contacted: 30, not_contacted: 10, after_hours: 6,
    negligence: 4, expired: 3, interested: 5, cost_contacted: 300, cost_not_contacted: 100,
    cost_total: 400, contact_rate_pct: 75 };
  const weekly = (over = {}) => buildEmployeeWeeklyHtml({
    agent: "Omar", lang: "ar", period: { since: "2026-07-13", until: "2026-07-19" },
    prevPeriod: { since: "2026-07-06", until: "2026-07-12" }, generatedAt: "2026-07-20T00:00:00Z",
    cur: { kpis: { conversations: 20, intents: {} } }, prev: { kpis: { conversations: 12, intents: {} } },
    opening_patterns: [], dropout_patterns: [], conversations: [], ai: null, ...over });

  it("renders the contact-cost section with contacted/not-contacted + cost split", () => {
    const html = weekly({ contacts });
    expect(html).toContain("التواصل مع العملاء وتكلفتهم");
    expect(html).toContain("75.0%");   // contact rate
    expect(html).toContain("خارج الدوام"); // after-hours label
    expect(html).toContain("إهمال");      // negligence label
    expect(html).toContain("300 د.إ");   // cost of contacted
  });
  it("omits the contact-cost section entirely when there are no leads", () => {
    const html = weekly({ contacts: { ...contacts, leads: 0 } });
    expect(html).not.toContain("التواصل مع العملاء وتكلفتهم");
  });
  it("omits it when contacts is null (older cached data)", () => {
    expect(weekly({ contacts: null })).not.toContain("التواصل مع العملاء وتكلفتهم");
  });
  it("renders the block in the monthly report too (English)", () => {
    const html = buildEmployeeMonthlyHtml({
      agent: "Omar", lang: "en", monthKey: "2026-07", month: { since: "2026-07-01", until: "2026-07-31" },
      prevMonth: { since: "2026-06-01", until: "2026-06-30" }, generatedAt: "2026-08-01T00:00:00Z",
      week0: { isoWeek: "2026-W26", kpis: {} }, weeks: [{ isoWeek: "2026-W27", kpis: {} }],
      cur: { kpis: {} }, prev: { kpis: {} }, ai: null, contacts });
    expect(html).toContain("Customer contact &amp; cost");
    expect(html).toContain("Not contacted");
    expect(html).toContain("100 AED");
  });
});

describe("resolveExecutablePath", () => {
  const ORIGINAL = process.env.PUPPETEER_EXECUTABLE_PATH;
  afterEach(() => { process.env.PUPPETEER_EXECUTABLE_PATH = ORIGINAL; });

  it("returns the env override immediately without touching the filesystem", () => {
    process.env.PUPPETEER_EXECUTABLE_PATH = "/custom/chromium";
    expect(resolveExecutablePath()).toBe("/custom/chromium");
  });
});

describe("htmlToPdf (mocked puppeteer-core)", () => {
  const { pdfMock, setContentMock, closeMock, launchMock } = puppeteerMocks;

  beforeEach(() => {
    process.env.PUPPETEER_EXECUTABLE_PATH = "/fake/chromium";
    pdfMock.mockClear(); setContentMock.mockClear(); closeMock.mockClear(); launchMock.mockClear();
  });

  it("returns a real Buffer (not a bare Uint8Array) so Express's res.send() streams raw bytes instead of JSON-encoding them", async () => {
    const { htmlToPdf, closeBrowser } = await import("../src/lib/pdfReport.js");
    const buf = await htmlToPdf("<html>hi</html>");
    expect(Buffer.isBuffer(buf)).toBe(true);
    await closeBrowser();
  });

  it("renders the given HTML via a page.pdf() call with A4 + repeating footer page numbers, and closes the page", async () => {
    const { htmlToPdf, closeBrowser } = await import("../src/lib/pdfReport.js");
    const buf = await htmlToPdf("<html>hi</html>");
    expect(buf.toString()).toContain("%PDF-");
    expect(setContentMock).toHaveBeenCalledWith("<html>hi</html>", expect.objectContaining({ waitUntil: "networkidle0" }));
    const [opts] = pdfMock.mock.calls[0];
    expect(opts.format).toBe("A4");
    expect(opts.footerTemplate).toMatch(/pageNumber/);
    expect(closeMock).toHaveBeenCalled();
    await closeBrowser();
  });

  it("reuses the same browser instance across multiple calls instead of relaunching", async () => {
    const { htmlToPdf, closeBrowser } = await import("../src/lib/pdfReport.js");
    await htmlToPdf("<html>a</html>");
    await htmlToPdf("<html>b</html>");
    expect(launchMock).toHaveBeenCalledTimes(1);
    await closeBrowser();
  });
});
