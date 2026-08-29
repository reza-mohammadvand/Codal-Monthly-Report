import fs from "node:fs/promises";
import path from "node:path";

import {
  CodalClient,
  extractReportPeriod,
  normalizeCodalText,
  selectLatestCorrectionPerMonth,
} from "./codal.js";
import { DiskCache } from "./cache.js";
import { requestJson, requestText } from "./http.js";
import {
  buildSymbolPeriodMetrics,
  calculateGrowth,
  getReportPeriods,
} from "./periods.js";
import { StartIntervalGate, normalizePersianText } from "./utils.js";
import { writeReportWorkbook } from "./excel.js";

const METRIC_MAP = Object.freeze({
  totalProduction: "production",
  totalSales: "sales",
  totalRevenue: "revenue",
  dominantSales: "dominantProductSales",
  dominantRate: "dominantProductRate",
  weightedRate: "weightedRate",
});

function monthKey(value) {
  return `${value.year}/${String(value.month).padStart(2, "0")}`;
}

function parseAsOf(value) {
  if (!value) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US-u-ca-persian", {
        timeZone: "Asia/Tehran",
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }).formatToParts(new Date()).map((part) => [part.type, part.value]),
    );
    return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
  }
  const match = String(value).trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) throw new Error("تاریخ --as-of باید با قالب YYYY/MM/DD وارد شود.");
  const result = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (result.month < 1 || result.month > 12 || result.day < 1 || result.day > 31) {
    throw new Error("تاریخ --as-of معتبر نیست.");
  }
  return result;
}

function formatAsOf(value) {
  return `${value.year}/${String(value.month).padStart(2, "0")}/${String(value.day).padStart(2, "0")}`;
}

function requiredMonths(definitions) {
  const unique = new Map();
  for (const period of Object.values(definitions.periods)) {
    for (const month of period.months) unique.set(monthKey(month), month);
  }
  unique.set(monthKey(definitions.previousMonthPriorYear), definitions.previousMonthPriorYear);
  return [...unique.values()].sort((left, right) => left.year - right.year || left.month - right.month);
}

function normalizeMonthlyReport(report, parsed) {
  const period = extractReportPeriod(report) ?? parsed.monthly?.date;
  const monthly = parsed.monthly;
  if (!period || !monthly) return null;
  return {
    year: period.year,
    month: period.month,
    revenueScale: parsed.revenueMultiplier ?? 1_000_000,
    totals: {
      production: monthly.totals.production,
      sales: monthly.totals.salesQuantity,
      revenue: monthly.totals.revenue,
      weightedRate: monthly.totals.weightedRate,
      unit: monthly.totals.unit || null,
      unitsCompatible: monthly.totals.compatibleUnits,
    },
    products: monthly.products.map((product) => ({
      name: product.name,
      unit: product.unit || null,
      production: product.production,
      sales: product.salesQuantity,
      revenue: product.revenue,
      rate: product.rate,
    })),
    dominantProduct: monthly.dominantProduct
      ? {
          name: monthly.dominantProduct.name,
          unit: monthly.dominantProduct.unit || null,
          sales: monthly.dominantProduct.salesQuantity,
          revenue: monthly.dominantProduct.revenue,
          rate: monthly.dominantProduct.rate,
        }
      : null,
    source: {
      tracingNo: report.TracingNo,
      title: report.Title,
      publishDateTime: report.PublishDateTime ?? report.SentDateTime,
      url: report.Url ? new URL(report.Url, "https://www.codal.ir").toString() : null,
      excelUrl: report.ExcelUrl ?? null,
      correction: /اصلاحیه/.test(normalizePersianText(report.Title)),
    },
    warnings: parsed.warnings,
  };
}

function mappedMetrics(period, allowPartial) {
  const source = !allowPartial && !period.meta.complete ? {} : period.metrics;
  return Object.fromEntries(
    Object.entries(METRIC_MAP).map(([outputKey, inputKey]) => [outputKey, source[inputKey] ?? null]),
  );
}

function normalizePeriodForExcel(period, allowPartial) {
  return {
    metrics: mappedMetrics(period, allowPartial),
    unit: period.totals.unit,
    unitsCompatible: period.totals.unitsCompatible,
    dominantProductName: period.dominantProduct?.name ?? null,
    dominantProductUnit: period.dominantProduct?.unit ?? null,
    complete: period.meta.complete,
    reportCount: period.meta.reportCount,
    requestedMonthCount: period.meta.requestedMonthCount,
    missingMonths: period.meta.missingMonths,
  };
}

function sameText(left, right) {
  return normalizePersianText(left) && normalizePersianText(left) === normalizePersianText(right);
}

