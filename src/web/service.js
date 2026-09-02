import path from "node:path";

import { normalizeCodalText } from "../codal.js";
import { createReportWorkbook } from "../excel.js";
import {
  collectMonthlyReportData,
  DEFAULT_PILOT_SYMBOLS,
} from "../pipeline.js";

export class WebServiceError extends Error {
  constructor(message, statusCode = 400, code = "BAD_REQUEST") {
    super(message);
    this.name = "WebServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function monthKey(value) {
  if (!value || !Number.isInteger(Number(value.year)) || !Number.isInteger(Number(value.month))) {
    return null;
  }
  return `${Number(value.year)}-${String(Number(value.month)).padStart(2, "0")}`;
}

function cleanSymbolList(values) {
  if (!Array.isArray(values)) {
    throw new WebServiceError("فهرست نمادها معتبر نیست.", 400, "INVALID_SYMBOLS");
  }
  const symbols = [];
  const seen = new Set();
  for (const value of values) {
    const symbol = String(value ?? "").trim();
    const normalized = normalizeCodalText(symbol);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    symbols.push(symbol);
  }
  return symbols;
}

function resolveAllowedSymbols(values, allowedSymbols) {
  const requested = cleanSymbolList(values);
  const allowed = new Map(
    allowedSymbols.map((symbol) => [normalizeCodalText(symbol), symbol]),
  );
  const unknown = requested.filter((symbol) => !allowed.has(normalizeCodalText(symbol)));
  if (unknown.length) {
    throw new WebServiceError(
      `نماد در فهرست شرکت‌های ذخیره‌شده نیست: ${unknown.join("، ")}`,
      400,
      "UNKNOWN_SYMBOL",
    );
  }
  return requested.map((symbol) => allowed.get(normalizeCodalText(symbol)));
}

function flattenCompanies(industryGroups) {
  return industryGroups.flatMap((industry) => (
    Array.isArray(industry?.companies) ? industry.companies : []
  ));
}

function statusCounterKey(status) {
  if (status === "کامل") return "completeCount";
  if (status === "ناقص") return "partialCount";
  if (status === "بدون داده") return "noDataCount";
  if (status === "خطای خواندن") return "readErrorCount";
  return "errorCount";
}

function companyTargetMonth(company) {
  return company?.definitions?.targetMonth
    ?? company?.periodDefinitions?.targetMonth
    ?? null;
}

function exportFilename(companies) {
  const target = monthKey(companyTargetMonth(companies[0]));
  return `codal-selected-${target ?? "report"}.xlsx`;
}

export class DashboardService {
  constructor({
    database,
    collect = collectMonthlyReportData,
    workbookFactory = createReportWorkbook,
    pilotSymbols = DEFAULT_PILOT_SYMBOLS,
    cacheDir = path.resolve(".cache/codal"),
    concurrency = 1,
    requestDelayMs = 1_000,
    companyDelayMs = 10_000,
    requestRetries = 4,
    retryDelayMs = 1_000,
    logger = console,
  } = {}) {
    if (!database) throw new TypeError("database is required.");
    if (typeof collect !== "function") throw new TypeError("collect must be a function.");
    if (typeof workbookFactory !== "function") {
      throw new TypeError("workbookFactory must be a function.");
    }
    this.database = database;
    this.collect = collect;
    this.workbookFactory = workbookFactory;
    this.pilotSymbols = [...pilotSymbols];
    this.cacheDir = cacheDir;
    this.concurrency = concurrency;
    this.requestDelayMs = requestDelayMs;
    this.companyDelayMs = companyDelayMs;
    this.requestRetries = requestRetries;
    this.retryDelayMs = retryDelayMs;
    this.logger = logger;
    this.activeUpdate = null;
    this.updateState = {
      running: false,
      completed: 0,
      total: 0,
      symbol: null,
      startedAt: null,
      finishedAt: null,
      error: null,
      completeCount: 0,
      partialCount: 0,
      noDataCount: 0,
      readErrorCount: 0,
      errorCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
    };
  }

  getDashboard() {
    const { industryGroups } = this.database.getIndustryGroups();
    const summary = this.database.getSummary();
    return {
      metadata: {
        ...(summary.metadata ?? {}),
        companyCount: summary.companyCount,
        industryCount: summary.industryCount,
        statusCounts: summary.statusCounts,
        lastUpdatedAt: summary.lastUpdatedAt,
        pilotSymbols: [...this.pilotSymbols],
        updateAllMode: "all-manufacturing-companies",
        hasData: summary.companyCount > 0,
        update: { ...this.updateState },
      },
      industries: industryGroups,
    };
  }

  getUpdateState() {
    return { ...this.updateState };
  }

