// The contact list said "1 message" and the conversation said "no messages".
//
// Both numbers came from the same getMessages payload, read by two functions
// that counted different things: firstResponse counted every item, getThread
// kept only real messages. Wati returns ticket events, assignment events and
// system notices in that same array — so a contact whose only item was a system
// event was recorded as having one message and displayed as having none, which
// reads as a broken import.
import { describe, it, expect, vi, beforeEach } from "vitest";

let payload = {};
vi.mock("axios", () => ({
  default: { create: () => ({ get: vi.fn(async () => ({ data: payload })), post: vi.fn() }) },
}));
vi.mock("../src/config.js", () => ({
  default: { wati: { endpoint: "https://x.wati.io/1", token: "t" } },
}));

const wati = await import("../src/lib/wati.js");

const msg = (over = {}) => ({ owner: false, text: "مرحبا", created: "2026-06-11T10:00:00Z", type: "text", ...over });

beforeEach(() => { payload = {}; });

describe("what counts as a message", () => {
  it("agrees between the counter and the reader", async () => {
    payload = { messages: { items: [
      msg(),
      msg({ owner: true, text: "أهلاً", created: "2026-06-11T10:05:00Z" }),
      { eventType: "ticket", owner: false, text: "ticket opened", created: "2026-06-11T09:00:00Z" },
      { owner: null, text: "system", created: "2026-06-11T09:00:00Z" },
      msg({ text: "" }),                       // no body at all
    ] } };

    const counted = await wati.firstResponse("971500000000");
    const thread = await wati.getThread("971500000000");
    expect(counted.n).toBe(thread.length);
    expect(counted.n).toBe(2);
  });

  it("reports one item that is only a system event as no messages, not one", async () => {
    // Exactly the contact from the report: "1 رسالة" beside "لا رسائل".
    payload = { messages: { items: [
      { eventType: "ticket", owner: false, text: "conversation opened", created: "2026-06-11T09:00:00Z" },
    ] } };
    expect((await wati.firstResponse("971500000000")).n).toBe(0);
    expect(await wati.getThread("971500000000")).toHaveLength(0);
  });

  it("still counts a non-text message, which has no body but is a real message", async () => {
    payload = { messages: { items: [msg({ type: "image", text: "" })] } };
    expect((await wati.firstResponse("971500000000")).n).toBe(1);
    const thread = await wati.getThread("971500000000");
    expect(thread).toHaveLength(1);
    expect(thread[0].body).toBe("[image]");
  });

  it("still measures the first response from real messages only", async () => {
    payload = { messages: { items: [
      { eventType: "ticket", owner: true, created: "2026-06-11T09:00:00Z", text: "x" },
      msg({ created: "2026-06-11T10:00:00Z" }),
      msg({ owner: true, text: "رد", created: "2026-06-11T10:30:00Z" }),
    ] } };
    const r = await wati.firstResponse("971500000000");
    expect(r.answered).toBe(true);
    expect(r.fr).toBe(30);   // the ticket event must not be read as the reply
  });
});
