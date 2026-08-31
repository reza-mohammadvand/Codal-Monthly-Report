import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PILOT_SYMBOLS,
  classifyCoverage,
  formatCompanySymbolForConsole,
  formatCompanyStatusForConsole,
  selectCompanies,
  summarizeCompanyStatuses,
} from "../src/pipeline.js";

function company(symbol, state = 0, overrides = {}) {
  return {
    sy: symbol,
    n: `شرکت ${symbol}`,
    IG: 27,
    st: state,
    RT: 1_000_000,
    ...overrides,
  };
}

const rawCompanies = [
  company("غپاک"),
  company("شپنا"),
  company("فولاد", 1),
  company("فملی"),
  company("فولاد", 0, { n: "رکورد تکراری فولاد" }),
  company("نمادغیرفعال", 2),
];

test("default company selection is the ordered three-symbol pilot", () => {
  assert.deepEqual(DEFAULT_PILOT_SYMBOLS, ["فولاد", "فملی", "شپنا"]);
  assert.equal(Object.isFrozen(DEFAULT_PILOT_SYMBOLS), true);

  const selected = selectCompanies(rawCompanies);
  assert.deepEqual(selected.map((item) => item.symbol), ["فولاد", "فملی", "شپنا"]);
  assert.equal(selected[0].name, "شرکت فولاد");
});

test("--symbols fully overrides the pilot and preserves requested order", () => {
  const selected = selectCompanies(rawCompanies, {
    symbols: [" غپاک ", "فملي"],
  });

  assert.deepEqual(selected.map((item) => item.symbol), ["غپاک", "فملی"]);
});

test("--all-symbols keeps every eligible active company and still deduplicates", () => {
  const selected = selectCompanies(rawCompanies, { allSymbols: true });

  assert.deepEqual(selected.map((item) => item.symbol), ["غپاک", "شپنا", "فولاد", "فملی"]);
  assert.equal(selected.some((item) => item.symbol === "نمادغیرفعال"), false);
});

test("--limit is applied after symbol selection", () => {
  assert.deepEqual(
    selectCompanies(rawCompanies, { allSymbols: true, limit: 2 }).map((item) => item.symbol),
    ["غپاک", "شپنا"],
  );
  assert.deepEqual(
    selectCompanies(rawCompanies, { symbols: ["شپنا", "فملی"], limit: 1 })
      .map((item) => item.symbol),
    ["شپنا"],
  );
});

test("conflicting selection modes and missing requested symbols fail clearly", () => {
  assert.throws(
    () => selectCompanies(rawCompanies, { symbols: ["فولاد"], allSymbols: true }),
    /--symbols.*--all-symbols/,
  );
  assert.throws(
    () => selectCompanies(rawCompanies, { symbols: ["نمادناموجود"] }),
    /Manufacturing symbol\(s\) not found: نمادناموجود/,
  );
});

test("console status labels are English without changing internal Persian statuses", () => {
  assert.equal(formatCompanyStatusForConsole("کامل"), "complete");
  assert.equal(formatCompanyStatusForConsole("ناقص"), "partial");
  assert.equal(formatCompanyStatusForConsole("بدون داده"), "no data");
  assert.equal(formatCompanyStatusForConsole("خطای خواندن"), "read error");
  assert.equal(formatCompanyStatusForConsole("خطا"), "error");
  assert.equal(formatCompanyStatusForConsole("وضعیت ناشناخته"), "unknown");
  assert.equal(classifyCoverage({
    requiredReportCount: 17,
    foundReportCount: 17,
    parsedReportCount: 17,
  }), "کامل");
});

test("pilot symbols have ASCII-safe console labels", () => {
  assert.equal(formatCompanySymbolForConsole("فولاد", 1), "FOOLAD");
  assert.equal(formatCompanySymbolForConsole("فملي", 2), "FMLI");
  assert.equal(formatCompanySymbolForConsole("شپنا", 3), "SHEPNA");
  assert.equal(formatCompanySymbolForConsole("غپاک", 4), "COMPANY-4");
  assert.equal(formatCompanySymbolForConsole("غپاک"), "COMPANY");
});

test("coverage classification distinguishes complete, partial, absent, and unreadable data", () => {
  const cases = [
    {
      input: { requiredReportCount: 17, foundReportCount: 17, parsedReportCount: 17 },
      expected: "کامل",
    },
    {
      input: { requiredReportCount: 17, foundReportCount: 17, parsedReportCount: 16 },
      expected: "ناقص",
    },
    {
      input: { requiredReportCount: 17, foundReportCount: 1, parsedReportCount: 1 },
      expected: "ناقص",
    },
    {
      input: { requiredReportCount: 17, foundReportCount: 0, parsedReportCount: 0 },
      expected: "بدون داده",
    },
    {
      input: { requiredReportCount: 17, foundReportCount: 17, parsedReportCount: 0 },
      expected: "خطای خواندن",
    },
  ];

  for (const { input, expected } of cases) {
    assert.equal(classifyCoverage(input), expected, JSON.stringify(input));
  }
});

test("company status summary counts each coverage outcome separately", () => {
  const summary = summarizeCompanyStatuses([
    { symbol: "فولاد", status: "کامل" },
    { symbol: "فملی", status: "کامل" },
    { symbol: "شپنا", status: "ناقص" },
    { symbol: "الف", status: "بدون داده" },
    { symbol: "ب", status: "خطای خواندن" },
    { symbol: "پ", status: "خطا" },
  ]);

  assert.deepEqual(summary, {
    completeCount: 2,
    partialCount: 1,
    noDataCount: 1,
    readErrorCount: 1,
    errorCount: 1,
  });
  assert.deepEqual(summarizeCompanyStatuses([]), {
    completeCount: 0,
    partialCount: 0,
    noDataCount: 0,
    readErrorCount: 0,
    errorCount: 0,
  });
});
