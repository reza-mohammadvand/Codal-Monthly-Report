#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import {
  DEFAULT_PILOT_SYMBOLS,
  formatCompanySymbolForConsole,
  runMonthlyReport,
} from "./pipeline.js";

const HELP = `
Codal Monthly Manufacturing Report

Usage:
  npm start -- [options]

Default pilot symbols: ${DEFAULT_PILOT_SYMBOLS
    .map((symbol, index) => formatCompanySymbolForConsole(symbol, index + 1))
    .join(", ")}

Options:
  --as-of=YYYY/MM/DD       Jalali execution date; the target report month is one month earlier
  --symbols=SYM1,SYM2     Override the default pilot symbol list with Codal symbols
  --all-symbols           Process every active manufacturing company
  --limit=10              Limit the number of companies for testing
  --output=PATH           Path to the output XLSX file
  --cache-dir=PATH        Codal download cache directory (default: .cache/codal)
  --concurrency=2         Number of companies processed concurrently
  --delay=500             Delay between request starts, in milliseconds
  --allow-partial         Calculate averages when some monthly reports are missing
  --refresh               Ignore cached data and download it again
  --help                  Show this help message

Examples:
  npm start
  npm run sample
  npm start -- --symbols=SYM1,SYM2 --as-of=1405/06/09
  npm start -- --all-symbols
`;

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseCliOptions() {
  const { values } = parseArgs({
    options: {
      "as-of": { type: "string" },
      symbols: { type: "string" },
      "all-symbols": { type: "boolean", default: false },
      limit: { type: "string" },
      output: { type: "string" },
      "cache-dir": { type: "string" },
      concurrency: { type: "string", default: "2" },
      delay: { type: "string", default: "500" },
      "allow-partial": { type: "boolean", default: false },
      refresh: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.help) return { help: true };
  const hasSymbolsOption = values.symbols !== undefined;
  const symbols = hasSymbolsOption
    ? values.symbols.split(",").map((item) => item.trim()).filter(Boolean)
    : null;
  if (hasSymbolsOption && !symbols.length) {
    throw new Error("--symbols cannot be empty.");
  }
  if (symbols?.length && values["all-symbols"]) {
    throw new Error("--symbols and --all-symbols cannot be used together.");
  }

  return {
    asOf: values["as-of"] ?? null,
    symbols,
    allSymbols: values["all-symbols"],
    limit: values.limit ? positiveInteger(values.limit, "limit") : null,
    outputPath: values.output ? path.resolve(values.output) : null,
    cacheDir: path.resolve(values["cache-dir"] ?? ".cache/codal"),
    concurrency: positiveInteger(values.concurrency, "concurrency"),
    requestDelayMs: Math.max(0, Number(values.delay) || 0),
    allowPartial: values["allow-partial"],
    refresh: values.refresh,
  };
}

try {
  const options = parseCliOptions();
  if (options.help) {
    console.log(HELP.trim());
    process.exitCode = 0;
  } else {
    const result = await runMonthlyReport(options);
    console.log(`\nOutput created: ${result.outputPath}`);
    console.log(
      `Complete: ${result.completeCount} | Partial: ${result.partialCount} | No data: ${result.noDataCount} `
      + `| Read errors: ${result.readErrorCount} | Errors: ${result.errorCount} `
      + `| Industries: ${result.industryCount}`,
    );
  }
} catch (error) {
  console.error(`\nError: ${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  process.exitCode = 1;
}
