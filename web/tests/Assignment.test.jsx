// Assignment page selection logic. This is what will gate the bulk writes to
// Wati in the next batch, so the rules are pinned: selection must survive
// paging but reset on a filter change (otherwise you'd act on rows you can no
// longer see), and "select all matching" must pull ids from the server.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Assignment from "../src/pages/Assignment.jsx";
import { I18nProvider } from "../src/i18n.jsx";

const rows = (n, off = 0) => Array.from({ length: n }, (_, i) => ({
  wa_id: `wa${off + i}`, full_name: `C${off + i}`, phone: `9715000000${off + i}`,
  contact_owner: i % 2 ? "Omar" : null, country_iso2: "AE", flag: "🇦🇪",
  contacted: i % 2 === 0, unassigned: !(i % 2), num_messages: 3, msg_unavailable: 0,
}));

const get = vi.fn();
vi.mock("../src/api.js", () => ({ setApiLang: () => {}, api: { get: (...a) => get(...a) },
  default: { get: (...a) => get(...a) } }));

const FACETS = { counts: { total: 8753, unassigned: 3585, bot: 94 },
  countries: [{ iso2: "AE", n: 12, flag: "🇦🇪", ar: "الإمارات", en: "UAE" }],
  owners: [{ owner: "Omar", n: 5 }], campaigns: [], employees: [] };

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (url) => {
    if (url.startsWith("/assignment/facets")) return FACETS;
    if (url.startsWith("/assignment/contacts/ids")) return { ids: ["wa0", "wa1", "wa99"], capped: false };
    return { total: 120, limit: 50, offset: 0, rows: rows(3) };
  });
});

const setup = () => render(<I18nProvider><Assignment /></I18nProvider>);
const cbs = (c) => [...c.querySelectorAll('tbody input[type="checkbox"]')];

describe("selection", () => {
  it("selects and clears an individual row", async () => {
    const { container } = setup();
    await waitFor(() => expect(cbs(container).length).toBe(3));
    fireEvent.click(cbs(container)[0]);
    expect(await screen.findByText(/محدَّد/)).toBeTruthy();
    expect(cbs(container)[0].checked).toBe(true);
    fireEvent.click(cbs(container)[0]);
    expect(cbs(container)[0].checked).toBe(false);
  });

  it("the header checkbox toggles the whole page at once", async () => {
    const { container } = setup();
    await waitFor(() => expect(cbs(container).length).toBe(3));
    const head = container.querySelector('thead input[type="checkbox"]');
    fireEvent.click(head);
    expect(cbs(container).every((c) => c.checked)).toBe(true);
    fireEvent.click(head);
    expect(cbs(container).some((c) => c.checked)).toBe(false);
  });

  it("'select all results' takes the ids from the server, beyond the current page", async () => {
    const { container } = setup();
    await waitFor(() => expect(cbs(container).length).toBe(3));
    fireEvent.click(screen.getByText(/تحديد كل النتائج/));
    // 3 server ids selected even though only 3 rows (one id isn't on this page)
    await waitFor(() => expect(screen.getByText(/محدَّد/).textContent).toMatch(/3/));
    expect(get).toHaveBeenCalledWith(expect.stringContaining("/assignment/contacts/ids"));
  });

  it("resets the selection when a filter changes (never act on hidden rows)", async () => {
    const { container } = setup();
    await waitFor(() => expect(cbs(container).length).toBe(3));
    fireEvent.click(cbs(container)[0]);
    expect(screen.queryByText(/محدَّد/)).toBeTruthy();

    fireEvent.change(container.querySelectorAll("select")[0], { target: { value: "__unassigned__" } });
    await waitFor(() => expect(screen.queryByText(/محدَّد/)).toBeNull());
  });
});

describe("deep link from the coverage-gap alert", () => {
  it("starts pre-filtered when the URL carries a filter", async () => {
    window.history.pushState({}, "", "/assignment?owner=__unhandled__&country=SA");
    try {
      setup();
      await waitFor(() => expect(get).toHaveBeenCalledWith(
        expect.stringMatching(/owner=__unhandled__.*country=SA|country=SA.*owner=__unhandled__/)));
    } finally { window.history.pushState({}, "", "/"); }
  });
});

describe("filters and paging", () => {
  it("sends the chosen filter to the API", async () => {
    const { container } = setup();
    await waitFor(() => expect(cbs(container).length).toBe(3));
    fireEvent.change(container.querySelectorAll("select")[1], { target: { value: "AE" } });
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining("country=AE")));
  });

  it("pages forward with an offset and keeps the selection", async () => {
    const { container } = setup();
    await waitFor(() => expect(cbs(container).length).toBe(3));
    fireEvent.click(cbs(container)[0]);
    fireEvent.click(screen.getByText("التالي"));
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining("offset=50")));
    expect(screen.queryByText(/محدَّد/)).toBeTruthy();   // selection survives paging
  });
});
