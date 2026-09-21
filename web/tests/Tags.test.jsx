// The tags page is a filter builder, so what matters is that clicking a pill
// actually changes the query the server is asked — and that the AND/ANY switch
// travels with it. A page that looks right but sends the wrong filter is worse
// than one that looks wrong.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Tags from "../src/pages/Tags.jsx";
import { I18nProvider } from "../src/i18n.jsx";

const get = vi.fn();
const post = vi.fn();
vi.mock("../src/api.js", () => ({
  setApiLang: () => {},
  default: { get: (...a) => get(...a), post: (...a) => post(...a) },
}));

const CATALOG = {
  departments: { sales: { ar: "مبيعات", en: "Sales" }, auto: { ar: "آلي", en: "Automated" } },
  sources: {},
  totals: { tags: 294, tags_in_use: 18, assignments: 22, customers_tagged: 2 },
  categories: [
    {
      key: "engagement_rating", name_ar: "تصنيف الحرارة", name_en: "Engagement Rating",
      dept: "sales", platform: "Sales Agent", source: "ai", why_ar: "من لهجته", tagged: 6,
      tags: [
        { tag: "ENG_HOT", en: "🔥 Hot", ar: "🔥 ساخن", source: "ai", count: 4 },
        { tag: "ENG_COLD", en: "🧊 Cold", ar: "🧊 بارد", source: "ai", count: 2 },
      ],
    },
    {
      key: "deposit_tier", name_ar: "شريحة الإيداع", name_en: "Deposit Tier",
      dept: "auto", platform: "Trading Platform", source: "external", why_ar: "مبلغ حقيقي", tagged: 0,
      tags: [{ tag: "DEP_USD_GT_100K", en: "> $100K", ar: "أكثر من 100 ألف$", source: "external", count: 0 }],
    },
  ],
};

const CUSTOMERS = {
  total: 1, page: 1, page_size: 50, match: "any", tags: [],
  rows: [{
    wa_id: "212700000000", name: "Zahra", phone: "212700000000", owner: "Omar", owner_label: "Omar",
    stage: "interested", created_date: "2026-07-01", last_message_at: "2026-07-20T10:00:00Z", messages: 12,
    tags: [{ tag: "ENG_HOT", label: "🔥 ساخن", category: "engagement_rating" }],
  }],
};

const EMPLOYEES = [
  { owner: "Omar", owner_label: "Omar", customers: 12, matched: 6, share_pct: 50,
    top_tags: [{ tag: "ENG_HOT", label: "🔥 ساخن", count: 6 }] },
  { owner: "Sara", owner_label: "Sara", customers: 0, matched: 0, share_pct: null, top_tags: [] },
];

const STATUS = {
  tag_version: "tag-1", window: { since: "2026-07-01", until: "2026-07-30" },
  running: false, pending: 40, taggable: 100, tagged: 60, budget_remaining_usd: 3.5,
};

beforeEach(() => {
  get.mockReset(); post.mockReset();
  get.mockImplementation(async (url) => {
    if (url.startsWith("/tags/catalog")) return CATALOG;
    if (url.startsWith("/tags/customers")) return CUSTOMERS;
    if (url.startsWith("/tags/employees")) return EMPLOYEES;
    if (url.startsWith("/tags/status")) return STATUS;
    if (url.startsWith("/tags/customer/")) {
      return {
        customer: { wa_id: "212700000000", name: "Zahra", phone: "212700000000", owner_label: "Omar" },
        run: { tag_version: "tag-1", tags_found: 5, model: "x", tagged_at: "2026-07-30T07:00:00Z" },
        tags: [
          { tag: "ENG_HOT", label: "🔥 ساخن", category: "engagement_rating",
            category_label: "تصنيف الحرارة", source: "ai",
            confidence: 0.9, evidence: "كيف أودع الآن", review_status: "auto" },
          { tag: "GEO_MOR", label: "المغرب", category: "geo_country",
            category_label: "الدولة", source: "rule",
            confidence: null, evidence: "dial code → MA", review_status: "auto" },
        ],
      };
    }
    return {};
  });
});

const setup = () => render(<I18nProvider><Tags /></I18nProvider>);
const urls = (prefix) => get.mock.calls.map((c) => c[0]).filter((u) => u.startsWith(prefix));
// The same label appears in the tree, in a chip and in a customer row, so every
// query here is scoped by what it IS rather than by its text.
const treePill = (tag) => document.querySelector(`button.tag-pill[title="${tag}"]`);
const chip = (tag) => [...document.querySelectorAll("button.tag-pill.on")]
  .find((b) => b.textContent.includes("✕") && !b.title);

describe("taxonomy browser", () => {
  it("shows the totals and every tag including the empty ones", async () => {
    setup();
    // A zero-count tag is still listed — that IS the finding on day one.
    await waitFor(() => expect(treePill("DEP_USD_GT_100K")).toBeTruthy());
    expect(treePill("DEP_USD_GT_100K").className).toContain("zero");
    expect(treePill("ENG_HOT").textContent).toContain("4");
    expect(screen.getByText("294")).toBeTruthy();
  });

  it("filters the tree by department and by search without hitting the server again", async () => {
    setup();
    await waitFor(() => expect(treePill("DEP_USD_GT_100K")).toBeTruthy());
    const before = urls("/tags/catalog").length;

    fireEvent.change(screen.getByDisplayValue("كل الأقسام"), { target: { value: "sales" } });
    await waitFor(() => expect(treePill("DEP_USD_GT_100K")).toBeNull());
    expect(treePill("ENG_HOT")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("ابحث عن وسم…"), { target: { value: "cold" } });
    await waitFor(() => expect(treePill("ENG_HOT")).toBeNull());
    expect(treePill("ENG_COLD")).toBeTruthy();

    // 294 rows filter faster in the browser than a round trip would.
    expect(urls("/tags/catalog").length).toBe(before);
  });
});

