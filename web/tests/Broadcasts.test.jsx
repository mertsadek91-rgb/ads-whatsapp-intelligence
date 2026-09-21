// The wizard is what gates a real outbound send, so its guard rails are
// pinned here: the Send button stays disabled until the master switch is on
// AND the campaign name is retyped exactly, and /execute is never called by
// merely walking the wizard or opening the review step.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Broadcasts from "../src/pages/Broadcasts.jsx";
import { I18nProvider } from "../src/i18n.jsx";

const get = vi.fn();
const post = vi.fn();
vi.mock("../src/api.js", () => ({
  setApiLang: () => {},
  api: { get: (...a) => get(...a), post: (...a) => post(...a) },
  default: { get: (...a) => get(...a), post: (...a) => post(...a) },
}));

const FACETS = {
  countries: [{ iso2: "AE", n: 12, flag: "🇦🇪", ar: "الإمارات", en: "UAE" }],
  owners: [{ owner: "Omar", n: 5 }],
  campaigns: [{ id: "c1", name: "Gold Promo", n: 4 }],
  stages: [{ stage: "qualified", n: 9 }],
  channels: [{ ch: "971561178629", n: 40 }],
  categories: [],
};
const TEMPLATE = {
  name: "callback_requested_english", category: "MARKETING", status: "APPROVED",
  body: "Hi {{name}}, following up on your request.", footer: null, vars: ["name"],
};
const AUDIENCE = { total_matching: 10, eligible: 8, excluded_opted_out: 2, by_country: [{ iso2: "AE", n: 8 }], sample: [] };

beforeEach(() => {
  get.mockReset(); post.mockReset();
  get.mockImplementation(async (url) => {
    if (url.startsWith("/broadcasts/enabled")) return { enabled: false };
    if (url.startsWith("/broadcasts/facets")) return FACETS;
    if (url.startsWith("/broadcasts/templates")) return { templates: [TEMPLATE] };
    if (url.startsWith("/tags/catalog")) return { categories: [] };
    if (url.startsWith("/broadcasts/runs")) return { runs: [] };
    return {};
  });
  post.mockImplementation(async (url, body) => {
    if (url === "/broadcasts/enabled") return { enabled: !!body.enabled };
    if (url === "/broadcasts/audience/preview") return AUDIENCE;
    if (url === "/broadcasts/preview") return { audience: AUDIENCE, template: TEMPLATE, send_enabled: false };
    if (url === "/broadcasts/execute") return { runId: 1, total: 8, sent: 8, failed: 0, skipped: 0 };
    return {};
  });
});

const setup = () => render(<I18nProvider><Broadcasts /></I18nProvider>);

async function walkToAudience() {
  const utils = setup();
  fireEvent.change(screen.getByPlaceholderText(/تذكير ندوة أغسطس/), { target: { value: "My Promo" } });
  fireEvent.click(screen.getByText(/التالي/));
  await waitFor(() => expect(screen.getByText(/القناة \(رقم/)).toBeTruthy());
  fireEvent.click(await screen.findByText(/\+971561178629/));
  fireEvent.click(screen.getByText(/التالي/));
  await waitFor(() => expect(screen.getByText("callback_requested_english")).toBeTruthy());
  fireEvent.click(screen.getByText("callback_requested_english"));
  fireEvent.click(screen.getByText(/التالي/));
  await waitFor(() => expect(screen.getByText(/مطابقون للفلتر/)).toBeTruthy());
  return utils;
}

describe("step 0 — name", () => {
  it("keeps Next disabled until a name is entered", async () => {
    setup();
    const next = await screen.findByText("التالي");
    expect(next).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/تذكير ندوة أغسطس/), { target: { value: "Promo" } });
    expect(next).not.toBeDisabled();
  });
});

describe("wizard flow", () => {
  it("carries the picked channel + template into the audience step and shows the live count", async () => {
    const { container } = await walkToAudience();
    await waitFor(() => expect(container.querySelector(".val.good")?.textContent).toBe("8")); // eligible KPI
    expect(post).toHaveBeenCalledWith("/broadcasts/audience/preview", expect.objectContaining({
      filter: expect.objectContaining({ channel: "971561178629" }),
    }));
  });

  it("reaches the review step via /preview without ever calling /execute", async () => {
    await walkToAudience();
    fireEvent.click(screen.getByText(/معاينة الحملة/));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/broadcasts/preview", expect.objectContaining({ templateName: "callback_requested_english" })));
    expect(await screen.findByText(/سيصل القالب إلى/)).toBeTruthy();
    expect(post).not.toHaveBeenCalledWith("/broadcasts/execute", expect.anything());
  });
});

describe("send safety gate", () => {
  it("disables Send until the master switch is on AND the name is retyped exactly", async () => {
    await walkToAudience();
    fireEvent.click(screen.getByText(/معاينة الحملة/));
    const sendBtn = await screen.findByText(/تنفيذ الإرسال إلى/);
    expect(sendBtn.closest("button")).toBeDisabled(); // switch is off

    // retype the name with the switch still off — still disabled
    const inputs = screen.getAllByRole("textbox");
    const confirmInput = inputs[inputs.length - 1];
    fireEvent.change(confirmInput, { target: { value: "My Promo" } });
    expect(sendBtn.closest("button")).toBeDisabled();
  });

  it("arms Send only once the switch is on and the retyped text matches exactly", async () => {
    get.mockImplementation(async (url) => {
      if (url.startsWith("/broadcasts/enabled")) return { enabled: true };
      if (url.startsWith("/broadcasts/facets")) return FACETS;
      if (url.startsWith("/broadcasts/templates")) return { templates: [TEMPLATE] };
      if (url.startsWith("/tags/catalog")) return { categories: [] };
      return {};
    });
    await walkToAudience();
    fireEvent.click(screen.getByText(/معاينة الحملة/));
    const sendBtn = await screen.findByText(/تنفيذ الإرسال إلى/);
    expect(sendBtn.closest("button")).toBeDisabled(); // name not retyped yet

    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[inputs.length - 1], { target: { value: "My Promo" } });
    await waitFor(() => expect(sendBtn.closest("button")).not.toBeDisabled());

    fireEvent.click(sendBtn);
    await waitFor(() => expect(post).toHaveBeenCalledWith("/broadcasts/execute", expect.objectContaining({ confirm: true })));
  });
});

describe("master switch", () => {
  it("posts the toggle and reflects the server's echoed state", async () => {
    setup();
    const checkbox = await screen.findByRole("checkbox");
    fireEvent.click(checkbox);
    await waitFor(() => expect(post).toHaveBeenCalledWith("/broadcasts/enabled", { enabled: true }));
  });
});
