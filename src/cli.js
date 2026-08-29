#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { runMonthlyReport } from "./pipeline.js";

const HELP = `
گزارش ماهانه شرکت‌های تولیدی کدال

اجرا:
  npm start -- [گزینه‌ها]

گزینه‌ها:
  --as-of=YYYY/MM/DD       تاریخ اجرای شمسی؛ ماه گزارش یک ماه عقب‌تر است
  --symbols=فولاد,فملی    اجرای محدود برای نمادهای مشخص
  --limit=10              محدودکردن تعداد شرکت‌ها برای آزمایش
  --output=PATH           مسیر فایل خروجی xlsx
  --cache-dir=PATH        پوشه کش دانلودهای کدال (پیش‌فرض: .cache/codal)
  --concurrency=3         تعداد دانلود هم‌زمان
  --delay=350             فاصله شروع درخواست‌ها بر حسب میلی‌ثانیه
  --allow-partial         محاسبه میانگین حتی با ماه‌های ناقص
  --refresh               نادیده‌گرفتن کش و دریافت مجدد
  --help                  نمایش راهنما

نمونه:
  npm run sample
  npm start -- --symbols=فولاد --as-of=1405/06/07
`;

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} باید یک عدد صحیح مثبت باشد.`);
  }
  return parsed;
}

function parseCliOptions() {
  const { values } = parseArgs({
    options: {
      "as-of": { type: "string" },
      symbols: { type: "string" },
      limit: { type: "string" },
      output: { type: "string" },
      "cache-dir": { type: "string" },
      concurrency: { type: "string", default: "3" },
      delay: { type: "string", default: "350" },
      "allow-partial": { type: "boolean", default: false },
      refresh: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.help) return { help: true };
  const symbols = values.symbols
    ? values.symbols.split(",").map((item) => item.trim()).filter(Boolean)
    : null;

  return {
    asOf: values["as-of"] ?? null,
    symbols,
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
    console.log(`\nخروجی ساخته شد: ${result.outputPath}`);
    console.log(
      `شرکت موفق: ${result.successCount} | بدون داده/خطا: ${result.failureCount} | صنعت: ${result.industryCount}`,
    );
  }
} catch (error) {
  console.error(`\nخطا: ${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  process.exitCode = 1;
}
