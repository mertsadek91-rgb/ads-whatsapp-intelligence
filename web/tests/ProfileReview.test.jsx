// The review screen is the only thing standing between an AI-written
// vocabulary and the scores an employee is judged by, so what it makes a human
// look at is the whole point.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProfileReview from "../src/setup/ProfileReview.jsx";

const profile = () => ({
  identity: {
    company_name: "عيادة النور", what_we_sell: "عيادة أسنان",
    facts: [
      { key: "licence", label_ar: "الترخيص", label_en: "Licence", value: "MOH-123",
        source: "unverified", evidence: null, verified_by_human: false },
      { key: "hours", label_ar: "ساعات العمل", label_en: "Hours", value: "9-5",
        source: "website", evidence: "نعمل من 9 صباحاً حتى 5 مساءً", verified_by_human: false },
    ],
  },
  issue_types: [
    { key: "medical_advice_beyond_scope", default_severity: "critical", ar: "نصيحة طبية خارج الاختصاص", en: "Advice beyond scope" },
    { key: "unclear_wording", default_severity: "informational", ar: "صياغة غير واضحة", en: "Unclear wording", core: true },
  ],
  lifecycle: { stages: [
    { key: "new", ar: "جديد", en: "New" },
    { key: "patient", ar: "مريض", en: "Patient", counts_as_converted: true },
  ] },
  tags: { categories: [
    { key: "intent", source: "ai", name_ar: "النيّة", name_en: "Intent", tags: [["A", "a", "أ"]] },
    { key: "billing", source: "external", name_ar: "الفوترة", name_en: "Billing", tags: [["B", "b", "ب"]] },
  ] },
});

const renderIt = (over = {}) => {
  const onChange = vi.fn();
  render(<ProfileReview profile={profile()} summary={{ issueTypes: 2, tags: 2 }}
    warnings={[]} repairs={[]} lang="ar" onChange={onChange} {...over} />);
  return onChange;
};

describe("business profile review", () => {
  it("opens on the facts, because those are what the evaluator checks claims against", () => {
    renderIt();
    expect(screen.getByDisplayValue("MOH-123")).toBeTruthy();
  });

  it("counts the facts still needing a human confirmation", () => {
    renderIt();
    expect(screen.getByText(/بحاجة لتأكيدك/)).toBeTruthy();
  });

  it("shows the quote the AI based a fact on, so it can be checked", () => {
    renderIt();
    expect(screen.getByText(/نعمل من 9 صباحاً/)).toBeTruthy();
  });

  it("marks a fact the AI could not quote as unverified", () => {
    renderIt();
    expect(screen.getByText("غير مؤكَّد")).toBeTruthy();
  });

  it("confirms facts one at a time — there is no bulk verify", () => {
    // Bulk-verifying a licence number nobody read is exactly the failure this
    // screen exists to prevent.
    renderIt();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(screen.queryByText(/تأكيد الكل|verify all/i)).toBeNull();
    fireEvent.click(boxes[0]);
  });

  it("reports back an edited fact rather than mutating silently", () => {
    const onChange = renderIt();
    fireEvent.change(screen.getByDisplayValue("MOH-123"), { target: { value: "MOH-999" } });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0].identity.facts.some((f) => f.value === "MOH-999")).toBe(true);
  });

  it("surfaces the repairs made to the AI's proposal", () => {
    renderIt({ repairs: ["core issue type \"generic_reply\" was missing and has been added"] });
    expect(screen.getByText(/generic_reply/)).toBeTruthy();
  });

  it("warns prominently when the website could not be read", () => {
    renderIt({ warnings: ["SITE_UNREACHABLE"] });
    expect(screen.getByText("تعذّرت قراءة موقعك")).toBeTruthy();
  });

  it("lets a severity be changed but protects the universal issue types", () => {
    const onChange = renderIt();
    fireEvent.click(screen.getByText("المخالفات التي سترصد"));
    // One removable industry type, one core type that must not be removable.
    expect(screen.getAllByText("حذف")).toHaveLength(1);
    expect(screen.getByText("أساسية")).toBeTruthy();
  });

  it("names which tags the AI will never guess", () => {
    renderIt();
    fireEvent.click(screen.getByText("وسوم العملاء"));
    expect(screen.getByText("نظام آخر — لا يُخمَّن")).toBeTruthy();
    expect(screen.getByText("يستنتجه الذكاء الاصطناعي")).toBeTruthy();
  });

  it("marks the lifecycle stage that defines a conversion", () => {
    // Every conversion rate in the product is built on this one flag, so the
    // reviewer has to be able to see which stage carries it. Asserted on the
    // badge itself rather than the word, which also appears in the explanation.
    const { container } = render(
      <ProfileReview profile={profile()} summary={{}} warnings={[]} repairs={[]}
        lang="ar" onChange={() => {}} />);
    fireEvent.click(screen.getAllByText("مراحل العميل")[0]);
    const badges = [...container.querySelectorAll("li strong")].map((e) => e.textContent).join();
    expect(badges).toMatch(/تحوّل/);
  });
});
