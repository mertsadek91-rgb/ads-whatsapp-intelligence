// REG-101 — Wati's bot operator name is literally "Bot " (trailing space), and
// case can vary. A strict `=== "Bot"` comparison once misclassified EVERY
// conversation as human_handled, silently emptying the re-engagement queue.
// This guards the classification behavior (conv_type), not just the trim.
import { describe, it, expect } from "vitest";
import { computeMeta } from "../src/lib/conversationMeta.js";

const msg = (dir, sender, ts) => ({ dir, sender, ts, type: "text", body: "x" });

describe("REG-101: bot-sender classification (conversationMeta.computeMeta)", () => {
  it("classifies bot-only replies as bot_only, NOT human_handled — trailing-space sender", () => {
    const thread = [
      msg("in", "العميل", "2026-06-01T10:00:00Z"),
      msg("out", "Bot ", "2026-06-01T10:00:05Z"), // <-- the real Wati shape
      msg("in", "العميل", "2026-06-01T10:01:00Z"),
      msg("out", "Bot ", "2026-06-01T10:01:05Z"),
    ];
    const m = computeMeta(thread);
    expect(m.conv_type).toBe("bot_only");
    expect(m.human_replied).toBe(0);
    expect(m.agent_msgs).toBe(0);
    expect(m.bot_msgs).toBe(2);
  });

  it("classifies bot-only replies as bot_only — different casing, no trailing space", () => {
    const thread = [msg("in", "العميل", "2026-06-01T10:00:00Z"), msg("out", "BOT", "2026-06-01T10:00:05Z")];
    expect(computeMeta(thread).conv_type).toBe("bot_only");
  });

  it("classifies bot-only replies as bot_only — mixed case with padding", () => {
    const thread = [msg("in", "العميل", "2026-06-01T10:00:00Z"), msg("out", "  bOt  ", "2026-06-01T10:00:05Z")];
    expect(computeMeta(thread).conv_type).toBe("bot_only");
  });

  it("classifies a real human agent reply as human_handled", () => {
    const thread = [
      msg("in", "العميل", "2026-06-01T10:00:00Z"),
      msg("out", "Bot ", "2026-06-01T10:00:05Z"),
      msg("out", "Omar Sadka", "2026-06-01T10:05:00Z"),
    ];
    const m = computeMeta(thread);
    expect(m.conv_type).toBe("human_handled");
    expect(m.human_replied).toBe(1);
    expect(m.agent_msgs).toBe(1);
    expect(m.bot_msgs).toBe(1);
  });

  it("classifies customer message with no reply at all as awaiting_human (not bot_only)", () => {
    const thread = [msg("in", "العميل", "2026-06-01T10:00:00Z")];
    expect(computeMeta(thread).conv_type).toBe("awaiting_human");
  });

  it("classifies a thread with zero customer messages as no_customer", () => {
    const thread = [msg("out", "Bot ", "2026-06-01T10:00:05Z")];
    expect(computeMeta(thread).conv_type).toBe("no_customer");
  });

  it("computes first-human-response gap only from a human agent, ignoring bot replies", () => {
    const thread = [
      msg("in", "العميل", "2026-06-01T10:00:00Z"),
      msg("out", "Bot ", "2026-06-01T10:00:01Z"), // instant bot reply must NOT count as the response
      msg("out", "Yaser  Kamoun", "2026-06-01T10:10:00Z"), // 10 min later — the real human response
    ];
    expect(computeMeta(thread).first_human_response_min).toBe(10);
  });
});
