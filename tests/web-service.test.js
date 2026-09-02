import test from "node:test";
import assert from "node:assert/strict";

import { DashboardService, WebServiceError } from "../src/web/service.js";

function company(symbol, overrides = {}) {
  return {
    symbol,
    name: `شرکت ${symbol}`,
    industryId: 27,
    status: "کامل",
    definitions: { targetMonth: { year: 1405, month: 5 } },
    periods: {},
    growth: {},
    ...overrides,
  };
}

function collection(symbols = ["فولاد"], overrides = {}) {
  return {
    metadata: {
      asOf: "1405/06/09",
      generatedAt: "2026-08-31T12:00:00.000Z",
      targetMonth: { year: 1405, month: 5 },
    },
    industryGroups: [{
      industryId: 27,
      industryName: "فلزات اساسی",
      companies: symbols.map((symbol) => company(symbol)),
    }],
    ...overrides,
  };
}

function fakeDatabase(initial = collection()) {
  let stored = initial;
  return {
    upserted: [],
    metadataUpdates: [],
    upsertCollection(value) {
      this.upserted.push(value);
      stored = value;
    },
    getAllReports() {
      return stored.industryGroups.flatMap((industry) => industry.companies);
    },
    setMetadata(metadata) {
      this.metadataUpdates.push(metadata);
      stored = { ...stored, metadata };
    },
    getIndustryGroups(symbols = null) {
      const groups = stored.industryGroups.map((industry) => ({
        ...industry,
        companies: symbols === null
          ? [...industry.companies]
          : industry.companies.filter((item) => symbols.includes(item.symbol)),
      })).filter((industry) => industry.companies.length);
      const found = new Set(groups.flatMap((industry) => industry.companies.map((item) => item.symbol)));
      return {
        industryGroups: groups,
        missingSymbols: symbols === null ? [] : symbols.filter((symbol) => !found.has(symbol)),
      };
    },
    getMetadata() {
      return stored.metadata;
    },
    getSummary() {
      const companies = stored.industryGroups.flatMap((industry) => industry.companies);
      return {
        companyCount: companies.length,
        industryCount: stored.industryGroups.length,
        statusCounts: { کامل: companies.length },
        lastUpdatedAt: stored.metadata.generatedAt,
        metadata: stored.metadata,
      };
    },
  };
}

test("dashboard is reconstructed from persisted database data", () => {
  const database = fakeDatabase(collection(["فولاد", "فملی"]));
  const service = new DashboardService({
    database,
    pilotSymbols: ["فولاد", "فملی", "شپنا", "کگل"],
    logger: null,
  });

  const dashboard = service.getDashboard();
  assert.equal(dashboard.metadata.companyCount, 2);
  assert.equal(dashboard.metadata.industryCount, 1);
  assert.equal(dashboard.metadata.hasData, true);
  assert.deepEqual(dashboard.metadata.pilotSymbols, ["فولاد", "فملی", "شپنا", "کگل"]);
  assert.deepEqual(
    dashboard.industries[0].companies.map((item) => item.symbol),
    ["فولاد", "فملی"],
  );
});

test("selected update refreshes exactly the requested pilot symbols and persists the result", async () => {
  const database = fakeDatabase(collection(["فولاد"]));
  const calls = [];
  const refreshed = collection(["کگل"]);
  const service = new DashboardService({
    database,
    pilotSymbols: ["فولاد", "فملی", "شپنا", "کگل"],
    collect: async (options) => {
      calls.push(options);
      await options.onProgress({ type: "company-complete", completed: 1, total: 1, symbol: "کگل" });
      return refreshed;
    },
    logger: null,
  });

  const dashboard = await service.update({
    scope: "selected",
    symbols: ["كگل", "کگل"],
    asOf: "1405/06/09",
  });

  assert.deepEqual(calls[0].symbols, ["کگل"]);
  assert.equal(calls[0].refresh, false);
  assert.equal(calls[0].refreshSearch, true);
  assert.equal(calls[0].refreshReports, false);
  assert.equal(calls[0].companyDelayMs, 10_000);
  assert.equal(calls[0].existingCompanies.length, 1);
  assert.equal(calls[0].asOf, "1405/06/09");
  assert.deepEqual(database.upserted[0], refreshed);
  assert.equal(dashboard.industries[0].companies[0].symbol, "کگل");
  assert.equal(service.getUpdateState().running, false);
  assert.equal(service.getUpdateState().completed, 1);
});

test("all update requests every active manufacturing company", async () => {
  const database = fakeDatabase(collection());
  let receivedOptions = null;
  const pilotSymbols = ["فولاد", "فملی", "شپنا", "کگل"];
  const service = new DashboardService({
    database,
    pilotSymbols,
    collect: async (options) => {
      receivedOptions = options;
      return collection(pilotSymbols);
    },
    logger: null,
  });

  await service.update({ scope: "all" });
  assert.equal(receivedOptions.allSymbols, true);
  assert.equal(receivedOptions.symbols, undefined);
  assert.equal(receivedOptions.requestRetries, 4);
  assert.equal(receivedOptions.concurrency, 1);
});

