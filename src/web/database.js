import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const METADATA_KEY = "latest_collection_metadata";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeSymbol(value) {
  return String(value ?? "").trim();
}

function parseJson(value, fallback = null) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function statusKey(status) {
  const value = String(status ?? "").trim();
  return value || "unknown";
}

function hydrateReport(row) {
  const report = parseJson(row?.report_json);
  if (!report) return null;
  return {
    updatedAt: row.collected_at ?? null,
    storedAsOf: row.run_as_of ?? null,
    ...report,
  };
}

function prepareDatabaseDirectory(filename) {
  if (filename === ":memory:" || String(filename).startsWith("file:")) return;
  mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
}

/**
 * Persistent storage for the latest report of each company.
 *
 * The complete company object produced by collectMonthlyReportData is retained
 * in report_json. This makes rows suitable for both the web UI and the existing
 * Excel writer without having to rebuild the report from normalized columns.
 */
export class ReportDatabase {
  constructor(filename = path.resolve("data/monthly-reports.sqlite")) {
    prepareDatabaseDirectory(filename);
    this.database = new DatabaseSync(filename);
    this.closed = false;
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
    this.#initialize();
    this.#prepareStatements();
  }

  #assertOpen() {
    if (this.closed) throw new Error("Report database is closed.");
  }

  #initialize() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS company_reports (
        symbol TEXT PRIMARY KEY,
        company_name TEXT NOT NULL DEFAULT '',
        industry_id INTEGER,
        industry_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        fiscal_year_end_month INTEGER,
        report_json TEXT NOT NULL,
        industry_json TEXT NOT NULL,
        collected_at TEXT NOT NULL,
        run_as_of TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_company_reports_industry
        ON company_reports (industry_name, industry_id, symbol);

      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
  }

  #prepareStatements() {
    this.upsertReportStatement = this.database.prepare(`
      INSERT INTO company_reports (
        symbol,
        company_name,
        industry_id,
        industry_name,
        status,
        fiscal_year_end_month,
        report_json,
        industry_json,
        collected_at,
        run_as_of
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        company_name = excluded.company_name,
        industry_id = excluded.industry_id,
        industry_name = excluded.industry_name,
        status = excluded.status,
        fiscal_year_end_month = excluded.fiscal_year_end_month,
        report_json = excluded.report_json,
        industry_json = excluded.industry_json,
        collected_at = excluded.collected_at,
        run_as_of = excluded.run_as_of
    `);
    this.upsertMetaStatement = this.database.prepare(`
      INSERT INTO app_meta (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `);
    this.selectAllStatement = this.database.prepare(`
      SELECT report_json, collected_at, run_as_of
      FROM company_reports
      ORDER BY industry_name, industry_id, symbol
    `);
    this.selectBySymbolStatement = this.database.prepare(`
      SELECT report_json, collected_at, run_as_of
      FROM company_reports
      WHERE symbol = ?
    `);
    this.selectGroupedRowsStatement = this.database.prepare(`
      SELECT
        symbol,
        industry_id,
        industry_name,
        industry_json,
        report_json,
        collected_at,
        run_as_of
      FROM company_reports
      ORDER BY industry_name, industry_id, symbol
    `);
    this.selectGroupingBySymbolStatement = this.database.prepare(`
      SELECT industry_id, industry_name, industry_json, collected_at, run_as_of
      FROM company_reports
      WHERE symbol = ?
    `);
    this.selectMetaStatement = this.database.prepare(`
      SELECT value_json
      FROM app_meta
      WHERE key = ?
    `);
    this.selectSummaryRowsStatement = this.database.prepare(`
      SELECT industry_id, industry_name, status, collected_at
      FROM company_reports
    `);
  }

  /**
   * Transactionally inserts or replaces the companies present in one pipeline
   * result. Companies from earlier selected updates are intentionally retained.
   */
  upsertCollection(result) {
    this.#assertOpen();
    if (!isObject(result)) throw new TypeError("Collection result must be an object.");
    if (!Array.isArray(result.industryGroups)) {
      throw new TypeError("Collection result must contain an industryGroups array.");
    }
    const metadata = isObject(result.metadata) ? result.metadata : {};
    const collectedAt = typeof metadata.generatedAt === "string" && metadata.generatedAt
      ? metadata.generatedAt
      : new Date().toISOString();
    const runAsOf = metadata.asOf == null ? null : String(metadata.asOf);
    const rows = [];
    const seenSymbols = new Set();

    for (const industryGroup of result.industryGroups) {
      if (!isObject(industryGroup) || !Array.isArray(industryGroup.companies)) {
        throw new TypeError("Every industry group must contain a companies array.");
      }
      const industryMetadata = { ...industryGroup };
      delete industryMetadata.companies;
      const fallbackIndustryId = industryGroup.industryId ?? null;
      const fallbackIndustryName = String(industryGroup.industryName ?? "");

      for (const report of industryGroup.companies) {
        if (!isObject(report)) throw new TypeError("Every company report must be an object.");
        const symbol = normalizeSymbol(report.symbol);
        if (!symbol) throw new TypeError("Every company report must have a non-empty symbol.");
        if (seenSymbols.has(symbol)) {
          throw new Error(`Duplicate company symbol in collection: ${symbol}`);
        }
        seenSymbols.add(symbol);
        const industryId = report.industryId ?? fallbackIndustryId;
        rows.push({
          symbol,
          companyName: String(report.name ?? report.companyName ?? ""),
          industryId: industryId == null ? null : Number(industryId),
          industryName: fallbackIndustryName,
          status: String(report.status ?? ""),
          fiscalYearEndMonth: report.fiscalYearEndMonth == null
            ? null
            : Number(report.fiscalYearEndMonth),
          reportJson: JSON.stringify(report),
          industryJson: JSON.stringify(industryMetadata),
        });
      }
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        this.upsertReportStatement.run(
          row.symbol,
          row.companyName,
          row.industryId,
          row.industryName,
          row.status,
          row.fiscalYearEndMonth,
          row.reportJson,
          row.industryJson,
          collectedAt,
          runAsOf,
        );
      }
      this.upsertMetaStatement.run(
        METADATA_KEY,
        JSON.stringify(metadata),
        collectedAt,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return {
      upsertedCount: rows.length,
      collectedAt,
    };
  }

  getAllReports() {
    this.#assertOpen();
    return this.selectAllStatement.all()
      .map(hydrateReport)
      .filter(Boolean);
  }

  /** Returns reports in exactly the requested symbol order. */
  getReportsBySymbols(symbols) {
    this.#assertOpen();
    if (!Array.isArray(symbols)) throw new TypeError("symbols must be an array.");
    const reports = [];
    const missingSymbols = [];
    for (const value of symbols) {
      const symbol = normalizeSymbol(value);
      if (!symbol) {
        missingSymbols.push(symbol);
        continue;
      }
      const row = this.selectBySymbolStatement.get(symbol);
      const report = hydrateReport(row);
      if (report) reports.push(report);
      else missingSymbols.push(symbol);
    }
    return { reports, missingSymbols };
  }

  /**
   * Reconstructs the collectMonthlyReportData industryGroups shape. When a
   * selection is supplied, industry and company order follow its first use.
   */
  getIndustryGroups(symbols = null) {
    this.#assertOpen();
    let rows;
    let missingSymbols = [];
    if (symbols === null) {
      rows = this.selectGroupedRowsStatement.all().map((row) => ({
        report: hydrateReport(row),
        industry: parseJson(row.industry_json, {}),
        industryId: row.industry_id,
        industryName: row.industry_name,
      }));
    } else {
      const selected = this.getReportsBySymbols(symbols);
      missingSymbols = selected.missingSymbols;
      rows = selected.reports.map((report) => {
        const persisted = this.selectGroupingBySymbolStatement.get(normalizeSymbol(report.symbol));
        return {
          report,
          industry: parseJson(persisted?.industry_json, {}),
          industryId: persisted?.industry_id ?? report.industryId ?? null,
          industryName: persisted?.industry_name ?? "",
        };
      });
    }

    const groups = new Map();
    for (const row of rows) {
      if (!row.report) continue;
      const key = `${row.industryId ?? ""}\u0000${row.industryName}`;
      if (!groups.has(key)) {
        groups.set(key, {
          ...row.industry,
          industryId: row.industry?.industryId ?? row.industryId,
          industryName: row.industry?.industryName ?? row.industryName,
          companies: [],
        });
      }
      groups.get(key).companies.push(row.report);
    }
    return { industryGroups: [...groups.values()], missingSymbols };
  }

  getMetadata() {
    this.#assertOpen();
    const row = this.selectMetaStatement.get(METADATA_KEY);
    return row ? parseJson(row.value_json, {}) : null;
  }

  setMetadata(metadata) {
    this.#assertOpen();
    if (!isObject(metadata)) throw new TypeError("metadata must be an object.");
    const updatedAt = typeof metadata.generatedAt === "string" && metadata.generatedAt
      ? metadata.generatedAt
      : new Date().toISOString();
    this.upsertMetaStatement.run(METADATA_KEY, JSON.stringify(metadata), updatedAt);
    return { updatedAt };
  }

  getSummary() {
    this.#assertOpen();
    const rows = this.selectSummaryRowsStatement.all();
    const industries = new Set();
    const statusCounts = {};
    let lastUpdatedAt = null;
    for (const row of rows) {
      industries.add(`${row.industry_id ?? ""}\u0000${row.industry_name}`);
      const key = statusKey(row.status);
      statusCounts[key] = (statusCounts[key] ?? 0) + 1;
      if (lastUpdatedAt === null || row.collected_at > lastUpdatedAt) {
        lastUpdatedAt = row.collected_at;
      }
    }
    return {
      companyCount: rows.length,
      industryCount: industries.size,
      statusCounts,
      lastUpdatedAt,
      metadata: this.getMetadata(),
    };
  }

  close() {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }
}

export function openReportDatabase(filename) {
  return new ReportDatabase(filename);
}
