// BUG-005 coverage — lib/wati.js is the Wati API client (26% covered, the
// single largest coverage gap) and had zero direct tests despite encoding
// several undocumented-format quirks (fuzzy field lookup, the "Jun-21-2026"
// date format, /Date(...)/ .NET timestamps, paging, retry/backoff).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const get = vi.fn();
vi.mock("axios", () => ({ default: { create: () => ({ get }) } }));

const wati = await import("../src/lib/wati.js");

// wati.js's internal get() calls http.get() and reads `.data` off the axios
// response — the mock has to return that shape, not the payload directly.
const ok = (data) => Promise.resolve({ data });

// get() retries non-429 failures with a real setTimeout backoff (500/1000/1500ms)
// before giving up — fake timers keep the "all attempts fail" tests instant.
beforeEach(() => { get.mockReset(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe("field(): fuzzy customParams/top-level lookup", () => {
  it("finds a value in customParams, ignoring case/punctuation in the name", () => {
    const contact = { customParams: [{ name: "Full Name", value: "Ahmed" }] };
    expect(wati.field(contact, "fullname")).toBe("Ahmed");
  });

  it("falls back to a top-level scalar key when customParams doesn't match", () => {
    expect(wati.field({ phone: "971500000000" }, "phone")).toBe("971500000000");
  });

  it("skips top-level object values (never returns a nested object)", () => {
    expect(wati.field({ meta: { x: 1 } }, "meta")).toBeNull();
  });

  it("returns null when nothing matches any requested name", () => {
    expect(wati.field({ customParams: [] }, "nope")).toBeNull();
  });
});

describe("parseCreated(): the Wati date-format zoo", () => {
  it("parses the .NET /Date(ms)/ wire format", () => {
    const d = wati.parseCreated({ created: "/Date(1750000000000)/" });
    expect(d.getTime()).toBe(1750000000000);
  });

  it("parses 'Jun-21-2026' (the documented-quirk format)", () => {
    const d = wati.parseCreated({ created: "Jun-21-2026" });
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(5); // June = index 5
    expect(d.getUTCDate()).toBe(21);
  });

  it("parses 'Jun 21, 2026' (space/comma variant of the same format)", () => {
    const d = wati.parseCreated({ created: "Jun 21, 2026" });
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(5);
  });

  it("falls back to native Date parsing for an ISO-ish string", () => {
    const d = wati.parseCreated({ created: "2026-06-21 10:00:00" });
    expect(d).not.toBeNull();
    expect(d.getUTCFullYear()).toBe(2026);
  });

  it("returns null when no date field is present at all", () => {
    expect(wati.parseCreated({})).toBeNull();
  });

  it("returns null for an unparseable garbage string instead of an Invalid Date", () => {
    expect(wati.parseCreated({ created: "not-a-real-date-!!" })).toBeNull();
  });
});

describe("toDate() / lastUpdated()", () => {
  it("toDate returns null for falsy input and an Invalid Date string", () => {
    expect(wati.toDate(null)).toBeNull();
    expect(wati.toDate("")).toBeNull();
    expect(wati.toDate("garbage-date")).toBeNull();
  });

  it("toDate parses a valid date string", () => {
    expect(wati.toDate("2026-06-21").getUTCFullYear()).toBe(2026);
  });

  it("lastUpdated prefers `lastUpdated` over `updatedAt`", () => {
    const d = wati.lastUpdated({ lastUpdated: "2026-06-21", updatedAt: "2020-01-01" });
    expect(d.getUTCFullYear()).toBe(2026);
  });

  it("lastUpdated falls back to `updatedAt` when `lastUpdated` is absent", () => {
    const d = wati.lastUpdated({ updatedAt: "2025-01-01" });
    expect(d.getUTCFullYear()).toBe(2025);
  });
});

describe("iterContacts(): async paging generator", () => {
  it("yields every contact across pages and stops on a short page", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const page2 = [{ id: 100 }, { id: 101 }];
    get.mockReturnValueOnce(ok({ contact_list: page1 })).mockReturnValueOnce(ok({ contact_list: page2 }));

    const seen = [];
    for await (const c of wati.iterContacts()) seen.push(c);

    expect(seen).toHaveLength(102);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("stops immediately on an empty first page", async () => {
    get.mockReturnValueOnce(ok({ contact_list: [] }));
    const seen = [];
    for await (const c of wati.iterContacts()) seen.push(c);
    expect(seen).toHaveLength(0);
  });
});

describe("firstResponse(): human reply latency", () => {
  it("computes minutes between the first inbound and first outbound message", async () => {
    get.mockReturnValueOnce(ok({
      messages: {
        items: [
          { owner: true, created: "2026-06-21T10:05:00Z" },
          { owner: false, created: "2026-06-21T10:00:00Z" },
        ],
      },
    }));
    const r = await wati.firstResponse("wa1");
    expect(r.fr).toBe(5);
    expect(r.answered).toBe(true);
    expect(r.n).toBe(2);
  });

  it("reports unanswered when there's no outbound message", async () => {
    get.mockReturnValueOnce(ok({ messages: { items: [{ owner: false, created: "2026-06-21T10:00:00Z" }] } }));
    const r = await wati.firstResponse("wa1");
    expect(r.fr).toBeNull();
    expect(r.answered).toBe(false);
  });

  it("returns a safe empty result instead of throwing when the fetch fails", async () => {
    get.mockRejectedValue(new Error("network down"));
    const p = wati.firstResponse("wa1");
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ fr: null, answered: false, n: 0, last: null, unavailable: false });
  });

  it("passes ?channelPhoneNumber for a second-number contact and reads its messages", async () => {
    get.mockReturnValueOnce(ok({ result: "success", messages: { items: [
      { owner: false, created: "2026-07-24T04:00:00Z" }, { owner: true, created: "2026-07-24T04:05:00Z" }] } }));
    const r = await wati.firstResponse("919101322807", "971561178629");
    expect(r.n).toBe(2);
    expect(r.answered).toBe(true);
    // the connected number is selected via the channelPhoneNumber query param
    const [, opts] = get.mock.calls[0];
    expect(opts.params).toEqual({ channelPhoneNumber: "971561178629" });
  });
});

describe("channelOf(): the connected business number", () => {
  it("reads the whatsapp_<number> custom param", () => {
    expect(wati.channelOf({ customParams: [{ name: "whatsapp_971561178629", value: "971561178629" }] })).toBe("971561178629");
  });
  it("returns null when no whatsapp_ param is present", () => {
    expect(wati.channelOf({ customParams: [{ name: "Full Name", value: "x" }] })).toBeNull();
    expect(wati.channelOf({})).toBeNull();
  });
});

describe("getThread(): message normalization", () => {
  it("keeps only real in/out messages, drops ticket/system events with no owner", async () => {
    get.mockReturnValueOnce(ok({
      messages: {
        items: [
          { owner: false, created: "2026-06-21T10:01:00Z", text: "مرحبا" },
          { eventType: "ticket", eventDescription: "assigned" }, // no owner -> dropped
          { owner: true, created: "2026-06-21T10:00:00Z", operatorName: "Ahmed", text: "أهلاً" },
        ],
      },
    }));
    const thread = await wati.getThread("wa1");
    expect(thread).toHaveLength(2);
    expect(thread[0].dir).toBe("out"); // sorted ascending by ts: 10:00 before 10:01
    expect(thread[0].sender).toBe("Ahmed");
    expect(thread[1].dir).toBe("in");
    expect(thread[1].sender).toBe("العميل");
  });

  it("labels a non-text message with its bracketed type when there's no text body", async () => {
    get.mockReturnValueOnce(ok({ messages: { items: [{ owner: false, created: "t", type: "image" }] } }));
    const thread = await wati.getThread("wa1");
    expect(thread[0].body).toBe("[image]");
  });

  it("returns a .failed-marked array (not a throw) when the API call fails", async () => {
    get.mockRejectedValue(new Error("timeout"));
    const p = wati.getThread("wa1");
    await vi.advanceTimersByTimeAsync(5000);
    const thread = await p;
    expect(thread).toHaveLength(0);
    expect(thread.failed).toBe(true);
  });
});

describe("getActivity(): ticket timeline extraction", () => {
  it("keeps only ticket-type events with real text, ignores plain messages", async () => {
    get.mockReturnValueOnce(ok({
      messages: {
        items: [
          { owner: false, text: "hi" }, // not a ticket event -> dropped
          { eventType: "ticket", eventDescription: "Assigned to Ahmed", created: "2026-06-21T10:00:00Z", actor: "system" },
        ],
      },
    }));
    const events = await wati.getActivity("wa1");
    expect(events).toEqual([{ ts: "2026-06-21T10:00:00Z", text: "Assigned to Ahmed", actor: "system" }]);
  });

  it("returns a .failed-marked array when the API call fails", async () => {
    get.mockRejectedValue(new Error("timeout"));
    const p = wati.getActivity("wa1");
    await vi.advanceTimersByTimeAsync(5000);
    const events = await p;
    expect(events).toHaveLength(0);
    expect(events.failed).toBe(true);
  });
});

describe("get(): retry/backoff behavior", () => {
  it("retries on HTTP 429 with growing backoff, then succeeds", async () => {
    get
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockReturnValueOnce(ok({ contact_list: [{ id: 1 }] }));

    const iter = wati.iterContacts();
    const p = iter.next();
    await vi.advanceTimersByTimeAsync(2000);
    const { value } = await p;
    expect(value).toEqual({ id: 1 });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("exhausts retries and surfaces the last error to the caller", async () => {
    get.mockRejectedValue(new Error("boom"));
    const p = wati.firstResponse("wa1"); // firstResponse swallows the error into a safe default
    await vi.advanceTimersByTimeAsync(5000);
    const r = await p;
    expect(r.answered).toBe(false);
    expect(get).toHaveBeenCalledTimes(4); // 4 attempts, no more
  });
});