describe("filter building", () => {
  it("sends the picked tag to the server and shows it as a removable chip", async () => {
    setup();
    await waitFor(() => expect(treePill("ENG_HOT")).toBeTruthy());
    fireEvent.click(treePill("ENG_HOT"));

    await waitFor(() => expect(urls("/tags/customers").some((u) => u.includes("tags=ENG_HOT"))).toBe(true));
    expect(screen.getByText("الوسوم المختارة")).toBeTruthy();

    // Clicking the chip removes it, and the next request carries no tag filter.
    fireEvent.click(chip("ENG_HOT"));
    await waitFor(() => expect(urls("/tags/customers").at(-1)).not.toContain("tags="));
  });

  it("carries the AND/ANY choice into the query", async () => {
    setup();
    await waitFor(() => expect(treePill("ENG_HOT")).toBeTruthy());
    fireEvent.click(treePill("ENG_HOT"));
    fireEvent.click(treePill("ENG_COLD"));
    fireEvent.change(screen.getByDisplayValue("مطابقة: أيّ وسم"), { target: { value: "all" } });

    await waitFor(() => {
      const last = urls("/tags/customers").at(-1);
      expect(last).toContain("match=all");
      expect(last).toContain("ENG_HOT");
      expect(last).toContain("ENG_COLD");
    });
  });
});

describe("results", () => {
  it("lists matching customers with their tags", async () => {
    setup();
    expect(await screen.findByText("Zahra")).toBeTruthy();
    expect(screen.getByText("interested")).toBeTruthy();
  });

  it("switches to employees and shows an empty share as a dash, not 0%", async () => {
    setup();
    fireEvent.click(await screen.findByText("الموظفون"));
    expect(await screen.findByText("Omar")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    // Sara owns nobody in the window; 0% would read as failure rather than as
    // an empty window.
    const sara = screen.getByText("Sara").closest("tr");
    expect(sara.textContent).toContain("—");
    expect(sara.textContent).not.toContain("0%");
  });
});

describe("drill-down", () => {
  const card = (code) => [...document.querySelectorAll(".modal .tg-card")]
    .find((c) => c.querySelector("code")?.textContent === code);

  it("shows the AI evidence and offers review only on AI tags", async () => {
    setup();
    fireEvent.click(await screen.findByText("تفاصيل"));
    await waitFor(() => expect(card("ENG_HOT")).toBeTruthy());

    // The rule tag is computed, not an opinion — there is nothing to confirm.
    expect(card("GEO_MOR").textContent).toContain("محسوب");
    expect(card("GEO_MOR").querySelector("button")).toBeNull();
    // The AI tag is reviewable: confirm and reject.
    expect(card("ENG_HOT").querySelectorAll("button").length).toBe(2);
  });

  it("keeps the tag name, its code and the whole quote in one card", async () => {
    // The regression this replaces: five table columns fought over the width, so
    // the tag column scrolled out of sight and the status text landed on top of
    // the Arabic evidence. A card owns its own row — nothing can push anything out.
    setup();
    fireEvent.click(await screen.findByText("تفاصيل"));
    await waitFor(() => expect(card("ENG_HOT")).toBeTruthy());

    const c = card("ENG_HOT");
    expect(c.querySelector(".tg-name").textContent).toBe("🔥 ساخن");
    expect(c.querySelector("code").textContent).toBe("ENG_HOT");
    // The full quote is present and not truncated into a narrow cell.
    expect(c.querySelector(".tg-ev").textContent).toContain("كيف أودع الآن");
    expect(c.textContent).toContain("90%");
  });

  it("groups the tags by category and summarises them in the header", async () => {
    setup();
    fireEvent.click(await screen.findByText("تفاصيل"));
    await waitFor(() => expect(card("ENG_HOT")).toBeTruthy());

    const groups = [...document.querySelectorAll(".modal .tg-group h4")].map((h) => h.textContent);
    expect(groups.some((g) => g.includes("تصنيف الحرارة"))).toBe(true);
    expect(groups.some((g) => g.includes("الدولة"))).toBe(true);
    // The facts strip carries the phone, the agent and the tag count.
    const facts = document.querySelector(".modal .tg-facts").textContent;
    expect(facts).toContain("212700000000");
    expect(facts).toContain("Omar");
  });

  it("toggles a confirmed tag back to automatic instead of confirming twice", async () => {
    setup();
    fireEvent.click(await screen.findByText("تفاصيل"));
    await waitFor(() => expect(card("ENG_HOT")).toBeTruthy());

    const [confirm] = card("ENG_HOT").querySelectorAll("button");
    fireEvent.click(confirm);
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      "/tags/customer/212700000000/review", { tag: "ENG_HOT", action: "confirm" }));
  });
});

describe("run panel", () => {
  it("shows coverage and the cost of what is left before starting", async () => {
    setup();
    expect(await screen.findByText("60 / 100 · 60%")).toBeTruthy();
    expect(screen.getByText("ابدأ التوسيم")).toBeTruthy();
  });

  it("passes the chosen period to the tagging run", async () => {
    setup();
    await waitFor(() => expect(document.querySelectorAll('input[type="date"]').length).toBe(2));
    const inputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(inputs[0], { target: { value: "2026-03-01" } });
    fireEvent.change(inputs[1], { target: { value: "2026-03-31" } });
    await waitFor(() => expect(urls("/tags/status").at(-1)).toContain("since=2026-03-01"));

    fireEvent.click(screen.getByText("ابدأ التوسيم"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/tags/run",
      expect.objectContaining({ since: "2026-03-01", until: "2026-03-31" })));
  });
});
