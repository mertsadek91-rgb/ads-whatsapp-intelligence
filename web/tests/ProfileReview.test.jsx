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
    expect(screen.getByText("نظام آخر يملكها — لا تُخمَّن أبداً")).toBeTruthy();
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

// The vocabulary the generator proposes is a first draft. The operator is the
// one who knows the codes their own CRM writes, so every part of it has to be
// reachable by hand — and the one failure mode that is invisible in a form (a
// code claimed twice, dropped on save) has to be visible before saving.
describe("defining tags by hand", () => {
  const openTags = () => {
    const onChange = renderIt();
    fireEvent.click(screen.getByText("وسوم العملاء"));
    fireEvent.click(screen.getByText("النيّة"));
    return onChange;
  };

  it("edits a tag's code and its two labels", () => {
    const onChange = openTags();
    fireEvent.change(screen.getByDisplayValue("أ"), { target: { value: "شراء" } });
    expect(onChange.mock.calls.at(-1)[0].tags.categories[0].tags[0][2]).toBe("شراء");
  });

  it("forces a code into the shape the schema accepts as it is typed", () => {
    // Otherwise the operator types "buy now", saves, and the tag silently never
    // exists — the schema drops anything that fails its pattern.
    const onChange = openTags();
    fireEvent.change(screen.getByDisplayValue("A"), { target: { value: "buy now!" } });
    expect(onChange.mock.calls.at(-1)[0].tags.categories[0].tags[0][0]).toBe("BUYNOW");
  });

  it("adds an empty row to type into", () => {
    const onChange = openTags();
    fireEvent.click(screen.getByText("أضِف وسماً"));
    expect(onChange.mock.calls.at(-1)[0].tags.categories[0].tags).toHaveLength(2);
  });

  it("warns on the row when a code is already claimed by another category", () => {
    const onChange = vi.fn();
    const p = profile();
    p.tags.categories[1].tags = [["A", "a", "أ"]];     // same code as "intent"
    render(<ProfileReview profile={p} summary={{}} warnings={[]} repairs={[]}
      lang="ar" onChange={onChange} />);
    fireEvent.click(screen.getByText("وسوم العملاء"));
    fireEvent.click(screen.getByText("الفوترة"));
    expect(screen.getByText(/مستعمَل في فئة أخرى/)).toBeTruthy();
  });

  it("deletes a tag from the vocabulary without inventing a retired entry", () => {
    // Retirement — what keeps an old board row rendering a name rather than a
    // bare code — belongs to activation, which sees both the old and the new
    // document. Writing it here too would strand an entry as soon as someone
    // deleted a tag and added it back before saving.
    const onChange = openTags();
    fireEvent.click(screen.getAllByText("حذف").at(-1));
    const next = onChange.mock.calls.at(-1)[0];
    expect(next.tags.categories[0].tags).toHaveLength(0);
    expect(next.retired?.tags ?? []).toEqual([]);
  });

  it("adds a whole category, defaulting to the AI as its source", () => {
    const onChange = renderIt();
    fireEvent.click(screen.getByText("وسوم العملاء"));
    fireEvent.click(screen.getByText("أضِف فئة وسوم"));
    const added = onChange.mock.calls.at(-1)[0].tags.categories.at(-1);
    expect(added).toMatchObject({ key: "", source: "ai", tags: [] });
  });

  it("states why each source exists, next to the choice itself", () => {
    // Which system owns a tag is the most consequential choice here and the
    // least self-explanatory; three bare words in a dropdown would not carry it.
    openTags();
    expect(screen.getByText(/ولا مكان آخر/)).toBeTruthy();
    expect(screen.getByText(/تبدو تماماً كحالة حقيقية/)).toBeTruthy();
  });
});
