// The wall-display quality board. What matters here is what it refuses to do:
// invent a score it doesn't have, crown someone ineligible, or draw a zero for a
// day nobody measured. Layout (no scrolling at 1920/1600/1366) is verified in a
// real browser — jsdom has no layout — so these tests cover the rendering rules.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import QualityBoard from "../src/components/QualityBoard.jsx";

const row = (over = {}) => ({
  rank: 1, name: "Ihsan Ahmed", leads: 120, contacted: 100, contact_rate_pct: 83.3,
  interested: 9, qualified: 20, next_step: 8, productivity: 80, persuasion: 82,
  compliance: 96, conversion: 61, response: 74, overall: 79.5, provisional: false,
  eligible: true, confidence: "high", sample_size: 20, delta_overall: 2.4,
  within_sla: 70, sla_answerable: 90, median_response_min: 18,
  risk: { critical: 0, major: 0, moderate: 0 }, ...over,
});

const data = (over = {}) => ({
  window: { since: "2026-07-22", until: "2026-07-28" }, days: 7,
  coverage: { total: 200, evaluated: 150, pct: 75 },
  target_compliance: 90, min_sample: 15,
  totals: {
    leads: 300, contacted: 240, qualified: 40, interested: 18, next_step: 15,
    contact_rate_pct: 80, quality_score: 78.5, compliance_score: 94.2,
    overall_score: 76.1, critical_open: 0, pending_review: 3,
  },
  daily: [
    { date: "2026-07-22", label: "Wed", overall: 70, contact_rate: 75, persuasion: 72, compliance: 95, conversion: 50, response: 60 },
    { date: "2026-07-23", label: "Thu", overall: null, contact_rate: 80, persuasion: null, compliance: null, conversion: null, response: null },
  ],
  rows: [row()],
  highlights: { top_performer: row(), best_persuasion: row(), best_conversion: null, most_improved: null },
  ...over,
});

describe("KPI row", () => {
  it("shows all eight business metrics", () => {
    const { container } = render(<QualityBoard data={data()} />);
    expect(container.querySelectorAll(".qb-kpi")).toHaveLength(8);
    // Scoped to the KPI strip: "Interested" and "Compliance" are also column
    // headers, so a document-wide query is ambiguous.
    const labels = [...container.querySelectorAll(".qb-kpi-label")].map((e) => e.textContent);
    expect(labels).toEqual(["TOTAL LEADS", "CONTACTED", "QUALIFIED", "INTERESTED",
      "NEXT STEP CONVERSIONS", "CONTACT RATE", "TEAM QUALITY SCORE", "COMPLIANCE SCORE"]);
  });

  it("warns when only a fraction of the window has been analysed", () => {
    const { container } = render(<QualityBoard data={data({ coverage: { total: 900, evaluated: 90, pct: 10 } })} />);
    expect(screen.getByText(/Analysed 10%/)).toBeTruthy();
    expect(container.querySelector(".qb-pill.warn")).toBeTruthy();
  });
});

describe("highlights", () => {
  it("says an award is not given rather than inventing a winner", () => {
    render(<QualityBoard data={data({ highlights: { top_performer: null, best_persuasion: null, most_improved: null } })} />);
    expect(screen.getAllByText("Not awarded yet")).toHaveLength(3);
  });

  it("names the winner with the metric that earned it", () => {
    render(<QualityBoard data={data()} />);
    const hl = screen.getByText("TOP PERFORMER").closest(".qb-hl");
    expect(within(hl).getByText("Ihsan Ahmed")).toBeTruthy();
    expect(within(hl).getByText("79.5")).toBeTruthy();              // the overall that won it
    // the two supporting metrics sit in their own label/value pairs
    expect(within(hl).getByText("Compliance")).toBeTruthy();
    expect(within(hl).getByText("96.0")).toBeTruthy();
    expect(within(hl).getByText("82.0")).toBeTruthy();              // quality
  });
});

