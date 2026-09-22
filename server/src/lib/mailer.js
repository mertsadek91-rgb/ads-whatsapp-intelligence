// Outbound email for the nightly report pipeline. Deliberately safe-by-default:
// when SMTP is not configured (no host/user/pass) the mailer is a no-op that
// returns {skipped:true} instead of throwing, so the whole app — and the
// nightly job — runs identically with email simply turned off. A separate
// master switch (ads_settings.reports_email_enabled) gates ACTUAL sending on
// top of this; see routes/settings.js and jobs/nightlyReports.js.
import config from "../config.js";
import { query } from "../db.js";
import { onConfigChange } from "./appConfig.js";

let transporterPromise = null;

// Drop the memoised transporter whenever configuration is re-hydrated, or a
// change to the SMTP host/credentials would keep sending through the old
// server until the process restarted.
onConfigChange(() => { transporterPromise = null; });

export function isConfigured() {
  const s = config.smtp;
  return !!(s.host && s.user && s.pass);
}

async function getTransporter() {
  if (transporterPromise) return transporterPromise;
  const { default: nodemailer } = await import("nodemailer");
  const s = config.smtp;
  transporterPromise = Promise.resolve(nodemailer.createTransport({
    host: s.host, port: s.port, secure: s.secure,
    auth: { user: s.user, pass: s.pass },
  }));
  return transporterPromise;
}

/**
 * Send one email. Returns {skipped, reason} when SMTP is unconfigured (never
 * throws for that); a real transport error rejects so the caller can log it.
 * @param {{to:string, cc?:string|string[], subject:string, text:string, html?:string, attachments?:Array}} msg
 */
export async function sendMail({ to, cc, subject, text, html, attachments }) {
  if (!isConfigured()) return { skipped: true, reason: "smtp-not-configured" };
  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: config.smtp.from, to, cc, subject, text, html, attachments,
  });
  return { skipped: false, messageId: info.messageId };
}

/**
 * Idempotent send: skips if this exact (kind, recipient, period_key) was
 * already sent, unless force. Records the outcome in ads_email_log. Returns
 * {sent, skipped, reason, error}. Never throws — a failed send is logged as
 * status='error' and reported back so the pipeline can continue to the next
 * recipient instead of aborting the whole run.
 */
export async function sendOnce({ kind, to, periodKey, cc, subject, text, html, attachments, force = false, enabled = true }) {
  if (!enabled) return { sent: false, skipped: true, reason: "sending-disabled" };
  if (!isConfigured()) return { sent: false, skipped: true, reason: "smtp-not-configured" };

  if (!force) {
    const prior = await query(
      "select status from ads_email_log where kind=? and recipient=? and period_key=? and status='sent' limit 1",
      [kind, to, periodKey]);
    if (prior.length) return { sent: false, skipped: true, reason: "already-sent" };
  }

  try {
    const r = await sendMail({ to, cc, subject, text, html, attachments });
    if (r.skipped) return { sent: false, skipped: true, reason: r.reason };
    await logEmail(kind, to, periodKey, "sent", null);
    return { sent: true, skipped: false };
  } catch (e) {
    await logEmail(kind, to, periodKey, "error", e.message).catch(() => {});
    return { sent: false, skipped: false, error: e.message };
  }
}

async function logEmail(kind, recipient, periodKey, status, error) {
  await query(
    `insert into ads_email_log (kind, recipient, period_key, status, error) values (?,?,?,?,?) on duplicate key update status=values(status), error=values(error), sent_at=now()`,
    [kind, recipient, periodKey, status, error]);
}

export default { isConfigured, sendMail, sendOnce };
