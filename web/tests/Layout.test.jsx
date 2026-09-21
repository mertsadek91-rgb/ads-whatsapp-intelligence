// App shell (DashSpace-style layout): grouped icon sidebar, sticky app bar,
// and the mobile drawer. The authenticated shell can't be reached in the
// browser without a session, so its structure and behaviour are pinned here.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Layout from "../src/components/Layout.jsx";
import { I18nProvider } from "../src/i18n.jsx";
import { CurrencyProvider } from "../src/currency.jsx";

// UpdateControls polls the API on mount; stub it — this test is about the shell.
vi.mock("../src/components/UpdateControls.jsx", () => ({ default: () => <div data-testid="update-controls" /> }));
vi.mock("../src/api.js", () => ({ setApiLang: () => {},
  default: { logout: vi.fn(async () => {}), get: vi.fn(async () => ({})) },
  api: { logout: vi.fn(async () => {}), get: vi.fn(async () => ({})) } }));

const setup = () => render(
  <MemoryRouter initialEntries={["/"]}>
    <I18nProvider><CurrencyProvider><Layout onLogout={() => {}} /></CurrencyProvider></I18nProvider>
  </MemoryRouter>
);

describe("app shell structure", () => {
  it("renders the brand, every nav group, and every destination exactly once", () => {
    const { container } = setup();
    expect(container.querySelector(".brand-mark")).toBeTruthy();
    const groups = [...container.querySelectorAll(".nav-group-title")].map((e) => e.textContent);
    expect(groups).toEqual(["عام", "الإعلانات", "العملاء", "الفريق", "النظام"]);
    const hrefs = [...container.querySelectorAll(".nav a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/assignment");
    expect(new Set(hrefs).size).toBe(hrefs.length);   // no duplicate destinations
    expect(hrefs.length).toBeGreaterThanOrEqual(16);
  });

  it("gives every nav link an icon (no unlabelled rows)", () => {
    const { container } = setup();
    for (const a of container.querySelectorAll(".nav a")) {
      expect(a.querySelector("svg")).toBeTruthy();
      expect(a.textContent.trim().length).toBeGreaterThan(0);
    }
  });

  it("marks the dashboard link active on / and does not also activate others", () => {
    const { container } = setup();
    const active = [...container.querySelectorAll(".nav a.active")];
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute("href")).toBe("/");
  });

  it("puts the language + currency switchers and logout in the app bar", () => {
    const { container } = setup();
    const bar = container.querySelector(".appbar");
    expect(bar).toBeTruthy();
    expect(bar.querySelector(".currency-switch")).toBeTruthy();
    expect(within(bar).getByText("EN")).toBeTruthy();          // AR default -> offers EN
    expect(within(bar).getByText("تسجيل الخروج")).toBeTruthy();
  });

  it("puts the data-sync controls in the app bar, not the sidebar", () => {
    const { container } = setup();
    expect(container.querySelector(".appbar [data-testid=update-controls]")).toBeTruthy();
    expect(container.querySelector(".sidebar [data-testid=update-controls]")).toBeNull();
    expect(container.querySelector(".sidebar-foot")).toBeNull();
  });
});

describe("mobile drawer", () => {
  it("is closed initially and toggles open from the hamburger", () => {
    const { container } = setup();
    const sidebar = container.querySelector(".sidebar");
    const burger = container.querySelector(".hamburger");
    expect(sidebar.className).not.toContain("open");
    expect(burger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(burger);
    expect(container.querySelector(".sidebar").className).toContain("open");
    expect(container.querySelector(".hamburger").getAttribute("aria-expanded")).toBe("true");
  });

  it("closes when the backdrop is clicked", () => {
    const { container } = setup();
    fireEvent.click(container.querySelector(".hamburger"));
    expect(container.querySelector(".drawer-backdrop").className).toContain("show");
    fireEvent.click(container.querySelector(".drawer-backdrop"));
    expect(container.querySelector(".sidebar").className).not.toContain("open");
  });
});

describe("bilingual shell", () => {
  it("switches the whole nav to English and flips the switcher label", () => {
    const { container } = setup();
    fireEvent.click(screen.getByText("EN"));
    const groups = [...container.querySelectorAll(".nav-group-title")].map((e) => e.textContent);
    expect(groups).toEqual(["General", "Ads", "Leads", "Team", "System"]);
    expect(screen.getByText("Dashboard")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("عربي")).toBeTruthy();   // now offers Arabic back
  });
});
