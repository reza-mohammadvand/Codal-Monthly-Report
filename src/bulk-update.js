#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { ReportDatabase } from "./web/database.js";
import { DashboardService } from "./web/service.js";

const { values } = parseArgs({
  options: {
    "as-of": { type: "string" },
    database: { type: "string" },
    concurrency: { type: "string", default: "1" },
    delay: { type: "string", default: "1000" },
    "company-delay": { type: "string", default: "10000" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help) {
  console.log(`Codal database bulk update

Usage:
  npm run bulk-update -- [options]

Options:
  --as-of=YYYY/MM/DD  Jalali execution date; target month is one month earlier
  --database=PATH     SQLite database path (default: data/monthly-reports.sqlite)
  --concurrency=1     Concurrent company workers (keep 1 for safe pacing)
  --delay=1000        Delay between Codal search request starts in milliseconds
  --company-delay=10000  Pause after each company, in milliseconds
  --help              Show this help message`);
  process.exit(0);
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function nonNegativeNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return parsed;
}

const database = new ReportDatabase(
  path.resolve(values.database ?? "data/monthly-reports.sqlite"),
);
const service = new DashboardService({
  database,
  concurrency: positiveInteger(values.concurrency, "concurrency"),
  requestDelayMs: nonNegativeNumber(values.delay, "delay"),
  companyDelayMs: nonNegativeNumber(values["company-delay"], "company-delay"),
  requestRetries: 4,
  retryDelayMs: 5_000,
  logger: null,
});

let lastCompleted = -1;
const progressTimer = setInterval(() => {
  const state = service.getUpdateState();
  if (state.completed === lastCompleted) return;
  lastCompleted = state.completed;
  const total = state.total || "?";
  console.log(
    `Progress ${state.completed}/${total} | complete ${state.completeCount}`
    + ` | partial ${state.partialCount} | no data ${state.noDataCount}`
    + ` | read errors ${state.readErrorCount} | errors ${state.errorCount}`,
  );
}, 5_000);

try {
  console.log("Starting full update for all active manufacturing companies...");
  await service.update({ scope: "all", asOf: values["as-of"] ?? null });
  const state = service.getUpdateState();
  const summary = database.getSummary();
  console.log(
    `Update finished: ${state.completed}/${state.total} processed across ${summary.industryCount} industries.`,
  );
  console.log(
    `Complete ${state.completeCount} | partial ${state.partialCount}`
    + ` | no data ${state.noDataCount} | read errors ${state.readErrorCount}`
    + ` | errors ${state.errorCount}`,
  );
} catch (error) {
  const state = service.getUpdateState();
  console.error(
    `Bulk update failed after ${state.completed}/${state.total || "?"} companies: ${error.message}`,
  );
  process.exitCode = 1;
} finally {
  clearInterval(progressTimer);
  database.close();
}
