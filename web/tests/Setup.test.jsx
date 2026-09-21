// The wizard is the first thing a new installer ever sees, and the only screen
// that has to work on a machine where nothing is configured. These pin the
// behaviour that makes it usable: the gate, the test-before-save rule, and the
// fact that a failure explains itself.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const fetchMock = vi.fn();
global.fetch = fetchMock;

vi.mock("../src/api.js", () => ({
  setApiLang: () => {},
  default: { me: vi.fn(async () => ({ authed: false })), get: vi.fn(async () => ({})), logout: vi.fn() },
  api: { me: vi.fn(async () => ({ authed: false })), get: vi.fn(async () => ({})), logout: vi.fn() },
}));

const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

const NOT_INSTALLED = {
  installed: false,
  steps: ["db", "meta", "wati", "ai", "business", "finish"],
  completedSteps: [],
  currentStep: "db",
  lockedByEnv: { mysql: false },
  claimed: null,
  saved: { mysql: null, meta: {}, wati: {}, ai: {} },
  redirectUri: "http://localhost:3000/api/meta/callback",
};

beforeEach(() => { fetchMock.mockReset(); });
afterEach(() => { vi.resetModules(); });

describe("the setup gate in App.jsx", () => {
  it("shows the wizard when the app is not installed yet", async () => {
    fetchMock.mockResolvedValue(json(NOT_INSTALLED));
    const App = (await import("../src/App.jsx")).default;
    render(<MemoryRouter><App /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("تنصيب النظام")).toBeTruthy());
  });

  it("does not show the wizard once installed", async () => {
    fetchMock.mockResolvedValue(json({ installed: true }));
    const App = (await import("../src/App.jsx")).default;
    render(<MemoryRouter><App /></MemoryRouter>);
    await waitFor(() => expect(screen.queryByText("تنصيب النظام")).toBeNull());
  });

  it("assumes installed when the status check fails, rather than trapping users in setup", async () => {
    // A transient network blip must not present the installer to a working
    // production instance.
    fetchMock.mockRejectedValue(new Error("network"));
    const App = (await import("../src/App.jsx")).default;
    render(<MemoryRouter><App /></MemoryRouter>);
    await waitFor(() => expect(screen.queryByText("تنصيب النظام")).toBeNull());
  });

  it("checks setup before the kiosk bypass", async () => {
    // A wall display pointed at an uninstalled instance should say why, not
    // render a permanently broken board. Order is the guarantee, so assert it.
    const src = (await import("../src/App.jsx?raw")).default;
    expect(src.indexOf("installed === false")).toBeLessThan(src.indexOf('startsWith("/screen/")'));
  });
});