  async update({ scope, symbols = [], asOf = null } = {}) {
    if (this.activeUpdate) {
      throw new WebServiceError(
        "یک بروزرسانی دیگر در حال اجراست.",
        409,
        "UPDATE_IN_PROGRESS",
      );
    }
    const updateAll = scope === "all";
    const storedCompanies = typeof this.database.getAllReports === "function"
      ? this.database.getAllReports()
      : flattenCompanies(this.database.getIndustryGroups().industryGroups);
    const storedSymbols = storedCompanies
      .map((company) => company.symbol)
      .filter(Boolean);
    const storedSymbolSet = new Set(storedSymbols.map(normalizeCodalText));
    const initialLoad = storedCompanies.length === 0;
    const selectedSymbols = scope === "selected"
      ? resolveAllowedSymbols(symbols, [...this.pilotSymbols, ...storedSymbols])
      : updateAll ? [] : null;
    if (selectedSymbols === null) {
      throw new WebServiceError(
        "نوع بروزرسانی باید all یا selected باشد.",
        400,
        "INVALID_UPDATE_SCOPE",
      );
    }
    if (!updateAll && !selectedSymbols.length) {
      throw new WebServiceError(
        "حداقل یک نماد را برای بروزرسانی انتخاب کنید.",
        400,
        "EMPTY_SELECTION",
      );
    }

    const startedAt = new Date().toISOString();
    this.updateState = {
      running: true,
      completed: 0,
      total: updateAll ? 0 : selectedSymbols.length,
      symbol: null,
      startedAt,
      finishedAt: null,
      error: null,
      completeCount: 0,
      partialCount: 0,
      noDataCount: 0,
      readErrorCount: 0,
      errorCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
    };

    const run = (async () => {
      try {
        const collection = await this.collect({
          ...(updateAll ? { allSymbols: true } : { symbols: selectedSymbols }),
          asOf,
          cacheDir: this.cacheDir,
          concurrency: this.concurrency,
          requestDelayMs: this.requestDelayMs,
          companyDelayMs: this.companyDelayMs,
          requestRetries: this.requestRetries,
          retryDelayMs: this.retryDelayMs,
          refresh: false,
          refreshSearch: true,
          refreshReports: initialLoad,
          existingCompanies: storedCompanies,
          logger: null,
          onCompanyResult: (event) => {
            if (!event?.company || !event?.industryGroup) return;
            if (event.company.updateAction === "unchanged") return;
            if (
              event.company.updateAction === "error"
              && storedSymbolSet.has(normalizeCodalText(event.company.symbol))
            ) return;
            this.database.upsertCollection({
              metadata: event.metadata ?? {},
              industryGroups: [event.industryGroup],
            });
          },
          onProgress: (event) => {
            if (event?.type === "companies-selected") {
              this.updateState = {
                ...this.updateState,
                total: Number(event.companyCount) || this.updateState.total,
              };
              return;
            }
            if (event?.type !== "company-complete") return;
            const counterKey = statusCounterKey(event.status);
            const actionKey = event.updateAction === "unchanged"
              ? "unchangedCount"
              : "updatedCount";
            this.updateState = {
              ...this.updateState,
              completed: Number(event.completed) || this.updateState.completed,
              total: Number(event.total) || this.updateState.total,
              symbol: event.symbol ?? this.updateState.symbol,
              [counterKey]: this.updateState[counterKey] + 1,
              [actionKey]: this.updateState[actionKey] + 1,
            };
          },
        });
        const changedIndustryGroups = (collection.industryGroups ?? [])
          .map((industry) => ({
            ...industry,
            companies: (industry.companies ?? []).filter((company) => (
              company.updateAction !== "unchanged"
              && !(
                company.updateAction === "error"
                && storedSymbolSet.has(normalizeCodalText(company.symbol))
              )
            )),
          }))
          .filter((industry) => industry.companies.length > 0);
        if (changedIndustryGroups.length > 0) {
          this.database.upsertCollection({
            metadata: collection.metadata,
            industryGroups: changedIndustryGroups,
          });
        } else if (typeof this.database.setMetadata === "function") {
          this.database.setMetadata(collection.metadata);
        }
        const processedCount = Array.isArray(collection.companies)
          ? collection.companies.length
          : flattenCompanies(collection.industryGroups ?? []).length;
        this.updateState = {
          ...this.updateState,
          running: false,
          completed: processedCount,
          total: this.updateState.total || processedCount,
          finishedAt: new Date().toISOString(),
        };
        return this.getDashboard();
      } catch (error) {
        this.updateState = {
          ...this.updateState,
          running: false,
          finishedAt: new Date().toISOString(),
          error: error?.message ?? String(error),
        };
        throw error;
      } finally {
        this.activeUpdate = null;
      }
    })();
    this.activeUpdate = run;
    return run;
  }

  async createExcelExport(symbols) {
    const selectedSymbols = cleanSymbolList(symbols);
    if (!selectedSymbols.length) {
      throw new WebServiceError(
        "حداقل یک نماد را برای خروجی اکسل انتخاب کنید.",
        400,
        "EMPTY_SELECTION",
      );
    }

    const { industryGroups, missingSymbols } = this.database.getIndustryGroups(selectedSymbols);
    if (missingSymbols.length) {
      throw new WebServiceError(
        `برای این نمادها داده‌ای در دیتابیس نیست: ${missingSymbols.join("، ")}`,
        404,
        "REPORT_NOT_FOUND",
      );
    }
    const companies = flattenCompanies(industryGroups);
    if (!companies.length) {
      throw new WebServiceError("داده‌ای برای خروجی اکسل وجود ندارد.", 404, "REPORT_NOT_FOUND");
    }

    const targetMonths = new Set(
      companies.map((company) => monthKey(companyTargetMonth(company))).filter(Boolean),
    );
    if (targetMonths.size > 1) {
      throw new WebServiceError(
        "ماه مبنای نمادهای انتخاب‌شده یکسان نیست؛ ابتدا همان نمادها را بروزرسانی کنید.",
        409,
        "MIXED_TARGET_MONTHS",
      );
    }

    const firstCompany = companies[0];
    const storedMetadata = this.database.getMetadata() ?? {};
    const metadata = {
      ...storedMetadata,
      definitions: firstCompany.definitions ?? storedMetadata.definitions,
      targetMonth: companyTargetMonth(firstCompany) ?? storedMetadata.targetMonth,
      generatedAt: new Date().toISOString(),
      title: `گزارش ماهانه ${companies.length} نماد منتخب`,
    };
    const workbook = this.workbookFactory({ industryGroups, metadata });
    if (!workbook?.xlsx || typeof workbook.xlsx.writeBuffer !== "function") {
      throw new TypeError("Workbook factory did not return an XLSX workbook.");
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
      filename: exportFilename(companies),
      companyCount: companies.length,
    };
  }
}
