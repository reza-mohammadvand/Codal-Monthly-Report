import path from "node:path";

import {
  CodalClient,
  compareReportPriority,
  extractJalaliDate,
  extractReportPeriod,
  normalizeCodalText,
  resolveFiscalYearEndMonth,
} from "./codal.js";
import { DiskCache } from "./cache.js";
import { requestJson, requestText } from "./http.js";
import {
  buildSymbolPeriodMetrics,
  calculateGrowth,
  getReportPeriods,
} from "./periods.js";
import { StartIntervalGate, normalizePersianText, sleep } from "./utils.js";
import { writeReportWorkbook } from "./excel.js";

const METRIC_MAP = Object.freeze({
  totalProduction: "production",
  totalSales: "sales",
  totalRevenue: "revenue",
  dominantSales: "dominantProductSales",
  dominantRate: "dominantProductRate",
  weightedRate: "weightedRate",
});

export const DEFAULT_PILOT_SYMBOLS = Object.freeze(["فولاد", "فملی", "شپنا", "کگل"]);

const CONSOLE_STATUS_LABELS = Object.freeze({
  "کامل": "complete",
  "ناقص": "partial",
  "بدون داده": "no data",
  "خطای خواندن": "read error",
  "خطا": "error",
});

const CONSOLE_SYMBOL_LABELS = Object.freeze({
  [normalizeCodalText("فولاد")]: "FOOLAD",
  [normalizeCodalText("فملی")]: "FMLI",
  [normalizeCodalText("شپنا")]: "SHEPNA",
  [normalizeCodalText("کگل")]: "KGOL",
});

export function formatCompanyStatusForConsole(status) {
  return CONSOLE_STATUS_LABELS[status] ?? "unknown";
}

export function formatCompanySymbolForConsole(symbol, ordinal = null) {
  const label = CONSOLE_SYMBOL_LABELS[normalizeCodalText(symbol)];
  if (label) return label;
  return ordinal === null ? "COMPANY" : `COMPANY-${ordinal}`;
}

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
  if (!match) throw new Error("--as-of must use the Jalali YYYY/MM/DD format.");
  const result = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (result.month < 1 || result.month > 12 || result.day < 1 || result.day > 31) {
    throw new Error("--as-of contains an invalid month or day.");
  }
  return result;
}

function formatAsOf(value) {
  return `${value.year}/${String(value.month).padStart(2, "0")}/${String(value.day).padStart(2, "0")}`;
}

function resolveLogger(logger) {
  if (logger === null) return () => {};
  if (typeof logger === "function") return logger;
  if (logger && typeof logger.log === "function") return logger.log.bind(logger);
  return console.log;
}

async function emitProgress(onProgress, event) {
  if (typeof onProgress === "function") await onProgress(event);
}

function requiredMonths(definitions) {
  const unique = new Map();
  for (const period of Object.values(definitions.periods)) {
    for (const month of period.months) unique.set(monthKey(month), month);
  }
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
  const growth = {
    targetYoY: buildGrowthPeriod(periods.target, periods.priorTarget),
    ytdYoY: buildGrowthPeriod(periods.currentYtd, periods.priorYtd),
    targetMoM: buildGrowthPeriod(periods.target, periods.previous),
  };
  return {
    periods,
    growth,
  };
}

function createCodalRequestGate(searchIntervalMs) {
  const searchGate = new StartIntervalGate(searchIntervalMs);
  const reportGate = new StartIntervalGate(Math.min(searchIntervalMs, 100));
  return {
    wait(url) {
      const hostname = new URL(url).hostname.toLowerCase();
      return (hostname === "search.codal.ir" ? searchGate : reportGate).wait();
    },
    defer(url, delayMs) {
      const hostname = new URL(url).hostname.toLowerCase();
      (hostname === "search.codal.ir" ? searchGate : reportGate).defer(delayMs);
    },
  };
}