describe("trend chart", () => {
  it("plots no point at all for a day that was never scored", () => {
    // "we had not started measuring" must not read as a catastrophic day, and
    // joining the line across the gap would invent a trend that never happened.
    const { container } = render(<QualityBoard data={data()} />);
    // 2 days, one null -> exactly one plotted point and no connecting line
    expect(container.querySelectorAll(".qb-svg circle")).toHaveLength(1);
    expect(container.querySelectorAll(".qb-svg path[stroke='#3b82f6']")).toHaveLength(0);
  });

  it("switches metric from the selector and re-plots every day that has data", () => {
    const { container } = render(<QualityBoard data={data()} />);
    fireEvent.change(container.querySelector(".qb-sel"), { target: { value: "contact_rate" } });
    expect(container.querySelectorAll(".qb-svg circle")).toHaveLength(2);   // both days have it
    expect(container.querySelector(".qb-sel").value).toBe("contact_rate");
  });

  it("draws the target line only for metrics that have one", () => {
    const { container } = render(<QualityBoard data={data()} />);
    expect(container.textContent).not.toContain("TARGET");        // Overall has no target
    fireEvent.change(container.querySelector(".qb-sel"), { target: { value: "compliance" } });
    expect(container.textContent).toContain("TARGET 90");
  });

  it("tells the room when nothing has been scored at all", () => {
    const d = data();
    d.daily = d.daily.map((x) => ({ ...x, overall: null }));
    render(<QualityBoard data={d} />);
    expect(screen.getByText(/Analysis in progress/)).toBeTruthy();
  });
});

describe("ranking table", () => {
  it("flags a thin sample instead of presenting its score as a verdict", () => {
    render(<QualityBoard data={data({ rows: [row({ provisional: true, eligible: false, sample_size: 2 })] })} />);
    expect(screen.getByText("Insufficient data")).toBeTruthy();
  });

  it("labels an employee who is scored but barred from the awards", () => {
    render(<QualityBoard data={data({ rows: [row({ eligible: false, provisional: false, compliance: 70 })] })} />);
    expect(screen.getByText("Not eligible")).toBeTruthy();
  });

  it("renders a dash for a score that does not exist yet", () => {
    const { container } = render(<QualityBoard data={data({
      rows: [row({ overall: null, persuasion: null, compliance: null, conversion: null })] })} />);
    const dashes = [...container.querySelectorAll(".qb-sc")].filter((s) => s.textContent === "—");
    expect(dashes).toHaveLength(4);
  });

  it("surfaces the worst open risk severity per employee", () => {
    render(<QualityBoard data={data({ rows: [row({ risk: { critical: 1, major: 3, moderate: 2 } })] })} />);
    expect(screen.getByText("1 Critical")).toBeTruthy();
    render(<QualityBoard data={data({ rows: [row({ name: "B", risk: { critical: 0, major: 2, moderate: 5 } })] })} />);
    expect(screen.getByText("2 Major")).toBeTruthy();
  });

  it("says so plainly when the period has no employees", () => {
    render(<QualityBoard data={data({ rows: [] })} />);
    expect(screen.getByText("No employees in this period")).toBeTruthy();
  });
});

describe("legend", () => {
  it("spells out every band, so colour is never the only signal", () => {
    render(<QualityBoard data={data()} />);
    for (const s of ["Excellent 90+", "Strong 80+", "Good 70+", "Needs work 60+", "Review <60", "No data"]) {
      expect(screen.getByText(s)).toBeTruthy();
    }
  });
});

