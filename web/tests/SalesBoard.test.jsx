// The daily-trend chart rendered every bar at the same height on the sales-floor
// screen: the bars' percentage heights had no parent with a definite height to
// resolve against, so each one fell back to its min-height. The CSS fix can't be
// asserted in jsdom (no layout), but the contract it depends on can: one bar per
// day, each carrying its own height percentage on a 0–100 axis, and a target
// line the bars are measured against.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import SalesBoard from "../src/components/SalesBoard.jsx";
import { I18nProvider } from "../src/i18n.jsx";

const data = {
  target: 90,
  totals: { leads: 377, contacted: 279, contact_rate_pct: 74, not_contacted: 98, interested: 4 },
  window: { since: "2026-07-22", until: "2026-07-28" },
  rows: [],
  daily: [
    { date: "2026-07-22", rate: 70.7 }, { date: "2026-07-23", rate: 59.7 },
    { date: "2026-07-24", rate: 66 }, { date: "2026-07-25", rate: 79.2 },
    { date: "2026-07-26", rate: 93.1 }, { date: "2026-07-27", rate: 77 },
    { date: "2026-07-28", rate: 68 },
  ],
};
const setup = () => render(<I18nProvider><SalesBoard data={data} lang="en" /></I18nProvider>);

describe("daily performance trend", () => {
  it("gives every day its own bar height instead of one flat level", () => {
    const { container } = setup();
    const heights = [...container.querySelectorAll(".bar-plot .bar")].map((b) => b.style.height);
    expect(heights).toEqual(["70.7%", "59.7%", "66%", "79.2%", "93.1%", "77%", "68%"]);
    expect(new Set(heights).size).toBe(7);
  });

  it("puts the bars in a fixed-height plot — the box their percentage resolves against", () => {
    const { container } = setup();
    expect(container.querySelector(".bar-plot")).toBeTruthy();
    expect(container.querySelectorAll(".bar-plot .bar-col")).toHaveLength(7);
    expect(container.querySelectorAll(".bar-labels .bar-label")).toHaveLength(7);
  });

  it("draws the target line at the target and greens only the days that clear it", () => {
    const { container } = setup();
    expect(container.querySelector(".bar-target").style.bottom).toBe("90%");
    const ok = [...container.querySelectorAll(".bar")].filter((b) => b.classList.contains("ok"));
    expect(ok).toHaveLength(1);
    expect(ok[0].style.height).toBe("93.1%");
  });

  it("keeps a zero-rate day visible rather than invisible", () => {
    const { container } = render(
      <I18nProvider><SalesBoard data={{ ...data, daily: [{ date: "2026-07-22", rate: 0 }] }} lang="en" /></I18nProvider>);
    expect(container.querySelector(".bar").style.height).toBe("3%");
  });
});
