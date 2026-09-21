// REG-102 — two rows sharing the same ad_name (a very common real case: many
// contacts attributed to the same ad) used to freeze re-sorting/filtering,
// because rows were keyed by a non-unique field, so React's reconciliation
// collapsed/confused the duplicate-keyed elements and the UI stopped
// reflecting state changes for them. Fixed by keying on `wa_id ?? id ?? index`
// in DataTable.jsx. This test guards that fix.
import { describe, it, expect } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import DataTable from "../src/components/DataTable.jsx";
import { I18nProvider } from "../src/i18n.jsx";

// DataTable now consumes the i18n context, so every render needs the provider.
const render = (ui) => rtlRender(<I18nProvider>{ui}</I18nProvider>);

const columns = [
  { key: "ad_name", label: "Ad" },
  { key: "contacts", label: "Contacts", num: true },
];
const rows = [
  { id: "a1", ad_name: "Same Ad", contacts: 10 },
  { id: "a2", ad_name: "Same Ad", contacts: 50 },
];

describe("REG-102: DataTable keeps rows distinct when ad_name repeats across rows", () => {
  it("renders both rows even though their ad_name is identical", () => {
    render(<DataTable columns={columns} rows={rows} />);
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("re-sorts on header click instead of freezing", () => {
    render(<DataTable columns={columns} rows={rows} />);
    const header = screen.getByText(/Contacts/);

    fireEvent.click(header); // first click -> desc
    let dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0].textContent).toContain("50");
    expect(dataRows[1].textContent).toContain("10");

    fireEvent.click(header); // second click -> toggles to asc
    dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0].textContent).toContain("10");
    expect(dataRows[1].textContent).toContain("50");
  });

  it("filters correctly when the filtered column value is identical across rows", () => {
    render(<DataTable columns={columns} rows={rows} />);
    fireEvent.click(screen.getByText("🔎 فلاتر الأعمدة"));
    const filterInput = screen.getByPlaceholderText("≥ / <n / a-b");
    fireEvent.change(filterInput, { target: { value: ">20" } });

    const dataRows = screen.getAllByRole("row").slice(2); // header + filter-row
    expect(dataRows).toHaveLength(1);
    expect(dataRows[0].textContent).toContain("50");
  });
});

describe("wide tables", () => {
  it("opts into the compact rhythm only when asked", () => {
    const { container, rerender } = render(<DataTable columns={columns} rows={rows} />);
    expect(container.querySelector(".scroll.scroll-wide")).toBeNull();
    rerender(<I18nProvider><DataTable columns={columns} rows={rows} wide /></I18nProvider>);
    expect(container.querySelector(".scroll.scroll-wide")).toBeTruthy();
  });

  it("lets a column widen its own filter — the Ads name column also matches the id", () => {
    const cols = [
      { key: "ad_name", label: "Ad", match: (f, r) => `${r.ad_name} ${r.id}`.toLowerCase().includes(f.toLowerCase()) },
      columns[1],
    ];
    render(<DataTable columns={cols} rows={rows} wide />);
    fireEvent.click(screen.getByText("🔎 فلاتر الأعمدة"));
    fireEvent.change(screen.getByPlaceholderText("بحث"), { target: { value: "a2" } });

    const dataRows = screen.getAllByRole("row").slice(2);
    expect(dataRows).toHaveLength(1);
    expect(dataRows[0].textContent).toContain("50");   // matched on id, not name
  });
});