// The drill-down is where the owner found a real defect: a customer listed under
// "Interested" whose own transcript said they refused twice. The count is fixed
// server-side; the popup's job now is to make a surviving disagreement visible
// rather than presenting one system's label as settled fact.
describe("drill-down conflict badge", () => {
  const drillRow = (over = {}) => ({
    wa_id: "966531257750", phone: "966531257750", full_name: ".", owner: "Yaser Kamoun",
    country: "SA", stage: "qualified", created_date: "2026-07-23",
    last_activity: "2026-07-27T10:11:00Z", messages: 20, customer_msgs: 11,
    conv_type: "human_handled", campaign: "GCC IST MARKETS", contacted: true,
    after_hours: false, first_human_response_min: 1, interested: false, status: "contacted",
    ai_intent: "cold", interest_conflict: true, conv_score: 15,
    lead_status: "غير مهتم، رفض فتح حساب وطلب عدم متابعة", summary: "رفض المتابعة مرتين",
    issues: [], ...over,
  });

  // The board probes /api/auth/me to decide whether numbers are clickable, and
  // the popup fetches /api/quality/drill. Both go through raw fetch, not api.js.
  function mockFetch(payload) {
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/api/auth/me")) return { ok: true, json: async () => ({ email: "a@b.c" }) };
      if (u.includes("/api/quality/drill")) return { ok: true, json: async () => payload };
      throw new Error(`unexpected fetch: ${u}`);
    };
  }

  const payloadFor = (rows) => ({
    metric: "interested", label: "Interested", agent: null, days: 30,
    window: { since: "2026-07-01", until: "2026-07-30" },
    total: rows.length, shown: rows.length, truncated: false, rows,
  });

  async function openDrill(payload) {
    mockFetch(payload);
    const { container } = render(<QualityBoard data={data()} />);
    await waitFor(() => expect(container.querySelector(".qb-sc-card.click")).toBeTruthy());
    fireEvent.click([...container.querySelectorAll(".qb-sc-card.click")][0]);
    await waitFor(() => expect(document.querySelector(".qb-dt tbody tr")).toBeTruthy());
    return container;
  }

  it("names both readings when the CRM and the transcript disagree", async () => {
    await openDrill(payloadFor([drillRow()]));
    const badge = document.querySelector(".qb-dt-iss .qb-risk.bad");
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain("qualified"); // what Wati says
    expect(badge.textContent).toContain("cold");      // what the transcript says
    // And it tells the reader what to do about it.
    expect(badge.textContent).toMatch(/fix stage in Wati/i);
  });

  it("stays quiet when the two agree", async () => {
    await openDrill(payloadFor([drillRow({ ai_intent: "warm", interested: true, interest_conflict: false })]));
    expect(document.querySelector(".qb-dt-iss .qb-risk.bad")).toBeNull();
  });

  it("survives a payload with no window instead of white-screening the popup", async () => {
    // What the over-broad mock in the first draft of this test accidentally
    // produced — and what a stale or error-shaped response would produce in
    // production. A missing date range must cost the date range, not the popup.
    // A payload with no `window` at all — a stale or error-shaped response.
    await openDrill({ total: 1, shown: 1, rows: [drillRow()] });
    expect(document.querySelector(".qb-modal-head p").textContent).toContain("1 customers");
  });
});

// "29 / 36" raises one question — which 7 were missed — and the popup used to be
// able to answer only half of it.
describe("drill-down: both halves of one number", () => {
  const row = (over = {}) => ({
    wa_id: "w1", phone: "9715550001", full_name: "Aditya", owner: "Yatra Mulmi",
    country: "IN", stage: "new", created_date: "2026-08-01", last_activity: "2026-08-04T07:43:00Z",
    messages: 4, customer_msgs: 2, conv_type: "awaiting_human", campaign: "IST",
    contacted: false, after_hours: false, first_human_response_min: null,
    interested: false, status: "expired_no_contact", issues: [], ...over,
  });

  function mockSides(byMetric) {
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/api/auth/me")) return { ok: true, json: async () => ({ email: "a@b.c" }) };
      const m = new URL(u, "http://x").searchParams.get("metric");
      return { ok: true, json: async () => ({
        metric: m, label: m, agent: null, days: 7,
        window: { since: "2026-07-29", until: "2026-08-04" },
        total: (byMetric[m] || []).length, shown: (byMetric[m] || []).length,
        truncated: false, rows: byMetric[m] || [],
      }) };
    };
  }

  async function open(byMetric) {
    mockSides(byMetric);
    const { container } = render(<QualityBoard data={data()} />);
    await waitFor(() => expect(container.querySelector(".qb-sc-card.click")).toBeTruthy());
    fireEvent.click([...container.querySelectorAll(".qb-sc-card.click")][0]);
    await waitFor(() => expect(document.querySelector(".qb-dt tbody tr")).toBeTruthy());
  }

  it("offers both sides and flips between them without reopening", async () => {
    await open({
      interested: [row({ contacted: true, status: "contacted" })],
      contacted: [row({ contacted: true, status: "contacted", full_name: "Answered" })],
      not_contacted: [row({ full_name: "Missed" })],
    });
    // The interested card has no counterpart, so no tabs.
    expect(document.querySelector(".qb-tabs")).toBeNull();
  });

  it("shows the tab pair on a contacted drill and switches the rows", async () => {
    mockSides({
      contacted: [row({ contacted: true, status: "contacted", full_name: "Answered" })],
      not_contacted: [row({ full_name: "Missed" }), row({ wa_id: "w2", full_name: "Missed2" })],
    });
    const { container } = render(<QualityBoard data={data()} />);
    await waitFor(() => expect(container.querySelector("td.click")).toBeTruthy());
    // The HANDLED cell in the employee row drills into "contacted".
    fireEvent.click([...container.querySelectorAll("td.click")][0]);
    await waitFor(() => expect(document.querySelector(".qb-tabs")).toBeTruthy());
    expect(document.querySelector(".qb-dt").textContent).toContain("Answered");

    const other = [...document.querySelectorAll(".qb-tab")].find((b) => !b.className.includes("on"));
    fireEvent.click(other);
    await waitFor(() => expect(document.querySelector(".qb-dt").textContent).toContain("Missed"));
    expect(document.querySelector(".qb-dt").textContent).not.toContain("Answered");
    // Two rows on the other side, and the tab is now the active one.
    expect(document.querySelectorAll(".qb-dt tbody tr").length).toBe(2);
  });

  it("says WHY each unanswered lead was never answered", async () => {
    mockSides({
      contacted: [row({ contacted: true, status: "contacted" })],
      not_contacted: [
        row({ status: "expired_no_contact", full_name: "Expired" }),
        row({ wa_id: "w2", status: "pending_after_hours", full_name: "AfterHours" }),
        row({ wa_id: "w3", status: "pending_in_hours", full_name: "StillOpen" }),
      ],
    });
    const { container } = render(<QualityBoard data={data()} />);
    await waitFor(() => expect(container.querySelector("td.click")).toBeTruthy());
    fireEvent.click([...container.querySelectorAll("td.click")][0]);
    await waitFor(() => expect(document.querySelector(".qb-tabs")).toBeTruthy());
    fireEvent.click([...document.querySelectorAll(".qb-tab")].find((b) => !b.className.includes("on")));
    await waitFor(() => expect(document.querySelectorAll(".qb-reason").length).toBe(3));

    const txt = document.querySelector(".qb-dt").textContent;
    // Three different problems with three different owners — not one "no reply".
    expect(txt).toContain("24h window closed");
    expect(txt).toContain("outside working hours");
    expect(txt).toContain("still open");
    // The one nobody could have answered in time is flagged, the open one is not.
    expect(document.querySelectorAll(".qb-reason.bad").length).toBe(1);
    expect(document.querySelectorAll(".qb-reason.warn").length).toBe(1);
  });
});

