// Letting a step be skipped is only half the feature; the other half is that a
// skipped step stays visible. The consequence of skipping is a board that is
// empty for a reason nobody can see.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../src/i18n.jsx";
import OnboardingPanel from "../src/components/OnboardingPanel.jsx";

const get = vi.fn();
vi.mock("../src/api.js", () => ({
  setApiLang: () => {},
  default: { get: (...a) => get(...a) },
  api: { get: (...a) => get(...a) },
}));

const status = (over = {}) => ({
  pending: 2,
  blocking: 0,
  items: [
    { key: "meta", done: false, required: false, href: "/settings",
      ar: "ربط حساب إعلانات Meta", en: "Connect Meta Ads",
      why_ar: "بدونه لا توجد بيانات إنفاق", why_en: "Without it there is no spend data" },
    { key: "ai", done: false, required: false, href: "/settings",
      ar: "مفتاح الذكاء الاصطناعي", en: "AI key",
      why_ar: "بدونه لا تقييم للجودة", why_en: "Without it nothing is scored" },
    { key: "wati", done: true, required: false, href: "/settings",
      ar: "ربط واتساب", en: "Connect WhatsApp", why_ar: "", why_en: "" },
  ],
  ...over,
});

const show = (role = "admin") =>
  render(<I18nProvider><OnboardingPanel role={role} /></I18nProvider>);

beforeEach(() => { get.mockReset(); try { sessionStorage.clear(); } catch { /* ignore */ } });

describe("onboarding checklist", () => {
  it("survives a response that has no items at all", async () => {
    // Not hypothetical: Layout mounts this panel, and a test that stubbed every
    // api.get with {} made it throw inside the effect's .then — an unhandled
    // rejection, invisible to the catch, that failed the whole run on CI while
    // passing locally. A page must not be brought down by its to-do list.
    get.mockResolvedValue({});
    const { container } = show();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.querySelector(".onboarding")).toBeNull();
  });

  it("stays silent when the response says pending but lists nothing", async () => {
    // A count and a list that disagree is a server bug; rendering nothing is
    // the right answer to it, not a crash.
    get.mockResolvedValue({ pending: 3, blocking: 0 });
    const { container } = show();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.querySelector(".onboarding")).toBeNull();
  });

  it("lists what is still missing", async () => {
    get.mockResolvedValue(status());
    show();
    await waitFor(() => expect(screen.getByText("ربط حساب إعلانات Meta")).toBeTruthy());
    expect(screen.getByText("مفتاح الذكاء الاصطناعي")).toBeTruthy();
  });

  it("says what each gap costs, not just that it exists", async () => {
    get.mockResolvedValue(status());
    show();
    await waitFor(() => expect(screen.getByText("بدونه لا توجد بيانات إنفاق")).toBeTruthy());
  });

  it("shows what is already done, collapsed", async () => {
    get.mockResolvedValue(status());
    show();
    await waitFor(() => expect(screen.getByText(/المكتمل/)).toBeTruthy());
  });

  it("stays out of the way when nothing is pending", async () => {
    get.mockResolvedValue(status({ pending: 0, items: [] }));
    const { container } = show();
    await waitFor(() => expect(container.querySelector(".onboarding")).toBeNull());
  });

  it("can be dismissed for the session", async () => {
    get.mockResolvedValue(status());
    const { container } = show();
    await waitFor(() => expect(container.querySelector(".onboarding")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("إخفاء"));
    expect(container.querySelector(".onboarding")).toBeNull();
  });

  it("does not send a non-admin to a page that will refuse them", async () => {
    get.mockResolvedValue(status());
    show("viewer");
    await waitFor(() => expect(screen.getByText("ربط حساب إعلانات Meta")).toBeTruthy());
    expect(screen.queryByText("إعداده الآن")).toBeNull();
    expect(screen.getByText("يحتاج إكمالها حساب مدير.")).toBeTruthy();
  });

  it("never breaks the page when the request fails", async () => {
    // A to-do list is not worth taking a dashboard down for.
    get.mockRejectedValue(new Error("network"));
    const { container } = show();
    await waitFor(() => expect(container.querySelector(".onboarding")).toBeNull());
  });
});
