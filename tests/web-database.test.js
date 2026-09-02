import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ReportDatabase } from "../src/web/database.js";

function report(symbol, industryId, overrides = {}) {
  return {
    symbol,
    name: `Company ${symbol}`,
    industryId,
    status: "complete",
    fiscalYearEndMonth: 12,
    periods: { target: { amount: symbol.length * 100 } },
    growth: { targetYoY: { amount: 0.15 } },
    sources: [`https://example.test/${symbol}`],
    ...overrides,
  };
}

function collection({ generatedAt = "2026-09-01T08:00:00.000Z", groups } = {}) {
  return {
    metadata: {
      asOf: "1405/06/10",
      generatedAt,
      targetMonth: { year: 1405, month: 5 },
    },
    industryGroups: groups ?? [
      {
        industryId: 20,
        industryName: "Metals",
        board: "main",
        companies: [report("FOOLAD", 20), report("FMLI", 20)],
      },
      {
        industryId: 30,
        industryName: "Refineries",
        board: "second",
        companies: [report("SHEPNA", 30)],
      },
    ],
  };
}

function withTempDatabase(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), "codal-report-db-"));
  const filename = path.join(directory, "nested", "reports.sqlite");
  try {
    return callback(filename);
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

test("report collections persist after the database is reopened", () => {
  withTempDatabase((filename) => {
    const first = new ReportDatabase(filename);
    assert.deepEqual(first.upsertCollection(collection()), {
      upsertedCount: 3,
      collectedAt: "2026-09-01T08:00:00.000Z",
    });
    first.close();

    const reopened = new ReportDatabase(filename);
    assert.deepEqual(
      reopened.getAllReports().map((item) => item.symbol).sort(),
      ["FMLI", "FOOLAD", "SHEPNA"],
    );
    assert.deepEqual(
      reopened.getReportsBySymbols(["FOOLAD"]).reports[0],
      {
        updatedAt: "2026-09-01T08:00:00.000Z",
        storedAsOf: "1405/06/10",
        ...report("FOOLAD", 20),
      },
    );
    assert.deepEqual(reopened.getMetadata(), collection().metadata);
    reopened.close();
  });
});

test("upsert replaces the full original report while retaining unselected companies", () => {
  withTempDatabase((filename) => {
    const database = new ReportDatabase(filename);
    database.upsertCollection(collection());
    const replacement = report("FMLI", 20, {
      status: "partial",
      fiscalYearEndMonth: 9,
      periods: { target: { amount: 999_999 }, extra: { quantity: 42 } },
      errors: ["one report missing"],
    });
    database.upsertCollection(collection({
      generatedAt: "2026-09-02T09:30:00.000Z",
      groups: [{
        industryId: 20,
        industryName: "Base Metals",
        board: "updated-board",
        companies: [replacement],
      }],
    }));

    const { reports } = database.getReportsBySymbols(["FMLI"]);
    assert.deepEqual(reports, [{
      updatedAt: "2026-09-02T09:30:00.000Z",
      storedAsOf: "1405/06/10",
      ...replacement,
    }]);
    assert.equal(database.getAllReports().length, 3);
    assert.equal(database.getSummary().statusCounts.partial, 1);
    assert.equal(database.getSummary().lastUpdatedAt, "2026-09-02T09:30:00.000Z");
    database.close();
  });
});

test("selected reports preserve request order and report missing symbols", () => {
  withTempDatabase((filename) => {
    const database = new ReportDatabase(filename);
    database.upsertCollection(collection());

    const selected = database.getReportsBySymbols(["SHEPNA", "MISSING", "FOOLAD"]);
    assert.deepEqual(selected.reports.map((item) => item.symbol), ["SHEPNA", "FOOLAD"]);
    assert.deepEqual(selected.missingSymbols, ["MISSING"]);

    const grouped = database.getIndustryGroups(["SHEPNA", "FOOLAD"]);
    assert.deepEqual(
      grouped.industryGroups.map((group) => group.companies.map((item) => item.symbol)),
      [["SHEPNA"], ["FOOLAD"]],
    );
    assert.equal(
      grouped.industryGroups[0].companies[0].updatedAt,
      "2026-09-01T08:00:00.000Z",
    );
    database.close();
  });
});

test("grouping restores industry metadata and summary information", () => {
  withTempDatabase((filename) => {
    const database = new ReportDatabase(filename);
    const input = collection();
    database.upsertCollection(input);

    const grouped = database.getIndustryGroups();
    assert.deepEqual(grouped.missingSymbols, []);
    assert.equal(grouped.industryGroups.length, 2);
    assert.deepEqual(
      grouped.industryGroups.map(({ industryId, industryName, board, companies }) => ({
        industryId,
        industryName,
        board,
        symbols: companies.map((item) => item.symbol),
      })),
      [
        { industryId: 20, industryName: "Metals", board: "main", symbols: ["FMLI", "FOOLAD"] },
        { industryId: 30, industryName: "Refineries", board: "second", symbols: ["SHEPNA"] },
      ],
    );
    assert.deepEqual(database.getSummary(), {
      companyCount: 3,
      industryCount: 2,
      statusCounts: { complete: 3 },
      lastUpdatedAt: "2026-09-01T08:00:00.000Z",
      metadata: input.metadata,
    });
    database.close();
  });
});

test("empty and missing selections do not fabricate report data", () => {
  withTempDatabase((filename) => {
    const database = new ReportDatabase(filename);
    assert.deepEqual(database.getAllReports(), []);
    assert.deepEqual(database.getReportsBySymbols(["UNKNOWN"]), {
      reports: [],
      missingSymbols: ["UNKNOWN"],
    });
    assert.deepEqual(database.getIndustryGroups([]), {
      industryGroups: [],
      missingSymbols: [],
    });
    assert.deepEqual(database.getSummary(), {
      companyCount: 0,
      industryCount: 0,
      statusCounts: {},
      lastUpdatedAt: null,
      metadata: null,
    });
    database.close();
  });
});

test("metadata can advance without rewriting company reports", () => {
  withTempDatabase((filename) => {
    const database = new ReportDatabase(filename);
    database.upsertCollection(collection());
    const before = database.getReportsBySymbols(["FOOLAD"]).reports[0].updatedAt;
    const metadata = {
      ...collection().metadata,
      generatedAt: "2026-09-03T10:00:00.000Z",
      updateMode: "incremental",
      updatedCompanyCount: 0,
    };
    database.setMetadata(metadata);
    assert.deepEqual(database.getMetadata(), metadata);
    assert.equal(database.getReportsBySymbols(["FOOLAD"]).reports[0].updatedAt, before);
    database.close();
  });
});