// The team-level KPI card had the same bug the per-employee row was fixed for:
// it divided next-step conversions by everyone qualified, including customers
// who never replied after the employee did. That silently halved the number on
// live data (9.7% vs the correct 18.4%), and the "no reply" count nobody could
// see was the whole reason for the discrepancy.
describe("team conversion KPI", () => {
  it("divides by convertible, not qualified, and surfaces the no-reply count", () => {
    const { container } = render(<QualityBoard data={data({
      totals: {
        leads: 300, contacted: 240, qualified: 195, convertible: 103, ghosted: 92,
        interested: 18, next_step: 19, contact_rate_pct: 80,
        quality_score: 78.5, compliance_score: 94.2,
      },
    })} />);
    const card = [...container.querySelectorAll(".qb-kpi")]
      .find((k) => k.querySelector(".qb-kpi-label")?.textContent === "NEXT STEP CONVERSIONS");
    const sub = card.querySelector(".qb-kpi-sub").textContent;
    // 19/103 = 18.4%, not 19/195 = 9.7%.
    expect(sub).toContain("18.4%");
    expect(sub).not.toContain("9.7%");
    expect(sub).toContain("92 no reply");
  });

  it("opens the same next-step / ghosted tab pair as the per-row cell", async () => {
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/api/auth/me")) return { ok: true, json: async () => ({ email: "a@b.c" }) };
      return { ok: true, json: async () => ({
        metric: new URL(u, "http://x").searchParams.get("metric"), label: "x", agent: null, days: 7,
        window: { since: "2026-07-22", until: "2026-07-28" }, total: 0, shown: 0, truncated: false, rows: [],
      }) };
    };
    const { container } = render(<QualityBoard data={data({
      totals: { leads: 300, contacted: 240, qualified: 195, convertible: 103, ghosted: 92, next_step: 19, contact_rate_pct: 80 },
    })} />);
    const card = await screen.findByText("NEXT STEP CONVERSIONS");
    await waitFor(() => expect(card.closest(".qb-kpi").className).toContain("click"));
    fireEvent.click(card.closest(".qb-kpi"));
    await waitFor(() => expect(document.querySelector(".qb-tabs")).toBeTruthy());
    expect([...document.querySelectorAll(".qb-tab")].length).toBe(2);
  });
});