describe("the wizard itself", () => {
  const renderWizard = async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith("/api/setup/status")) return json(NOT_INSTALLED);
      return json({});
    });
    const SetupApp = (await import("../src/setup/SetupApp.jsx")).default;
    const r = render(<SetupApp />);
    await waitFor(() => expect(screen.getByText("تنصيب النظام")).toBeTruthy());
    return r;
  };

  it("lists all six steps and starts on the database", async () => {
    await renderWizard();
    for (const s of ["قاعدة البيانات", "حساب إعلانات Meta", "واتساب عبر Wati",
                     "الذكاء الاصطناعي", "تعريف النشاط", "الحساب والبيانات"]) {
      expect(screen.getAllByText(s).length).toBeGreaterThan(0);
    }
  });

  it("will not let a step be saved before its connection test passes", async () => {
    await renderWizard();
    const save = screen.getByText("حفظ ومتابعة").closest("button");
    expect(save.disabled).toBe(true);
    expect(screen.getByText("اختبر الاتصال بنجاح أولاً")).toBeTruthy();
  });

  it("enables saving once the test succeeds", async () => {
    await renderWizard();
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith("/api/setup/status")) return json(NOT_INSTALLED);
      if (u.endsWith("/api/setup/claim")) return json({ ok: true, claimId: "c1" });
      if (u.endsWith("/api/setup/db/test")) return json({ ok: true, details: { version: "8.0.36" } });
      return json({});
    });
    fireEvent.click(screen.getByText("اختبار الاتصال"));
    await waitFor(() => expect(screen.getByText("نجح الاتصال")).toBeTruthy());
    expect(screen.getByText("حفظ ومتابعة").closest("button").disabled).toBe(false);
  });

  it("renders the failure guidance, not a raw error code", async () => {
    await renderWizard();
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith("/api/setup/status")) return json(NOT_INSTALLED);
      if (u.endsWith("/api/setup/claim")) return json({ ok: true, claimId: "c1" });
      if (u.endsWith("/api/setup/db/test")) {
        return json({ ok: false, code: "DB_NO_DATABASE", ar: "قاعدة البيانات غير موجودة.",
          en: "That database does not exist.", action: "create_database" }, 400);
      }
      return json({});
    });
    fireEvent.click(screen.getByText("اختبار الاتصال"));
    await waitFor(() => expect(screen.getByText("قاعدة البيانات غير موجودة.")).toBeTruthy());
    // ...and the fix is offered as a button rather than described in prose.
    expect(screen.getByText("أنشئ قاعدة البيانات لي")).toBeTruthy();
    expect(screen.getByText("حفظ ومتابعة").closest("button").disabled).toBe(true);
  });

  it("explains where each credential comes from, in the field itself", async () => {
    await renderWizard();
    const toggles = screen.getAllByText("من أين أحصل على هذا؟");
    expect(toggles.length).toBeGreaterThan(0);
    fireEvent.click(toggles[0]);
    // The host field's guidance must name the Docker trap, which is the single
    // most common first-install failure.
    await waitFor(() => expect(screen.getByText(/Docker/)).toBeTruthy());
  });

  it("switches the whole wizard to English", async () => {
    await renderWizard();
    fireEvent.click(screen.getByText("English"));
    await waitFor(() => expect(screen.getByText("Installation")).toBeTruthy());
    expect(screen.getByText("Test connection")).toBeTruthy();
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("asks for the install token when the server refuses a remote claim", async () => {
    await renderWizard();
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith("/api/setup/status")) return json(NOT_INSTALLED);
      if (u.endsWith("/api/setup/claim")) return json({ error: "setup_token_required" }, 401);
      return json({});
    });
    fireEvent.click(screen.getByText("اختبار الاتصال"));
    await waitFor(() => expect(screen.getByText("مطلوب رمز التنصيب")).toBeTruthy());
  });
});

describe("the help content", () => {
  it("covers every credential the wizard asks for, in both languages", async () => {
    const { HELP } = await import("../src/setup/setupHelp.js");
    for (const key of [
      "db.host", "db.user", "db.database",
      "meta.appId", "meta.appSecret", "meta.token", "meta.accountId",
      "wati.endpoint", "wati.token",
      "ai.apiKey", "business.websiteUrl", "business.description",
      "admin.email", "admin.password",
    ]) {
      const h = HELP[key];
      expect(h, `missing help for ${key}`).toBeTruthy();
      for (const lang of ["ar", "en"]) {
        expect(h[lang].label, `${key}.${lang} label`).toBeTruthy();
        expect(h[lang].why, `${key}.${lang} why`).toBeTruthy();
        expect(h[lang].steps?.length, `${key}.${lang} steps`).toBeGreaterThan(0);
      }
    }
  });

  it("marks every credential field as secret, so none is rendered in plain text", async () => {
    const { HELP } = await import("../src/setup/setupHelp.js");
    for (const key of ["meta.appSecret", "meta.token", "wati.token", "ai.apiKey", "admin.password"]) {
      expect(HELP[key].ar.secret, `${key} should be secret`).toBe(true);
    }
  });
});