function buildGrowthPeriod(numerator, denominator) {
  const result = {};
  for (const metric of Object.keys(METRIC_MAP)) {
    let comparable = true;
    if (["totalProduction", "totalSales", "weightedRate"].includes(metric)) {
      comparable = numerator.unitsCompatible && denominator.unitsCompatible
        && sameText(numerator.unit, denominator.unit);
    }
    if (["dominantSales", "dominantRate"].includes(metric)) {
      comparable = sameText(numerator.dominantProductName, denominator.dominantProductName)
        && sameText(numerator.dominantProductUnit, denominator.dominantProductUnit);
    }
    result[metric] = comparable
      ? calculateGrowth(numerator.metrics[metric], denominator.metrics[metric])
      : null;
  }
  return result;
}

function adaptPeriodResult(calculated, allowPartial) {
  const periods = {
    priorTarget: normalizePeriodForExcel(calculated.periods.priorYearTarget, allowPartial),
    priorYtd: normalizePeriodForExcel(calculated.periods.priorYearYtdAverage, allowPartial),
    priorAnnual: normalizePeriodForExcel(calculated.periods.priorYearFullYearAverage, allowPartial),
    previous: normalizePeriodForExcel(calculated.periods.previousMonth, allowPartial),
    target: normalizePeriodForExcel(calculated.periods.targetMonth, allowPartial),
    currentYtd: normalizePeriodForExcel(calculated.periods.currentYearYtdAverage, allowPartial),
  };
  const previousPrior = normalizePeriodForExcel(
    calculated.comparisonPeriods.previousMonthPriorYear,
    allowPartial,
  );
  const growth = {
    targetYoY: buildGrowthPeriod(periods.target, periods.priorTarget),
    ytdYoY: buildGrowthPeriod(periods.currentYtd, periods.priorYtd),
    previousYoY: buildGrowthPeriod(periods.previous, previousPrior),
  };
  return {
    periods,
    growth,
    previousPrior,
    comparisonPeriods: { previousMonthPriorYear: previousPrior },
  };
}

function createCachedTransport(cache, gate) {
  return {
    async json(url) {
      const cached = await cache.getJson(url);
      if (cached !== null) return cached;
      await gate.wait();
      const value = await requestJson(url);
      await cache.setJson(url, value);
      return value;
    },
    async text(url) {
      const cached = await cache.getText(url, "html");
      if (cached !== null) return cached;
      await gate.wait();
      const value = await requestText(url);
      await cache.setText(url, value, "html");
      return value;
    },
  };
}

async function runPool(items, concurrency, worker) {
  const output = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return output;
}

function companyFields(company) {
  return {
    symbol: company.sy ?? company.Symbol ?? company.symbol,
    name: company.n ?? company.CompanyName ?? company.name,
    industryId: Number(company.IG ?? company.IndustryGroup ?? company.industryId),
    state: Number(company.st ?? company.CompanyState ?? company.state),
    reportingType: Number(company.RT ?? company.ReportingType ?? company.reportingType),
  };
}

function deduplicateCompanies(companies) {
  const output = new Map();
  for (const raw of companies) {
    const company = companyFields(raw);
    const key = normalizeCodalText(company.symbol);
    if (!key || output.has(key)) continue;
    output.set(key, company);
  }
  return [...output.values()];
}

async function processCompany({ company, client, months, definitions, asOf, allowPartial }) {
  const from = months[0];
  const reports = await client.searchMonthlyReports({
    symbol: company.symbol,
    fromDate: `${from.year}/01/01`,
    toDate: formatAsOf(asOf),
    allPages: true,
  });
  const latest = selectLatestCorrectionPerMonth(reports);
  const latestByMonth = new Map();
  for (const report of latest) {
    const period = extractReportPeriod(report);
    if (period) latestByMonth.set(monthKey(period), report);
  }
  const monthlyReports = [];
  const errors = [];
  const parsedMonths = await Promise.all(months.map(async (month) => {
    const report = latestByMonth.get(monthKey(month));
    if (!report) {
      return { error: `گزارش ${monthKey(month)} یافت نشد` };
    }
    try {
      const parsed = await client.fetchAndParseReport(report);
      const normalized = normalizeMonthlyReport(report, parsed);
      return normalized
        ? { report: normalized }
        : { error: `جدول تولید و فروش ${monthKey(month)} خوانده نشد` };
    } catch (error) {
      return { error: `${monthKey(month)}: ${error.message}` };
    }
  }));
  for (const item of parsedMonths) {
    if (item.report) monthlyReports.push(item.report);
    if (item.error) errors.push(item.error);
  }

  const calculated = buildSymbolPeriodMetrics(monthlyReports, definitions.executionMonth);
  const excelData = adaptPeriodResult(calculated, allowPartial);
  return {
    ...company,
    ...excelData,
    status: monthlyReports.length ? (errors.length ? "ناقص" : "کامل") : "بدون داده",
    errors,
    sources: monthlyReports.map((report) => ({
      year: report.year,
      month: report.month,
      ...report.source,
    })),
    downloadedReportCount: monthlyReports.length,
    requiredReportCount: months.length,
  };
}

