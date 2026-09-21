// "I don't see any new setting" is a UI outcome, not a server one, so it is
// checked here: that the section renders, that it reflects what the server
// says, and — the part that actually went wrong — that it says something when
// the server cannot answer instead of vanishing.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Settings from "../src/pages/Settings.jsx";
import { I18nProvider } from "../src/i18n.jsx";

const get = vi.fn();
const post = vi.fn(async () => ({}));
vi.mock("../src/api.js", () => ({ setApiLang: () => {},
  default: { get: (...a) => get(...a), post: (...a) => post(...a) } }));
// Stable identities on purpose: CurrencyRatesSection copies `rates` into state
// in an effect keyed on it, so a mock that returns a fresh object each render
// would spin forever.
const CURRENCY = { currencies: [], rates: {}, saveRates: async () => {} };
vi.mock("../src/currency.jsx", () => ({ useCurrency: () => CURRENCY }));

const RANGE = {
  since: "", watiMessages: false, lookbackDays: 120, metaSince: "2026-05-24",
  ar: "آخر 120 يوماً، بدون سجلّ المحادثات", en: "the last 120 days, without message history",
};

const setup = () => render(
  <MemoryRouter><I18nProvider><Settings /></I18nProvider></MemoryRouter>);

// The section under test — scoped, because other sections share button labels
// like "حفظ". Waiting on the HEADING is not enough: it is present during the
// loading state too, so a query right after it reads the pre-fetch snapshot.
// Each helper waits for content that only exists once the fetch has settled.
const scope = (container) => within(container.querySelector('[data-section="data-range"]'));

const section = async (container) => {
  await screen.findByText(/كل البيانات المتاحة/);
  return scope(container);
};

const failedSection = async (container) => {
  await screen.findByText(/تعذّر قراءة هذا الإعداد/);
  return scope(container);
};

// Every other section on the page fetches too, and a shape they cannot render
// crashes the page before the one under test appears. `range` is the only part
// a test varies.
const serve = (range = { ...RANGE }) => get.mockImplementation(async (p) => {
  if (p === "/settings/data-range") {
    if (range instanceof Error) throw range;
    return range;
  }
  if (p === "/settings/work-hours") return { start: 9, end: 17, offDays: [0, 6] };
  return {};
});

beforeEach(() => { get.mockReset(); post.mockClear(); serve(); });

describe("the import-range section on the Settings page", () => {
  it("is on the page, with all three ranges to choose from", async () => {
    const { container } = setup();
    const s = await section(container);
    expect(s.getByText(/كل البيانات المتاحة/)).toBeTruthy();
    expect(s.getByText("من تاريخ محدّد")).toBeTruthy();
    expect(s.getByText(/النافذة الافتراضية — آخر 120 يوماً/)).toBeTruthy();
  });

  it("pre-selects what the server already has", async () => {
    serve({ ...RANGE, since: "2026-03-01", watiMessages: true });
    const { container } = setup();
    await section(container);
    const [all, date] = container.querySelectorAll('input[name="dr"]');
    expect(all.checked).toBe(false);
    expect(date.checked).toBe(true);
    expect(container.querySelector('input[type="date"]').value).toBe("2026-03-01");
    expect(container.querySelector('input[type="checkbox"]').checked).toBe(true);
  });

  it("saves the choice the operator made, not the one it loaded", async () => {
    const { container } = setup();
    const s = await section(container);
    fireEvent.click(container.querySelectorAll('input[name="dr"]')[0]);      // everything
    fireEvent.click(container.querySelector('input[type="checkbox"]'));       // + message text
    fireEvent.click(s.getByText("حفظ"));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      "/settings/data-range", { since: "all", watiMessages: true }));
  });

  it("will not save a 'from a date' choice with no date", async () => {
    const { container } = setup();
    const s = await section(container);
    fireEvent.click(container.querySelectorAll('input[name="dr"]')[1]);       // from a date
    expect(s.getByText("حفظ").disabled).toBe(true);
  });

  it("says saving alone imports nothing, and offers the import", async () => {
    // Without this an operator widens the range, sees identical numbers, and
    // concludes the setting does not work.
    const { container } = setup();
    const s = await section(container);
    expect(s.getByText(/الحفظ وحده لا يجلب شيئاً جديداً/)).toBeTruthy();
    fireEvent.click(s.getByText("استورد الآن بهذا المدى"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/settings/data-range/import"));
  });

  it("stays on the page and explains itself when the server cannot answer", async () => {
    // A server predating this route answers 404. The section used to render
    // null then, which looks exactly like the feature not existing.
    serve(new Error("خطأ في الخادم"));
    const { container } = setup();
    const s = await failedSection(container);
    expect(s.getByText(/تعذّر قراءة هذا الإعداد/)).toBeTruthy();
    expect(s.getByText(/أعِد تشغيله/)).toBeTruthy();
  });
});