function createCachedTransport(cache, gate, requestOptions = {}, refreshPolicy = {}) {
  const shouldRefresh = (url) => {
    const isSearch = new URL(url).hostname.toLowerCase() === "search.codal.ir";
    return isSearch ? refreshPolicy.search === true : refreshPolicy.reports === true;
  };
  const optionsFor = (url) => ({
    ...requestOptions,
    onRetry(event) {
      gate.defer(url, event?.delayMs ?? 0);
      requestOptions.onRetry?.(event);
    },
  });
  return {
    async json(url) {
      const cached = shouldRefresh(url) ? null : await cache.getJson(url);
      if (cached !== null) return cached;
      await gate.wait(url);
      const value = await requestJson(url, optionsFor(url));
      await cache.setJson(url, value);
      return value;
    },
    async text(url) {
      const cached = shouldRefresh(url) ? null : await cache.getText(url, "html");
      if (cached !== null) return cached;
      await gate.wait(url);
      const value = await requestText(url, optionsFor(url));
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

export function selectCompanies(rawCompanies, options = {}) {
  const requestedSymbols = Array.isArray(options.symbols)
    ? options.symbols.map((symbol) => String(symbol).trim()).filter(Boolean)
    : [];
  if (options.allSymbols && requestedSymbols.length) {
    throw new Error("--symbols and --all-symbols cannot be used together.");
  }

  const eligible = deduplicateCompanies(rawCompanies)
    .filter((company) => [0, 1].includes(company.state));
  const selectedSymbols = options.allSymbols
    ? null
    : (requestedSymbols.length ? requestedSymbols : DEFAULT_PILOT_SYMBOLS);

  let selected = eligible;
  if (selectedSymbols) {
    const companiesBySymbol = new Map(
      eligible.map((company) => [normalizeCodalText(company.symbol), company]),
    );
    const missing = selectedSymbols
      .filter((symbol) => !companiesBySymbol.has(normalizeCodalText(symbol)));
    if (missing.length) {
      throw new Error(`Manufacturing symbol(s) not found: ${missing.join(", ")}`);
    }
    selected = selectedSymbols.map((symbol) => companiesBySymbol.get(normalizeCodalText(symbol)));
  }

  if (options.limit) selected = selected.slice(0, options.limit);
  if (!selected.length) throw new Error("No eligible manufacturing companies were selected.");
  return selected;
}

export function classifyCoverage({ requiredReportCount, foundReportCount, parsedReportCount }) {
  const required = Number(requiredReportCount) || 0;
  const found = Number(foundReportCount) || 0;
  const parsed = Number(parsedReportCount) || 0;
  if (required > 0 && parsed >= required) return "کامل";
  if (parsed > 0) return "ناقص";
  if (found > 0) return "خطای خواندن";
  return "بدون داده";
}

export function summarizeCompanyStatuses(companies) {
  const summary = {
    completeCount: 0,
    partialCount: 0,
    noDataCount: 0,
    readErrorCount: 0,
    errorCount: 0,
  };
  for (const company of companies) {
    if (company.status === "کامل") summary.completeCount += 1;
    else if (company.status === "ناقص") summary.partialCount += 1;
    else if (company.status === "بدون داده") summary.noDataCount += 1;
    else if (company.status === "خطای خواندن") summary.readErrorCount += 1;
    else summary.errorCount += 1;
  }
  return summary;
}

async function resolveCompanyFiscalContext({ company, client, executionMonth, asOf, existingCompany }) {
  const recentReports = await client.searchMonthlyReports({
    symbol: company.symbol,
    fromDate: `${Number(asOf.year) - 2}/01/01`,
    toDate: formatAsOf(asOf),
    allPages: true,
  });
  let financialYears = Array.isArray(existingCompany?.financialYears)
    ? existingCompany.financialYears
    : [];
  let fiscalYearEndMonth = Number(existingCompany?.fiscalYearEndMonth) || null;
  let fiscalYearSource = fiscalYearEndMonth === null
    ? "monthly-report-datasource"
    : "stored-company";

  for (const report of fiscalYearEndMonth === null ? recentReports.slice(0, 5) : []) {
    try {
      const datasource = await client.fetchReportDatasource(report);
      const fiscalYearEnd = extractJalaliDate(datasource?.yearEndToDate);
      if (fiscalYearEnd) {
        fiscalYearEndMonth = fiscalYearEnd.month;
        break;
      }
    } catch {
      // Try another recent filing before using the fiscal-years endpoint.
    }
  }

  if (fiscalYearEndMonth === null && recentReports.length > 0) {
    financialYears = await client.fetchFinancialYears(company.symbol);
    fiscalYearEndMonth = resolveFiscalYearEndMonth(financialYears);
    fiscalYearSource = "financial-years-api";
  }

  if (fiscalYearEndMonth === null) {
    if (recentReports.length === 0) {
      return {
        noReports: true,
        financialYears,
        fiscalYearEndMonth: null,
        fiscalYearStartMonth: null,
        fiscalYearSource: "unavailable-no-monthly-reports",
        definitions: null,
        months: [],
        requiredFromMonth: null,
        requiredToMonth: null,
      };
    }
    throw new Error(`No usable fiscal-year end date was returned by Codal for ${company.symbol}.`);
  }

  const definitions = getReportPeriods(executionMonth, { fiscalYearEndMonth });
  const months = requiredMonths(definitions);
  return {
    financialYears,
    fiscalYearEndMonth,
    fiscalYearStartMonth: definitions.fiscalYearStartMonth,
    fiscalYearSource,
    definitions,
    months,
    reports: recentReports,
    requiredFromMonth: months[0],
    requiredToMonth: months.at(-1),
  };
}

function reportIdentity(report) {
  const value = report?.TracingNo ?? report?.tracingNo ?? report?.source?.tracingNo;
  return value == null ? null : String(value);
}

async function processCompany({ company, client, context, asOf, allowPartial, existingCompany }) {
  const {
    definitions,
    financialYears,
    fiscalYearEndMonth,
    fiscalYearStartMonth,
    fiscalYearSource,
    months,
    requiredFromMonth,
    requiredToMonth,
    reports: preloadedReports,
  } = context;
  const from = months[0];
  const reports = preloadedReports ?? await client.searchMonthlyReports({
    symbol: company.symbol,
    fromDate: `${monthKey(from)}/01`,
    toDate: formatAsOf(asOf),
    allPages: true,
  });
  const reportsByMonth = new Map();
  for (const report of reports) {
    const period = extractReportPeriod(report);
    if (!period) continue;
    const key = monthKey(period);
    if (!reportsByMonth.has(key)) reportsByMonth.set(key, []);
    reportsByMonth.get(key).push(report);
  }
  for (const candidates of reportsByMonth.values()) {
    candidates.sort((left, right) => compareReportPriority(right, left));
  }
  const storedReportsByMonth = new Map(
    (Array.isArray(existingCompany?.monthlyReports) ? existingCompany.monthlyReports : [])
      .map((report) => [monthKey(report), report]),
  );
  const monthlyReports = [];
  const errors = [];
  let downloadedReportCount = 0;
  let newOrChangedReportCount = 0;
  const foundReportCount = months.filter((month) => reportsByMonth.has(monthKey(month))).length;
  const parsedMonths = await Promise.all(months.map(async (month) => {
    const candidates = reportsByMonth.get(monthKey(month)) ?? [];
    const storedReport = storedReportsByMonth.get(monthKey(month)) ?? null;
    if (!candidates.length) {
      if (storedReport) return { report: storedReport, reused: true };
      return { kind: "missing", month, error: `گزارش ${monthKey(month)} یافت نشد` };
    }
    const candidateErrors = [];
    for (const report of candidates) {
      if (storedReport && reportIdentity(report) === reportIdentity(storedReport)) {
        return { report: storedReport, reused: true };
      }
      try {
        const parsed = await client.fetchAndParseReport(report);
        const normalized = normalizeMonthlyReport(report, parsed);
        if (normalized) {
          downloadedReportCount += 1;
          if (reportIdentity(normalized) !== reportIdentity(storedReport)) {
            newOrChangedReportCount += 1;
          }
          return { report: normalized };
        }
        candidateErrors.push(`tracing ${report.TracingNo ?? "?"}: table not found`);
      } catch (error) {
        candidateErrors.push(`tracing ${report.TracingNo ?? "?"}: ${error.message}`);
      }
    }
    return {
      kind: "parse",
      month,
      error: `جدول تولید و فروش ${monthKey(month)} خوانده نشد (${candidateErrors.join(" | ")})`,
    };
  }));
  for (const item of parsedMonths) {
    if (item.report) monthlyReports.push(item.report);
    if (item.error) errors.push(item.error);
  }

  const calculated = buildSymbolPeriodMetrics(
    monthlyReports,
    definitions.executionMonth,
    { fiscalYearEndMonth },
  );
  const excelData = adaptPeriodResult(calculated, allowPartial);
  const parsedReportCount = monthlyReports.length;
  const missingReportCount = parsedMonths.filter((item) => item.kind === "missing").length;
  const parseFailureCount = parsedMonths.filter((item) => item.kind === "parse").length;
  const requiredReportCount = months.length;
  const status = classifyCoverage({
    requiredReportCount,
    foundReportCount,
    parsedReportCount,
  });
  return {
    ...company,
    ...excelData,
    definitions,
    financialYears,
    fiscalYearEndMonth,
    fiscalYearStartMonth,
    fiscalYearSource,
    requiredFromMonth,
    requiredToMonth,
    status,
    errors,
    sources: monthlyReports.map((report) => ({
      year: report.year,
      month: report.month,
      ...report.source,
    })),
    monthlyReports,
    downloadedReportCount,
    newOrChangedReportCount,
    updateAction: existingCompany && newOrChangedReportCount === 0
      ? "unchanged"
      : "updated",
    foundReportCount,
    parsedReportCount,
    missingReportCount,
    parseFailureCount,
    requiredReportCount,
    coverageRatio: requiredReportCount ? parsedReportCount / requiredReportCount : 0,
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

export async function collectMonthlyReportData(options = {}, dependencies = {}) {
  const asOf = parseAsOf(options.asOf);
  const definitions = getReportPeriods({ year: asOf.year, month: asOf.month });
  const log = resolveLogger(options.logger);
  const asOfLabel = formatAsOf(asOf);
  const targetMonthLabel = monthKey(definitions.targetMonth);
  let client = dependencies.client ?? options.client ?? null;
  if (!client) {
    const cache = new DiskCache(options.cacheDir ?? path.resolve(".cache/codal"), {
      refresh: false,
    });
    const gate = createCodalRequestGate(options.requestDelayMs ?? 500);
    const refreshAll = options.refresh === true;
    const transport = createCachedTransport(cache, gate, {
      retries: options.requestRetries ?? 4,
      retryDelayMs: options.retryDelayMs ?? 1_000,
      timeoutMs: options.timeoutMs ?? 60_000,
    }, {
      search: options.refreshSearch ?? refreshAll,
      reports: options.refreshReports ?? refreshAll,
    });
    client = new CodalClient({
      fetchJson: transport.json,
      fetchText: transport.text,
      retries: options.requestRetries ?? 4,
      timeoutMs: options.timeoutMs ?? 60_000,
    });
  }

  await emitProgress(options.onProgress, {
    type: "run-start",
    asOf: asOfLabel,
    targetMonth: targetMonthLabel,
  });
  log(`Run date: ${asOfLabel} | Target month: ${targetMonthLabel}`);
  log("Fetching manufacturing-company and industry lists...");
  const [rawCompanies, industries] = await Promise.all([
    client.fetchProductionCompanies(),
    client.fetchIndustries(),
  ]);
  const companyCatalogCount = selectCompanies(rawCompanies, { allSymbols: true }).length;
  const companies = selectCompanies(rawCompanies, options);
  const existingBySymbol = new Map(
    (Array.isArray(options.existingCompanies) ? options.existingCompanies : [])
      .map((company) => [normalizeCodalText(company?.symbol), company]),
  );

  await emitProgress(options.onProgress, {
    type: "companies-selected",
    companyCount: companies.length,
  });
  log(`Selected companies: ${companies.length} | Fiscal report windows are resolved per company.`);
  const generatedAtValue = typeof dependencies.now === "function"
    ? dependencies.now()
    : new Date();
  const metadata = {
    asOf: asOfLabel,
    executionMonth: definitions.executionMonth,
    targetMonth: definitions.targetMonth,
    definitions,
    allowPartial: options.allowPartial ?? false,
    companyCatalogCount,
    sourceUrl: "https://www.codal.ir/",
    generatedAt: new Date(generatedAtValue).toISOString(),
  };
  let completed = 0;
  const processed = await runPool(companies, options.concurrency ?? 2, async (company) => {
    let result;
    let context = null;
    const existingCompany = existingBySymbol.get(normalizeCodalText(company.symbol)) ?? null;
    try {
      context = await resolveCompanyFiscalContext({
        company,
        client,
        executionMonth: definitions.executionMonth,
        asOf,
        existingCompany,
      });
      result = context.noReports
        ? existingCompany
          ? {
              ...existingCompany,
              downloadedReportCount: 0,
              newOrChangedReportCount: 0,
              updateAction: "unchanged",
            }
          : {
            ...company,
            periods: {},
            growth: {},
            status: "بدون داده",
            errors: ["هیچ گزارش فعالیت ماهانه‌ای برای این نماد در کدال یافت نشد."],
            sources: [],
            downloadedReportCount: 0,
            foundReportCount: 0,
            parsedReportCount: 0,
            missingReportCount: 0,
            parseFailureCount: 0,
            requiredReportCount: 0,
            coverageRatio: 0,
            monthlyReports: [],
            newOrChangedReportCount: 0,
            updateAction: "updated",
            definitions: null,
            financialYears: context.financialYears,
            fiscalYearEndMonth: null,
            fiscalYearStartMonth: null,
            fiscalYearSource: context.fiscalYearSource,
            requiredFromMonth: null,
            requiredToMonth: null,
          }
        : await processCompany({
            company,
            client,
            context,
            asOf,
            allowPartial: options.allowPartial ?? false,
            existingCompany,
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
        foundReportCount: 0,
        parsedReportCount: 0,
        missingReportCount: context?.months.length ?? 0,
        parseFailureCount: 0,
        requiredReportCount: context?.months.length ?? 0,
        coverageRatio: 0,
        monthlyReports: existingCompany?.monthlyReports ?? [],
        newOrChangedReportCount: 0,
        updateAction: "error",
        definitions: context?.definitions,
        financialYears: context?.financialYears ?? [],
        fiscalYearEndMonth: context?.fiscalYearEndMonth ?? null,
        fiscalYearStartMonth: context?.fiscalYearStartMonth ?? null,
        fiscalYearSource: context?.fiscalYearSource ?? null,
        requiredFromMonth: context?.requiredFromMonth ?? null,
        requiredToMonth: context?.requiredToMonth ?? null,
      };
    }
    const [industryGroup] = buildIndustryGroups([result], industries);
    await emitProgress(options.onCompanyResult, {
      type: "company-result",
      company: result,
      industryGroup,
      metadata,
    });
    completed += 1;
    const progressEvent = {
      type: "company-complete",
      completed,
      total: companies.length,
      symbol: company.symbol,
      status: result.status,
      updateAction: result.updateAction,
      newOrChangedReportCount: result.newOrChangedReportCount ?? 0,
      statusLabel: formatCompanyStatusForConsole(result.status),
      parsedReportCount: result.parsedReportCount ?? 0,
      requiredReportCount: result.requiredReportCount ?? 0,
      fiscalYearEndMonth: result.fiscalYearEndMonth,
      fiscalYearStartMonth: result.fiscalYearStartMonth,
      requiredFromMonth: result.requiredFromMonth,
      requiredToMonth: result.requiredToMonth,
    };
    await emitProgress(options.onProgress, progressEvent);
    const fiscalWindow = result.requiredFromMonth && result.requiredToMonth
      ? `fiscal end ${String(result.fiscalYearEndMonth).padStart(2, "0")}; `
        + `window ${monthKey(result.requiredFromMonth)}-${monthKey(result.requiredToMonth)}`
      : "fiscal window unavailable";
    log(
      `[${completed}/${companies.length}] ${formatCompanySymbolForConsole(company.symbol, completed)}: `
      + `${progressEvent.statusLabel} `
      + `(${progressEvent.parsedReportCount}/${progressEvent.requiredReportCount} reports parsed; `
      + `${fiscalWindow})`,
    );
    const companyDelayMs = Math.max(0, Number(options.companyDelayMs) || 0);
    if (completed < companies.length && companyDelayMs > 0) {
      await emitProgress(options.onProgress, {
        type: "company-delay",
        completed,
        total: companies.length,
        delayMs: companyDelayMs,
      });
      await sleep(companyDelayMs);
    }
    return result;
  });

  const industryGroups = buildIndustryGroups(processed, industries);
  const statusSummary = summarizeCompanyStatuses(processed);
  metadata.updateMode = existingBySymbol.size > 0 ? "incremental" : "initial";
  metadata.updatedCompanyCount = processed.filter((company) => company.updateAction !== "unchanged").length;
  metadata.unchangedCompanyCount = processed.filter((company) => company.updateAction === "unchanged").length;
  const successCount = statusSummary.completeCount + statusSummary.partialCount;
  const result = {
    metadata,
    industryGroups,
    successCount,
    failureCount: processed.length - successCount,
    industryCount: industryGroups.length,
    companies: processed,
    ...statusSummary,
  };
  await emitProgress(options.onProgress, {
    type: "run-complete",
    companyCount: processed.length,
    industryCount: industryGroups.length,
    successCount: result.successCount,
    failureCount: result.failureCount,
    ...statusSummary,
  });
  return result;
}

export async function runMonthlyReport(options = {}, dependencies = {}) {
  const data = await collectMonthlyReportData(options, dependencies);
  const outputPath = path.resolve(
    options.outputPath
      ?? `outputs/monthly-manufacturing-${monthKey(data.metadata.targetMonth).replace("/", "-")}.xlsx`,
  );
  const workbookWriter = dependencies.writeReportWorkbook ?? writeReportWorkbook;
  await workbookWriter({
    industryGroups: data.industryGroups,
    metadata: data.metadata,
    outputPath,
  });
  return {
    ...data,
    outputPath,
  };
}
