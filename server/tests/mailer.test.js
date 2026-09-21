// Mailer is safe-by-default: no SMTP config => no-op (never throws), and
// sendOnce is idempotent per (kind, recipient, period) via ads_email_log.
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = [];
const state = { priorSent: [] };
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("from ads_email_log")) return state.priorSent;
    return {};
  }),
}));

// Toggle SMTP config per-test by mutating this object (config is read live).
const smtp = { host: "", port: 587, secure: false, user: "", pass: "", from: "" };
vi.mock("../src/config.js", () => ({ default: { get smtp() { return smtp; } } }));

const sendMailMock = vi.fn(async () => ({ messageId: "mid-1" }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: sendMailMock }) } }));

const { isConfigured, sendMail, sendOnce } = await import("../src/lib/mailer.js");

function configure() { Object.assign(smtp, { host: "smtp.co", user: "u", pass: "p", from: "from@co" }); }
function unconfigure() { Object.assign(smtp, { host: "", user: "", pass: "" }); }

beforeEach(() => { calls.length = 0; state.priorSent = []; sendMailMock.mockClear(); unconfigure(); });

describe("mailer", () => {
  it("isConfigured reflects host+user+pass presence", () => {
    expect(isConfigured()).toBe(false);
    configure();
    expect(isConfigured()).toBe(true);
  });

  it("sendMail is a no-op (skipped, no throw) when SMTP is unconfigured", async () => {
    const r = await sendMail({ to: "a@b.co", subject: "x", text: "y" });
    expect(r).toEqual({ skipped: true, reason: "smtp-not-configured" });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sendMail sends and returns a messageId when configured", async () => {
    configure();
    const r = await sendMail({ to: "a@b.co", subject: "x", text: "y" });
    expect(r.skipped).toBe(false);
    expect(sendMailMock).toHaveBeenCalledOnce();
  });

  it("sendOnce skips when disabled, regardless of SMTP", async () => {
    configure();
    const r = await sendOnce({ kind: "employee_weekly", to: "a@b.co", periodKey: "2026-W30", subject: "s", text: "t", enabled: false });
    expect(r).toMatchObject({ sent: false, skipped: true, reason: "sending-disabled" });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sendOnce skips a duplicate (already-sent) unless force", async () => {
    configure();
    state.priorSent = [{ status: "sent" }];
    const r = await sendOnce({ kind: "employee_weekly", to: "a@b.co", periodKey: "2026-W30", subject: "s", text: "t" });
    expect(r).toMatchObject({ sent: false, skipped: true, reason: "already-sent" });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sendOnce with force bypasses the dedup check and logs the send", async () => {
    configure();
    state.priorSent = [{ status: "sent" }];
    const r = await sendOnce({ kind: "employee_weekly", to: "a@b.co", periodKey: "2026-W30", subject: "s", text: "t", force: true });
    expect(r).toMatchObject({ sent: true });
    expect(sendMailMock).toHaveBeenCalledOnce();
    expect(calls.some((c) => c.sql.includes("insert into ads_email_log") && c.params.includes("sent"))).toBe(true);
  });

  it("sendOnce records status='error' and returns the error (never throws) on transport failure", async () => {
    configure();
    sendMailMock.mockRejectedValueOnce(new Error("smtp down"));
    const r = await sendOnce({ kind: "campaign_daily", to: "a@b.co", periodKey: "2026-07-20", subject: "s", text: "t" });
    expect(r).toMatchObject({ sent: false, error: "smtp down" });
    expect(calls.some((c) => c.sql.includes("insert into ads_email_log") && c.params.includes("error"))).toBe(true);
  });
});
