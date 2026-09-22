// "The connection test says fine, then saving fails."
//
// Two client-side defects produced that, independently of anything the server
// did. Both are pinned here because both are invisible in normal use: the
// wizard looks like it is working right up until the save is refused.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SetupApp from "../src/setup/SetupApp.jsx";

const status = {
  installed: false,
  steps: ["db", "meta", "wati", "ai", "business", "finish"],
  completedSteps: [], skippedSteps: [],
  requiredSteps: ["db", "finish"], skippable: ["meta", "wati", "ai", "business"],
  currentStep: "db", lockedByEnv: {}, claimed: null,
  saved: { mysql: null, meta: {}, wati: {}, ai: {}, data: {} },
  redirectUri: "https://example.com/api/meta/callback",
};

const calls = [];
let claimId = "";   // as on a fresh wizard: nothing claimed yet
const api = {
  status: vi.fn(async () => ({ status: 200, ok: true, data: status })),
  claim: vi.fn(async () => ({ status: 200, ok: true, data: { claimId: "c1" } })),
  test: vi.fn(async (step, body) => { calls.push(["test", step, body]); return { status: 200, ok: true, data: { ok: true } }; }),
  save: vi.fn(async (step, body) => { calls.push(["save", step, body]); return { status: 200, ok: true, data: { ok: true } }; }),
  migrate: vi.fn(async () => ({ status: 200, ok: true, data: { tables: ["a"] } })),
};
vi.mock("../src/setup/setupApi.js", () => ({
  default: new Proxy({}, { get: (_t, k) => (...a) => (api[k] ? api[k](...a) : Promise.resolve({ status: 200, ok: true, data: {} })) }),
  setInstallToken: () => {}, setClaimId: () => {}, getClaimId: () => claimId,
}));

beforeEach(() => { calls.length = 0; vi.clearAllMocks(); });

const saveButton = () => screen.getByText("حفظ ومتابعة");

describe("a passing test does not survive an edit to the form", () => {
  it("disables Save again as soon as any field changes", async () => {
    // The server re-validates on save, against the body sent AT SAVE TIME. So
    // "tested" has to mean "these exact values passed", not "this step passed
    // once". Only three of fifteen inputs used to reset it, which is why an
    // operator could test, adjust a field, save, and be refused.
    render(<SetupApp />);
    await screen.findByText("اختبار الاتصال");

    fireEvent.click(screen.getByText("اختبار الاتصال"));
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    // The host field, which the step ships with a default value for.
    fireEvent.change(screen.getByDisplayValue("127.0.0.1"), { target: { value: "db.internal" } });
    expect(saveButton().disabled).toBe(true);
  });
});

describe("the wizard does not proceed on an unverified claim", () => {
  it("stops and reports when claiming fails for a reason other than a conflict", async () => {
    // A 500, a 410 once installed, a proxy's 502 — all used to fall through to
    // "claimed" with no claim id, after which every request went out
    // unauthenticated while the wizard carried on as though it held the
    // installer.
    api.claim.mockResolvedValueOnce({ status: 500, ok: false, data: { ar: "انفجر الخادم", en: "server exploded" } });
    render(<SetupApp />);
    await screen.findByText("اختبار الاتصال");

    fireEvent.click(screen.getByText("اختبار الاتصال"));
    await waitFor(() => expect(screen.getByText(/server exploded|انفجر الخادم/)).toBeTruthy());
    expect(api.test).not.toHaveBeenCalled();
  });
});
