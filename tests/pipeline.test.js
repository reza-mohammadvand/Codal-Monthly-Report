import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PILOT_SYMBOLS,
  classifyCoverage,
  collectMonthlyReportData,
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
  company("کگل"),
  company("فولاد", 0, { n: "رکورد تکراری فولاد" }),
  company("نمادغیرفعال", 2),
];

test("default company selection is the ordered four-symbol pilot", () => {
  assert.deepEqual(DEFAULT_PILOT_SYMBOLS, ["فولاد", "فملی", "شپنا", "کگل"]);
  assert.equal(Object.isFrozen(DEFAULT_PILOT_SYMBOLS), true);

  const selected = selectCompanies(rawCompanies);
  assert.deepEqual(selected.map((item) => item.symbol), ["فولاد", "فملی", "شپنا", "کگل"]);
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

  assert.deepEqual(selected.map((item) => item.symbol), ["غپاک", "شپنا", "فولاد", "فملی", "کگل"]);
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
  assert.equal(formatCompanySymbolForConsole("کگل", 4), "KGOL");
  assert.equal(formatCompanySymbolForConsole("غپاک", 5), "COMPANY-5");
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

test("pipeline resolves each company's fiscal window from one monthly-report search", async () => {
  const searches = [];
  const financialYearSymbols = [];
  const client = {
    async fetchProductionCompanies() {
      return [company("TEST")];
    },
    async fetchIndustries() {
      return [{ Id: 27, Name: "Test industry" }];
    },
    async fetchFinancialYears(symbol) {
      financialYearSymbols.push(symbol);
      return ["1403/06/31", "1404/06/31"];
    },
    async searchMonthlyReports(options) {
      searches.push(options);
      return [{ Url: "/Reports/Decision.aspx?id=context", Title: "Monthly activity" }];
    },
    async fetchReportDatasource() {
      return null;
    },
    async fetchAndParseReport() {
      throw new Error("No report should be parsed in this test.");
    },
  };

  const result = await collectMonthlyReportData(
    {
      asOf: "1405/06/09",
      symbols: ["TEST"],
      logger: null,
    },
    {
      client,
      now: () => new Date("2026-08-31T12:00:00.000Z"),
    },
  );

  assert.deepEqual(financialYearSymbols, ["TEST"]);
  assert.deepEqual(searches, [{
    symbol: "TEST",
    fromDate: "1403/01/01",
    toDate: "1405/06/09",
    allPages: true,
  }]);

  const [processed] = result.companies;
  assert.equal(processed.fiscalYearEndMonth, 6);
  assert.equal(processed.fiscalYearStartMonth, 7);
  assert.deepEqual(processed.requiredFromMonth, { year: 1403, month: 7 });
  assert.deepEqual(processed.requiredToMonth, { year: 1405, month: 5 });
  assert.equal(processed.requiredReportCount, 23);
  assert.equal(processed.missingReportCount, 23);
  assert.deepEqual(
    processed.definitions.periods.currentYearYtdAverage.months[0],
    { year: 1404, month: 7 },
  );
});

test("pipeline classifies symbols with no fiscal calendar and no monthly filings as no data", async () => {
  const searches = [];
  const client = {
    async fetchProductionCompanies() {
      return [company("TEST")];
    },
    async fetchIndustries() {
      return [{ Id: 27, Name: "Test industry" }];
    },
    async fetchFinancialYears() {
      return ["invalid", "1404/13/01"];
    },
    async searchMonthlyReports(options) {
      searches.push(options);
      return [];
    },
  };

  const result = await collectMonthlyReportData(
    { asOf: "1405/06/09", symbols: ["TEST"], logger: null },
    { client },
  );

  const [processed] = result.companies;
  assert.equal(searches.length, 1);
  assert.equal(searches[0].allPages, true);
  assert.equal(formatCompanyStatusForConsole(processed.status), "no data");
  assert.equal(processed.requiredReportCount, 0);
  assert.equal(processed.fiscalYearEndMonth, null);
  assert.match(processed.errors[0], /هیچ گزارش فعالیت ماهانه‌ای/);
});

test("pipeline recovers the fiscal year end from a recent report datasource", async () => {
  const searches = [];
  const client = {
    async fetchProductionCompanies() {
      return [company("TEST")];
    },
    async fetchIndustries() {
      return [{ Id: 27, Name: "Test industry" }];
    },
    async fetchFinancialYears() {
      throw new Error("The fiscal-years endpoint should not be needed.");
    },
    async searchMonthlyReports(options) {
      searches.push(options);
      return [{ Url: "/Reports/Decision.aspx?id=1" }];
    },
    async fetchReportDatasource() {
      return { yearEndToDate: "1404/09/30" };
    },
  };

  const result = await collectMonthlyReportData(
    { asOf: "1405/06/09", symbols: ["TEST"], logger: null },
    { client },
  );

  const [processed] = result.companies;
  assert.equal(searches.length, 1);
  assert.equal(processed.fiscalYearEndMonth, 9);
  assert.equal(processed.fiscalYearStartMonth, 10);
  assert.equal(processed.fiscalYearSource, "monthly-report-datasource");
  assert.equal(processed.requiredReportCount, 20);
});

test("incremental updates reuse stored monthly data when Codal has no newer filing", async () => {
  const months = [];
  for (let month = 1; month <= 12; month += 1) months.push({ year: 1404, month });
  for (let month = 1; month <= 5; month += 1) months.push({ year: 1405, month });
  const monthlyReports = months.map(({ year, month }, index) => ({
    year,
    month,
    revenueScale: 1_000_000,
    totals: {
      production: 100 + index,
      sales: 90 + index,
      revenue: 1_000 + index,
      weightedRate: 10,
      unit: "تن",
      unitsCompatible: true,
    },
    products: [{
      name: "محصول",
      unit: "تن",
      production: 100 + index,
      sales: 90 + index,
      revenue: 1_000 + index,
      rate: 10,
    }],
    dominantProduct: {
      name: "محصول",
      unit: "تن",
      sales: 90 + index,
      revenue: 1_000 + index,
      rate: 10,
    },
    source: { tracingNo: 10_000 + index },
    warnings: [],
  }));
  const reports = monthlyReports.map((report) => ({
    TracingNo: report.source.tracingNo,
    Title: `گزارش فعالیت ماهانه دوره ۱ ماهه منتهی به ${report.year}/${String(report.month).padStart(2, "0")}/31`,
  }));
  let parseCalls = 0;
  const client = {
    async fetchProductionCompanies() {
      return [company("TEST")];
    },
    async fetchIndustries() {
      return [{ Id: 27, Name: "Test industry" }];
    },
    async searchMonthlyReports() {
      return reports;
    },
    async fetchFinancialYears() {
      throw new Error("Stored fiscal context should be reused.");
    },
    async fetchReportDatasource() {
      throw new Error("Stored fiscal context should be reused.");
    },
    async fetchAndParseReport() {
      parseCalls += 1;
      throw new Error("Unchanged filings must not be downloaded again.");
    },
  };
  const existingCompany = {
    symbol: "TEST",
    name: "Test company",
    industryId: 27,
    status: "کامل",
    fiscalYearEndMonth: 12,
    financialYears: ["1405/12/29"],
    monthlyReports,
  };

  const result = await collectMonthlyReportData(
    {
      asOf: "1405/06/09",
      symbols: ["TEST"],
      existingCompanies: [existingCompany],
      logger: null,
    },
    { client },
  );

  const [processed] = result.companies;
  assert.equal(parseCalls, 0);
  assert.equal(processed.updateAction, "unchanged", JSON.stringify(processed.errors));
  assert.equal(processed.newOrChangedReportCount, 0);
  assert.equal(processed.downloadedReportCount, 0);
  assert.equal(processed.parsedReportCount, 17);
  assert.equal(processed.monthlyReports.length, 17);

  reports.at(-1).TracingNo = 99_999;
  client.fetchAndParseReport = async () => {
    parseCalls += 1;
    return {
      revenueMultiplier: 1_000_000,
      monthly: {
        date: { year: 1405, month: 5 },
        totals: {
          production: 250,
          salesQuantity: 240,
          revenue: 5_000,
          weightedRate: 20,
          unit: "تن",
          compatibleUnits: true,
        },
        products: [{
          name: "محصول",
          unit: "تن",
          production: 250,
          salesQuantity: 240,
          revenue: 5_000,
          rate: 20,
        }],
        dominantProduct: {
          name: "محصول",
          unit: "تن",
          salesQuantity: 240,
          revenue: 5_000,
          rate: 20,
        },
      },
      warnings: [],
    };
  };
  const changed = await collectMonthlyReportData(
    {
      asOf: "1405/06/09",
      symbols: ["TEST"],
      existingCompanies: [existingCompany],
      logger: null,
    },
    { client },
  );
  assert.equal(parseCalls, 1);
  assert.equal(changed.companies[0].updateAction, "updated");
  assert.equal(changed.companies[0].newOrChangedReportCount, 1);
  assert.equal(changed.companies[0].downloadedReportCount, 1);
  assert.equal(changed.companies[0].monthlyReports.at(-1).source.tracingNo, 99_999);
});

test("single-worker bulk mode pauses between completed companies", async () => {
  const events = [];
  const client = {
    async fetchProductionCompanies() {
      return [company("ONE"), company("TWO")];
    },
    async fetchIndustries() {
      return [{ Id: 27, Name: "Test industry" }];
    },
    async searchMonthlyReports() {
      return [];
    },
  };
  const startedAt = Date.now();
  await collectMonthlyReportData(
    {
      asOf: "1405/06/09",
      symbols: ["ONE", "TWO"],
      concurrency: 1,
      companyDelayMs: 20,
      logger: null,
      onProgress: (event) => events.push(event),
    },
    { client },
  );

  assert.ok(Date.now() - startedAt >= 15);
  assert.equal(events.filter((event) => event.type === "company-delay").length, 1);
  assert.equal(events.find((event) => event.type === "company-delay").delayMs, 20);
});
