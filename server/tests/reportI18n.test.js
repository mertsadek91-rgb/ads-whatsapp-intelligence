// Server-rendered report text (export headers, enum cells, the unknown-agent
// bucket) has to follow the report's language the same way its headings do.
import { describe, it, expect } from "vitest";
import {
  asLang, langOf, fieldLabel, headers, enumLabel, cellMapper, agentLabel, fmtDateCell,
  UNKNOWN_AGENT_AR,
} from "../src/lib/reportI18n.js";
import { contentDisposition } from "../src/lib/csvStream.js";

describe("language resolution", () => {
  it("defaults to Arabic and only accepts the two supported values", () => {
    expect(asLang("en")).toBe("en");
    expect(asLang("ar")).toBe("ar");
    expect(asLang("fr")).toBe("ar");
    expect(asLang(undefined)).toBe("ar");
  });

  it("prefers an explicit ?lang, then the body, then Accept-Language", () => {
    expect(langOf({ query: { lang: "en" }, headers: { "accept-language": "ar" } })).toBe("en");
    expect(langOf({ query: {}, body: { lang: "en" }, headers: {} })).toBe("en");
    expect(langOf({ query: {}, headers: { "accept-language": "en-GB,en;q=0.9" } })).toBe("en");
    expect(langOf({ query: {}, headers: { "accept-language": "ar-AE,ar;q=0.9,en;q=0.8" } })).toBe("ar");
    expect(langOf({})).toBe("ar");
  });
});

describe("field labels", () => {
  it("translates every column both ways", () => {
    expect(fieldLabel("lead_intent", "ar")).toBe("النيّة");
    expect(fieldLabel("lead_intent", "en")).toBe("Intent");
    expect(headers(["full_name", "phone"], "en")).toEqual(["Name", "Phone"]);
    expect(headers(["full_name", "phone"], "ar")).toEqual(["الاسم", "الهاتف"]);
  });

  it("passes an unmapped column through instead of blanking the header", () => {
    expect(fieldLabel("some_new_column", "en")).toBe("some_new_column");
  });

  it("leaves no column of any export untranslated", () => {
    const exported = [
      // leads /export.csv
      "full_name", "phone", "stage", "lead_score", "score_band", "country", "ad_name",
      "campaign_name", "post_url", "contact_owner", "created_date", "account_type",
      "deposit_count", "deposit_total_aed", "review_status", "notes",
      // report /employee/:agent/export.csv
      "date", "agent_score", "conv_score", "lead_intent", "lead_status",
      "wrong_persuasion", "follow_up_min", "message_count", "summary",
      // report /re-engagement.csv
      "conv_type", "customer_msgs", "last_activity",
      // assignment /export.csv
      "wa_id", "country_iso2", "num_messages", "last_message_at",
    ];
    for (const col of exported) {
      for (const lang of ["ar", "en"]) {
        expect(fieldLabel(col, lang), `${col} (${lang})`).not.toBe(col);
      }
    }
  });
});

describe("enum labels", () => {
  it("translates the values a report actually prints", () => {
    expect(enumLabel("lead_intent", "hot", "en")).toBe("Hot");
    expect(enumLabel("lead_intent", "hot", "ar")).toBe("ساخن");
    expect(enumLabel("conv_type", "awaiting_human", "en")).toBe("Awaiting human");
    expect(enumLabel("stage", "deposit", "en")).toBe("Deposit");
  });

  it("keeps an unknown value visible rather than turning it into a blank", () => {
    expect(enumLabel("lead_intent", "lukewarm", "en")).toBe("lukewarm");
  });

  it("renders empty for null/empty so a CSV cell stays empty", () => {
    expect(enumLabel("lead_intent", null, "en")).toBe("");
    expect(enumLabel("lead_intent", "", "ar")).toBe("");
  });
});

describe("cellMapper", () => {
  const en = cellMapper("en");
  it("translates enum columns and leaves free values alone", () => {
    expect(en("lead_intent", "cold")).toBe("Cold");
    expect(en("wrong_persuasion", 1)).toBe("Yes");
    expect(en("full_name", "أحمد")).toBe("أحمد");   // a real name is not an enum
    expect(en("lead_score", 82)).toBe(82);
  });

  it("covers the stage/conv_type values that really occur, not just the filterable ones", () => {
    // `new` (7.7k contacts) and `engaged` (849) used to print raw in both languages
    expect(en("stage", "new")).toBe("New");
    expect(en("stage", "engaged")).toBe("Engaged");
    expect(en("conv_type", "no_customer")).toBe("No customer messages");
    expect(en("conv_type", "not_synced")).toBe("Not synced");
  });

  it("normalizes date columns instead of letting a JS Date stringify itself", () => {
    // was: "Tue Jun 16 2026 04:00:00 GMT+0400 (Gulf Standard Time)"
    const d = new Date(2026, 5, 16, 4, 30);
    expect(en("created_date", d)).toBe("2026-06-16 04:30");
    expect(en("last_message_at", new Date(2026, 5, 16, 0, 0))).toBe("2026-06-16");
    expect(en("full_name", d)).toBe(d);           // only date columns are touched
  });
});

describe("fmtDateCell", () => {
  it("is empty for null and passes an unparseable value through", () => {
    expect(fmtDateCell(null)).toBe("");
    expect(fmtDateCell("")).toBe("");
    expect(fmtDateCell("not a date")).toBe("not a date");
  });
});

describe("Content-Disposition for a localized filename", () => {
  it("keeps an ASCII filename simple", () => {
    expect(contentDisposition("employee-report.csv")).toBe('filename="employee-report.csv"');
  });

  it("uses the English fallback for clients that ignore filename*", () => {
    // stripping non-ASCII from an Arabic name gave the useless "_-_.csv"
    const cd = contentDisposition("تقرير-الموظف.csv", "employee-report.csv");
    expect(cd).toContain('filename="employee-report.csv"');
    expect(cd).toContain("filename*=UTF-8''%D8%AA");
    expect(cd).not.toContain('"_-_.csv"');
  });

  it("never emits an empty ASCII filename", () => {
    expect(contentDisposition("عربي.csv")).toContain('filename="export.csv"');
  });
});

describe("agentLabel", () => {
  it("translates only the unknown/unassigned sentinels", () => {
    expect(agentLabel(UNKNOWN_AGENT_AR, "en")).toBe("(unknown)");
    expect(agentLabel(UNKNOWN_AGENT_AR, "ar")).toBe(UNKNOWN_AGENT_AR);
    expect(agentLabel("", "en")).toBe("(unassigned)");
    expect(agentLabel(null, "ar")).toBe("(غير مُسند)");
  });

  it("never touches a real employee name", () => {
    expect(agentLabel("Yaser Kamoun", "ar")).toBe("Yaser Kamoun");
    expect(agentLabel("عمر صدقة", "en")).toBe("عمر صدقة");
  });
});
