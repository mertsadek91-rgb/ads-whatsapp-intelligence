// Data-sync controls. The `compact` variant lives in the app bar, so it must
// stay on one line: short labels, one status chip, no full-width buttons.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import UpdateControls from "../src/components/UpdateControls.jsx";
import { I18nProvider } from "../src/i18n.jsx";

const get = vi.fn(async () => ({ wati: null, meta: null }));
const post = vi.fn(async () => ({}));
vi.mock("../src/api.js", () => ({ setApiLang: () => {},
  default: { get: (...a) => get(...a), post: (...a) => post(...a) } }));

const setup = (props) => render(<I18nProvider><UpdateControls {...props} /></I18nProvider>);

beforeEach(() => { get.mockClear(); post.mockClear(); get.mockResolvedValue({ wati: null, meta: null }); });

describe("compact (app bar) variant", () => {
  it("renders two short-labelled buttons and no sidebar box", () => {
    const { container } = setup({ compact: true });
    expect(container.querySelector(".sync-inline")).toBeTruthy();
    expect(container.querySelector(".update-box")).toBeNull();
    const labels = [...container.querySelectorAll(".sync-inline .btn")].map((b) => b.textContent.trim());
    expect(labels).toEqual(["واتساب", "Meta"]);
  });

  it("triggers the sync and disables the button while it runs", async () => {
    const { container } = setup({ compact: true });
    await waitFor(() => expect(get).toHaveBeenCalled());   // let the mount poll settle first
    fireEvent.click(screen.getByTitle("تحديث واتساب"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/admin/update-wati"));
    const [wati] = container.querySelectorAll(".sync-inline .btn");
    expect(wati.disabled).toBe(true);
    expect(wati.querySelector("svg").getAttribute("class")).toBe("spin");
  });

  it("shows a single status chip — the WhatsApp job wins over Meta", async () => {
    get.mockResolvedValue({
      wati: { state: "done", result: { kept: 12, scanned: 40 } },
      meta: { state: "done", result: { ads: 3, daily: 7 } },
    });
    const { container } = setup({ compact: true });
    await waitFor(() => expect(container.querySelectorAll(".sync-status")).toHaveLength(1));
    expect(container.querySelector(".sync-status").textContent).toContain("12");
  });
});

describe("default (stacked) variant", () => {
  it("still renders the titled box with full-width rows", () => {
    const { container } = setup();
    expect(container.querySelector(".update-box")).toBeTruthy();
    expect(container.querySelector(".sync-inline")).toBeNull();
    expect(container.querySelectorAll(".update-row")).toHaveLength(2);
  });
});
