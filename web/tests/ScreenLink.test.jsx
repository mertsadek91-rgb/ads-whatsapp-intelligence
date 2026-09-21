// The wall-display link on the review page. The link is built, not typed, so
// what matters is that it points at the quality screen with the kiosk code the
// server actually holds — a link the owner copies once and tapes to the TV.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import QualityReview from "../src/pages/QualityReview.jsx";
import { I18nProvider } from "../src/i18n.jsx";

const get = vi.fn();
vi.mock("../src/api.js", () => ({
  setApiLang: () => {},
  default: { get: (...a) => get(...a), post: async () => ({}) },
}));

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (url) => {
    if (url.startsWith("/salesboard/token")) return { token: "sales", code: "sales", path: "/tv/sales" };
    if (url.startsWith("/quality/summary")) return { pending: 0, critical_pending: 0, confirmed: 0, rejected: 0, severities: [], types: [] };
    if (url.startsWith("/quality/issues") && url.includes("/context")) return CONTEXT;
    if (url.startsWith("/quality/issues")) return ISSUES;
    if (url.startsWith("/quality/training")) return [];
    if (url.startsWith("/quality/calibration")) return null;
    if (url.startsWith("/salesboard/quality/status")) {
      return { tag_version: "v1.1", window: { since: "2026-07-01", until: "2026-07-31" }, running: false, pending: 0 };
    }
    return {};
  });
});

const ISSUES = {
  total: 1,
  rows: [{
    id: 7, severity: "critical", type: "guaranteed_profit_promise", type_label: "Guaranteed-profit promise",
    owner_label: "Amira Farouk Amir Saleh", customer: "ابو بدر", confidence: 1,
    scoring: "counted", review_status: "pending", evidence: "علي راسي بيساعدك لتحقيق أرباح ومكاسب",
  }],
};

const CONTEXT = {
  id: 7, wa_id: "966592190410", evidence: "علي راسي بيساعدك لتحقيق أرباح ومكاسب",
  customer: "ابو بدر العمراني", phone: "966592190410", owner: "Yaser Kamoun",
  contact: {
    wa_id: "966592190410", country: { iso2: "SA", ar: "السعودية", en: "Saudi Arabia", flag: "🇸🇦" },
    stage: "new", created_date: "2026-07-29T00:00:00.000Z", last_message_at: "2026-07-29T13:46:23.000Z",
    campaign: "GCC IST MARKETS - WA - ARABIC", ad: "Ferial", messages: 39, customer_msgs: 20,
    agent_msgs: 19, bot_msgs: 0, conv_type: "human_handled", first_human_response_min: 6.8,
    replied_after_agent: true, lead_intent: "cold", lead_status: "رفض بعد طلب مستندات",
    conv_score: 45, qualification_score: 40,
  },
  evidence_found: true, messages: [{ i: 0, ts: null, dir: "in", sender: null, body: "مرحبا", flagged: false }],
  truncated: { before: 0, after: 0, total: 1 },
};

const setup = () => render(<I18nProvider><QualityReview /></I18nProvider>);
const linkBox = () => [...document.querySelectorAll("input[readonly]")][0];

describe("wall-display link", () => {
  it("builds the quality screen link from the server's kiosk code", async () => {
    setup();
    await waitFor(() => expect(linkBox()?.value).toBeTruthy());
    // Defaults to 30 days, the window a supervisor actually reviews.
    expect(linkBox().value).toBe(`${window.location.origin}/tv/sales/quality?days=30`);
    // It is the QUALITY screen, not the sales board that shares the code.
    expect(linkBox().value).toContain("/quality");
  });

  it("drops the days parameter when it matches the screen's own default", async () => {
    setup();
    await waitFor(() => expect(linkBox()?.value).toBeTruthy());
    fireEvent.change(screen.getAllByRole("combobox").find((s) => s.value === "30"), { target: { value: "7" } });
    await waitFor(() => expect(linkBox().value).toBe(`${window.location.origin}/tv/sales/quality`));
  });

  it("opens in a new tab from the relative path", async () => {
    setup();
    await waitFor(() => expect(linkBox()?.value).toBeTruthy());
    const a = [...document.querySelectorAll("a.btn")].find((x) => x.textContent.includes("فتح الشاشة"));
    expect(a.getAttribute("href")).toBe("/tv/sales/quality?days=30");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noreferrer");
  });

  it("says where the code comes from instead of showing a broken link", async () => {
    get.mockImplementation(async (url) => (url.startsWith("/salesboard/token") ? {} : {}));
    setup();
    await waitFor(() => expect(screen.getByText(/يُنشَأ رمز الكشك/)).toBeTruthy());
    expect(linkBox().value).toBe("");
  });
});

// A supervisor confirming a critical finding needs to know who the customer was
// without leaving the popup. This is the authenticated review page — the same
// session gate the drill-down uses — so the number is shown here and nowhere
// public.
describe("finding review — customer details", () => {
  async function openFinding() {
    setup();
    fireEvent.click(await screen.findByText("مراجعة"));
    await waitFor(() => expect(document.querySelector(".modal .tg-facts")).toBeTruthy());
    return document.querySelector(".modal");
  }

  it("shows the phone, the country and who owns the lead", async () => {
    const m = await openFinding();
    expect(m.textContent).toContain("966592190410");
    expect(m.textContent).toContain("السعودية");
    expect(m.textContent).toContain("ابو بدر العمراني");
    expect(m.textContent).toContain("Amira Farouk Amir Saleh");
  });

  it("shows where the lead came from and how the conversation went", async () => {
    const m = await openFinding();
    expect(m.textContent).toContain("GCC IST MARKETS");   // campaign
    expect(m.textContent).toContain("6.8");               // first reply minutes
    expect(m.textContent).toContain("39");                // message count
    expect(m.textContent).toContain("رفض بعد طلب مستندات"); // the AI's reading
  });

  it("still opens when the context has no contact block", async () => {
    // An older stored issue, or a payload from before this change: the details
    // go blank, the finding stays reviewable.
    get.mockImplementation(async (url) => {
      if (url.startsWith("/quality/issues") && url.includes("/context")) {
        return { id: 7, evidence: "x", messages: [], truncated: { before: 0, after: 0, total: 0 } };
      }
      if (url.startsWith("/quality/issues")) return ISSUES;
      if (url.startsWith("/quality/summary")) return { pending: 1, critical_pending: 1, confirmed: 0, rejected: 0, severities: [], types: [] };
      if (url.startsWith("/salesboard/token")) return { code: "sales" };
      return {};
    });
    setup();
    fireEvent.click(await screen.findByText("مراجعة"));
    await waitFor(() => expect(document.querySelector(".modal .tg-facts")).toBeTruthy());
    expect(document.querySelector(".modal").textContent).toContain("تأكيد المخالفة");
  });
});