function buildIndustryGroups(companies, industries) {
  const names = new Map(
    industries.map((industry) => [
      Number(industry.Id ?? industry.id),
      industry.Name ?? industry.name,
    ]),
  );
  const grouped = new Map();
  for (const company of companies) {
    const industryName = names.get(company.industryId) ?? `صنعت ${company.industryId || "نامشخص"}`;
    if (!grouped.has(company.industryId)) {
      grouped.set(company.industryId, {
        industryId: company.industryId,
        industryName,
        companies: [],
      });
    }
    grouped.get(company.industryId).companies.push(company);
  }
  return [...grouped.values()]
    .map((group) => ({
      ...group,
      companies: group.companies.sort((left, right) => left.symbol.localeCompare(right.symbol, "fa")),
    }))
    .sort((left, right) => left.industryName.localeCompare(right.industryName, "fa"));
}

export async function runMonthlyReport(options = {}) {
  const asOf = parseAsOf(options.asOf);
  const definitions = getReportPeriods({ year: asOf.year, month: asOf.month });
  const months = requiredMonths(definitions);
  const cache = new DiskCache(options.cacheDir ?? path.resolve(".cache/codal"), {
    refresh: options.refresh,
  });
  const gate = new StartIntervalGate(options.requestDelayMs ?? 350);
  const transport = createCachedTransport(cache, gate);
  const client = new CodalClient({
    fetchJson: transport.json,
    fetchText: transport.text,
    retries: 2,
  });

  console.log(`تاریخ اجرا: ${formatAsOf(asOf)} | ماه هدف: ${monthKey(definitions.targetMonth)}`);
  console.log("در حال دریافت فهرست شرکت‌های تولیدی و صنایع...");
  const [rawCompanies, industries] = await Promise.all([
    client.fetchProductionCompanies(),
    client.fetchIndustries(),
  ]);
  let companies = deduplicateCompanies(rawCompanies)
    .filter((company) => [0, 1].includes(company.state));

  if (options.symbols?.length) {
    const wanted = new Set(options.symbols.map(normalizeCodalText));
    companies = companies.filter((company) => wanted.has(normalizeCodalText(company.symbol)));
    const found = new Set(companies.map((company) => normalizeCodalText(company.symbol)));
    const missing = [...wanted].filter((symbol) => !found.has(symbol));
    if (missing.length) throw new Error(`نماد تولیدی یافت نشد: ${missing.join("، ")}`);
  }
  if (options.limit) companies = companies.slice(0, options.limit);
  if (!companies.length) throw new Error("هیچ شرکت تولیدی برای اجرا انتخاب نشد.");

  console.log(`تعداد شرکت انتخاب‌شده: ${companies.length} | ماه‌های موردنیاز: ${months.length}`);
  let completed = 0;
  const processed = await runPool(companies, options.concurrency ?? 3, async (company) => {
    let result;
    try {
      result = await processCompany({
        company,
        client,
        months,
        definitions,
        asOf,
        allowPartial: options.allowPartial ?? false,
      });
    } catch (error) {
      result = {
        ...company,
        periods: {},
        growth: {},
        status: "خطا",
        errors: [error.message],
        sources: [],
        downloadedReportCount: 0,
        requiredReportCount: months.length,
      };
    }
    completed += 1;
    console.log(`[${completed}/${companies.length}] ${company.symbol}: ${result.status}`);
    return result;
  });

  const industryGroups = buildIndustryGroups(processed, industries);
  const outputPath = path.resolve(
    options.outputPath
      ?? `outputs/monthly-manufacturing-${monthKey(definitions.targetMonth).replace("/", "-")}.xlsx`,
  );
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await writeReportWorkbook({
    industryGroups,
    metadata: {
      asOf: formatAsOf(asOf),
      executionMonth: definitions.executionMonth,
      targetMonth: definitions.targetMonth,
      definitions,
      allowPartial: options.allowPartial ?? false,
      sourceUrl: "https://www.codal.ir/",
      generatedAt: new Date().toISOString(),
    },
    outputPath,
  });

  const successCount = processed.filter((company) => company.downloadedReportCount > 0).length;
  return {
    outputPath,
    successCount,
    failureCount: processed.length - successCount,
    industryCount: industryGroups.length,
    companies: processed,
  };
}
