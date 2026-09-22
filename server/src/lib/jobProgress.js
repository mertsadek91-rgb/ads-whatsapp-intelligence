// Where a long import has got to.
//
// A full import walks the whole Wati contact list, fetches a message thread per
// contact and then reads several Meta reporting windows. On a real account that
// is tens of minutes. Until now the only thing the operator could see was a
// spinner: no stage, no counts, no way to tell "working" from "stuck", and no
// basis for deciding whether to wait or to go and look at the logs.
//
// So each stage reports itself as it goes. Deliberately in memory and not in
// the database: this is written hundreds of times a minute and is worthless
// after the run ends, and a progress write that contends with the import's own
// writes would slow down the thing it is describing.
//
// Stages are declared up front rather than discovered, so the UI can show
// "3 of 6" from the first tick instead of counting up from an unknown total.

/** The stages of a full import, in the order they run. */
export const IMPORT_STAGES = [
  { key: "schema", ar: "تجهيز الجداول", en: "Preparing tables" },
  { key: "wati_contacts", ar: "جهات اتصال واتساب", en: "WhatsApp contacts" },
  { key: "wati_messages", ar: "نصّ المحادثات", en: "Conversation text" },
  { key: "meta_ads", ar: "حملات وإعلانات Meta", en: "Meta campaigns and ads" },
  { key: "meta_daily", ar: "الأداء اليومي", en: "Daily performance" },
];

const listeners = new Set();
let current = null;

/**
 * Start reporting. Returns the reporter the job passes down into each stage;
 * every method is safe to call when nobody is listening, so the ingests do not
 * need to know whether they were started by a person or by cron.
 */
export function begin(jobName) {
  current = {
    job: jobName,
    startedAt: Date.now(),
    stage: null,
    stageIndex: 0,
    stages: IMPORT_STAGES.map((s) => ({ ...s, state: "pending" })),
    done: 0,
    total: null,     // null when the source cannot say how many there are
    detail: null,
    updatedAt: Date.now(),
  };
  emit();
  return reporter();
}

export function finish() { current = null; emit(); }

/** What to show right now, or null when nothing is running. */
export function snapshot() { return current ? { ...current, stages: current.stages.map((s) => ({ ...s })) } : null; }

export function onProgress(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function emit() {
  for (const fn of listeners) {
    try { fn(snapshot()); } catch { /* a listener must never break the import */ }
  }
}

function reporter() {
  return {
    /** Move to a declared stage. Everything before it is marked done. */
    stage(key, { total = null, detail = null } = {}) {
      if (!current) return;
      const i = current.stages.findIndex((s) => s.key === key);
      if (i < 0) return;
      for (let k = 0; k < i; k++) {
        if (current.stages[k].state !== "done") current.stages[k].state = "skipped";
      }
      current.stages[i].state = "running";
      current.stage = key;
      current.stageIndex = i;
      current.done = 0;
      current.total = total;
      current.detail = detail;
      current.updatedAt = Date.now();
      emit();
    },

    /** Progress within the current stage. */
    tick(done, { total, detail } = {}) {
      if (!current) return;
      current.done = done;
      if (total !== undefined) current.total = total;
      if (detail !== undefined) current.detail = detail;
      current.updatedAt = Date.now();
      emit();
    },

    /** The current stage finished. */
    stageDone(summary = null) {
      if (!current) return;
      const s = current.stages[current.stageIndex];
      if (s) { s.state = "done"; s.summary = summary; }
      current.updatedAt = Date.now();
      emit();
    },
  };
}

/** A reporter that does nothing, for callers with no progress to report to. */
export const NO_PROGRESS = {
  stage() {}, tick() {}, stageDone() {},
};

export default { IMPORT_STAGES, begin, finish, snapshot, onProgress, NO_PROGRESS };