test("an empty database performs a full initial download", async () => {
  const empty = collection([], { industryGroups: [] });
  const database = fakeDatabase(empty);
  let receivedOptions;
  const service = new DashboardService({
    database,
    collect: async (options) => {
      receivedOptions = options;
      return collection(["فولاد"]);
    },
    logger: null,
  });

  await service.update({ scope: "all" });
  assert.equal(receivedOptions.refreshSearch, true);
  assert.equal(receivedOptions.refreshReports, true);
  assert.deepEqual(receivedOptions.existingCompanies, []);
});

test("incremental checks do not rewrite unchanged stored companies", async () => {
  const initial = collection(["فولاد"]);
  const database = fakeDatabase(initial);
  const unchanged = company("فولاد", {
    updateAction: "unchanged",
    newOrChangedReportCount: 0,
  });
  const service = new DashboardService({
    database,
    collect: async (options) => {
      await options.onCompanyResult({
        company: unchanged,
        industryGroup: {
          industryId: 27,
          industryName: "Test industry",
          companies: [unchanged],
        },
        metadata: initial.metadata,
      });
      await options.onProgress({
        type: "company-complete",
        completed: 1,
        total: 1,
        symbol: unchanged.symbol,
        status: unchanged.status,
        updateAction: "unchanged",
      });
      return collection([unchanged.symbol], {
        industryGroups: [{
          industryId: 27,
          industryName: "Test industry",
          companies: [unchanged],
        }],
      });
    },
    logger: null,
  });

  const dashboard = await service.update({ scope: "selected", symbols: ["فولاد"] });
  assert.equal(database.upserted.length, 0);
  assert.equal(database.metadataUpdates.length, 1);
  assert.equal(dashboard.industries[0].companies[0].symbol, "فولاد");
  assert.equal(service.getUpdateState().updatedCount, 0);
  assert.equal(service.getUpdateState().unchangedCount, 1);
});

test("completed companies are checkpointed before a bulk update finishes", async () => {
  const database = fakeDatabase(collection(["فولاد"]));
  const checkpointCompany = company("فملی");
  const service = new DashboardService({
    database,
    collect: async (options) => {
      await options.onCompanyResult({
        company: checkpointCompany,
        industryGroup: {
          industryId: 27,
          industryName: "فلزات اساسی",
          companies: [checkpointCompany],
        },
        metadata: collection().metadata,
      });
      throw new Error("simulated interruption");
    },
    logger: null,
  });

  await assert.rejects(() => service.update({ scope: "all" }), /simulated interruption/);
  assert.equal(database.upserted.length, 1);
  assert.equal(database.upserted[0].industryGroups[0].companies[0].symbol, "فملی");
  assert.equal(service.getUpdateState().running, false);
  assert.match(service.getUpdateState().error, /simulated interruption/);
});

test("update rejects empty, unknown and invalid selection requests", async () => {
  const service = new DashboardService({
    database: fakeDatabase(),
    pilotSymbols: ["فولاد"],
    collect: async () => collection(),
    logger: null,
  });

  await assert.rejects(
    () => service.update({ scope: "selected", symbols: [] }),
    (error) => error instanceof WebServiceError && error.code === "EMPTY_SELECTION",
  );
  await assert.rejects(
    () => service.update({ scope: "selected", symbols: ["ناشناخته"] }),
    (error) => error instanceof WebServiceError && error.code === "UNKNOWN_SYMBOL",
  );
  await assert.rejects(
    () => service.update({ scope: "everything" }),
    (error) => error instanceof WebServiceError && error.code === "INVALID_UPDATE_SCOPE",
  );
});

test("Excel export keeps selected companies and uses the existing workbook pipeline", async () => {
  const database = fakeDatabase(collection(["فولاد", "فملی"]));
  let workbookInput = null;
  const service = new DashboardService({
    database,
    workbookFactory: (input) => {
      workbookInput = input;
      return { xlsx: { writeBuffer: async () => Uint8Array.from([80, 75, 3, 4]) } };
    },
    logger: null,
  });

  const exported = await service.createExcelExport(["فملی"]);
  assert.equal(exported.filename, "codal-selected-1405-05.xlsx");
  assert.equal(exported.companyCount, 1);
  assert.deepEqual([...exported.buffer], [80, 75, 3, 4]);
  assert.deepEqual(
    workbookInput.industryGroups[0].companies.map((item) => item.symbol),
    ["فملی"],
  );
  assert.equal(workbookInput.metadata.targetMonth.year, 1405);
});

test("Excel export rejects missing data and mixed target months", async () => {
  const mixed = collection(["فولاد", "فملی"]);
  mixed.industryGroups[0].companies[1].definitions.targetMonth = { year: 1405, month: 6 };
  const service = new DashboardService({ database: fakeDatabase(mixed), logger: null });

  await assert.rejects(
    () => service.createExcelExport(["نماد ناموجود"]),
    (error) => error instanceof WebServiceError && error.code === "REPORT_NOT_FOUND",
  );
  await assert.rejects(
    () => service.createExcelExport(["فولاد", "فملی"]),
    (error) => error instanceof WebServiceError && error.code === "MIXED_TARGET_MONTHS",
  );
});
