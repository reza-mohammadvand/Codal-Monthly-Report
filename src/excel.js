import fs from 'node:fs/promises';
import path from 'node:path';

import ExcelJS from 'exceljs';

const COVER_SHEET_NAME = 'راهنما';
const AUDIT_SHEET_NAME = 'ممیزی منابع';
const HEADER_ROW = 4;
const FIRST_DATA_ROW = HEADER_ROW + 1;
const LAST_COLUMN = 14;

const COLORS = Object.freeze({
  navy: 'FF17365D',
  navy2: 'FF244A6B',
  teal: 'FF0F6B78',
  tealLight: 'FFDCEFF1',
  blueLight: 'FFEAF2F8',
  green: 'FF1B5E20',
  greenLight: 'FFE2F0D9',
  red: 'FF9C0006',
  redLight: 'FFFFC7CE',
  amber: 'FF9C6500',
  amberLight: 'FFFFEB9C',
  gray900: 'FF1F2937',
  gray700: 'FF4B5563',
  gray500: 'FF6B7280',
  gray300: 'FFD1D5DB',
  gray200: 'FFE5E7EB',
  gray100: 'FFF3F4F6',
  white: 'FFFFFFFF',
});

const PERIODS = Object.freeze([
  {
    key: 'priorTarget',
    aliases: ['priorTarget', 'priorYearTarget'],
    fallbackLabel: 'ماه مشابه سال قبل',
  },
  {
    key: 'priorYtd',
    aliases: ['priorYtd', 'priorYearYtd', 'priorYearYtdAverage'],
    fallbackLabel: 'میانگین از ابتدای سال تا ماه مبنا ـ سال قبل',
  },
  {
    key: 'priorAnnual',
    aliases: [
      'priorAnnual',
      'priorYearAnnual',
      'priorYearFullYearAverage',
      'priorYear12MonthAverage',
    ],
    fallbackLabel: 'میانگین ۱۲ماهه سال قبل',
  },
  {
    key: 'previous',
    aliases: ['previous', 'previousMonth'],
    fallbackLabel: 'ماه قبل از ماه مبنا',
  },
  {
    key: 'target',
    aliases: ['target', 'targetMonth'],
    fallbackLabel: 'ماه مبنا (یک ماه پیش از اجرا)',
  },
  {
    key: 'currentYtd',
    aliases: ['currentYtd', 'currentYearYtd', 'currentYearYtdAverage'],
    fallbackLabel: 'میانگین از ابتدای سال تا ماه مبنا ـ سال جاری',
  },
]);

const GROWTH_COLUMNS = Object.freeze([
  {
    key: 'targetYoY',
    aliases: ['targetYoY'],
    fallbackLabel: 'رشد ماه مبنا نسبت به ماه مشابه سال قبل',
  },
  {
    key: 'ytdYoY',
    aliases: ['ytdYoY'],
    fallbackLabel: 'رشد میانگین سال جاری نسبت به دوره مشابه',
  },
  {
    key: 'previousYoY',
    aliases: ['previousYoY', 'previousMonthYoY'],
    fallbackLabel: 'رشد ماه قبل نسبت به ماه مشابه سال قبل',
  },
]);

const METRICS = Object.freeze([
  {
    key: 'totalProduction',
    aliases: ['totalProduction', 'production', 'total_production'],
    label: 'مقدار تولید کل',
    description: 'جمع مقدار تولید شرکت، فقط در صورت یکسان و قابل‌جمع بودن واحد محصولات.',
    defaultUnit: 'واحد گزارش',
    numberFormat: '#,##0.##;[Red](#,##0.##);-',
  },
  {
    key: 'totalSales',
    aliases: ['totalSales', 'sales', 'total_sales'],
    label: 'مقدار فروش کل',
    description: 'جمع مقدار فروش شرکت، فقط در صورت یکسان و قابل‌جمع بودن واحد محصولات.',
    defaultUnit: 'واحد گزارش',
    numberFormat: '#,##0.##;[Red](#,##0.##);-',
  },
  {
    key: 'totalRevenue',
    aliases: ['totalRevenue', 'revenue', 'salesAmount', 'amount', 'total_revenue'],
    label: 'مبلغ فروش کل',
    description: 'مبلغ فروش ثبت‌شده در گزارش فعالیت ماهانه کدال.',
    defaultUnit: 'میلیون ریال',
    numberFormat: '#,##0;[Red](#,##0);-',
  },
  {
    key: 'dominantSales',
    aliases: [
      'dominantSales',
      'dominantProductSales',
      'mainProductSales',
      'dominant_sales',
    ],
    label: 'مقدار فروش محصول غالب',
    description: 'مقدار فروش محصولی که بیشترین مبلغ فروش را در همان دوره داشته است.',
    defaultUnit: 'واحد محصول',
    numberFormat: '#,##0.##;[Red](#,##0.##);-',
    dominantProduct: true,
  },
  {
    key: 'dominantRate',
    aliases: [
      'dominantRate',
      'dominantProductRate',
      'mainProductRate',
      'dominant_rate',
    ],
    label: 'نرخ فروش محصول غالب',
    description: 'نرخ فروش محصول دارای بیشترین مبلغ فروش در همان دوره.',
    defaultUnit: 'ریال / واحد محصول',
    numberFormat: '#,##0;[Red](#,##0);-',
    dominantProduct: true,
  },
  {
    key: 'weightedRate',
    aliases: ['weightedRate', 'weightedAverageRate', 'companyWeightedRate'],
    label: 'نرخ فروش موزون کل',
    description: 'جمع مبلغ فروش به ریال تقسیم بر جمع مقدار فروش؛ میانگین ساده نرخ محصولات نیست.',
    defaultUnit: 'ریال / واحد گزارش',
    numberFormat: '#,##0;[Red](#,##0);-',
  },
]);

const GROWTH_NUMBER_FORMAT = '0.0%;[Red](0.0%);-';
const DEFAULT_SOURCE_URL = 'https://codal.ir/';

function firstDefined(object, keys) {
  if (!object || typeof object !== 'object') return undefined;
  for (const key of keys) {
    if (Object.hasOwn(object, key) && object[key] !== undefined) return object[key];
  }
  return undefined;
}

function firstOwn(object, keys) {
  if (!object || typeof object !== 'object') return { present: false, value: undefined };
  for (const key of keys) {
    if (Object.hasOwn(object, key)) return { present: true, value: object[key] };
  }
  return { present: false, value: undefined };
}

function normalizeDigits(value) {
  return String(value)
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
}

function finiteNumber(value, { percentage = false } = {}) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') {
    value = firstDefined(value, ['value', 'amount', 'rawValue', 'metric']);
  }
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return null;

  const text = normalizeDigits(value).trim();
  if (!text || /^(?:-|—|n\/?a|null|undefined)$/i.test(text)) return null;
  const hasPercent = text.includes('%') || text.includes('٪');
  const cleaned = text
    .replace(/[,%٪٬،\s]/g, '')
    .replace(/^\((.*)\)$/, '-$1');
  const number = Number(cleaned);
  if (!Number.isFinite(number)) return null;
  return hasPercent || percentage ? (hasPercent ? number / 100 : number) : number;
}

function textValue(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function safeJson(value) {
  try {
    const result = JSON.stringify(value);
    return result.length > 1_000 ? `${result.slice(0, 997)}…` : result;
  } catch {
    return textValue(value);
  }
}

function resolvePeriod(periods, definition) {
  return firstDefined(periods, definition.aliases) ?? null;
}

function metricContainer(period) {
  return period?.metrics ?? period?.values ?? period?.data ?? period ?? null;
}

function rawMetric(period, metric) {
  return firstDefined(metricContainer(period), metric.aliases);
}

function dominantProductName(period, rawValue) {
  if (rawValue && typeof rawValue === 'object') {
    const rawName = firstDefined(rawValue, [
      'dominantProductName',
      'productName',
      'name',
    ]);
    if (textValue(rawName)) return textValue(rawName);
  }
  return textValue(
    firstDefined(period, ['dominantProductName', 'mainProductName'])
      ?? period?.dominantProduct?.name
      ?? period?.meta?.dominantProductName,
  );
}

function rawUnit(period, metric, rawValue) {
  if (rawValue && typeof rawValue === 'object') {
    const embedded = firstDefined(rawValue, ['unit', 'measurementUnit', 'uom']);
    if (textValue(embedded)) return textValue(embedded);
  }

  const units = period?.units;
  const metricSpecificUnit = firstDefined(units, metric.aliases)
    ?? firstDefined(typeof period?.unit === 'object' ? period.unit : null, metric.aliases)
    ?? firstDefined(period, metric.aliases.map((alias) => `${alias}Unit`));
  if (textValue(metricSpecificUnit)) return textValue(metricSpecificUnit);

  if (metric.key === 'totalRevenue') {
    return textValue(period?.revenueUnit ?? period?.meta?.revenueUnit, metric.defaultUnit);
  }

  if (metric.key === 'dominantSales') {
    return textValue(
      period?.dominantProductUnit
        ?? period?.dominantProduct?.unit
        ?? period?.meta?.dominantProductUnit
        ?? (typeof period?.unit === 'string' ? period.unit : null),
      metric.defaultUnit,
    );
  }

  if (metric.key === 'dominantRate') {
    const unit = textValue(
      period?.dominantProductUnit
        ?? period?.dominantProduct?.unit
        ?? period?.meta?.dominantProductUnit
        ?? (typeof period?.unit === 'string' ? period.unit : null),
    );
    return unit ? `ریال / ${unit}` : metric.defaultUnit;
  }

  const totalUnit = typeof period?.unit === 'string'
    ? period.unit
    : period?.totals?.unit ?? period?.meta?.unit;
  if (metric.key === 'weightedRate') {
    return textValue(totalUnit) ? `ریال / ${textValue(totalUnit)}` : metric.defaultUnit;
  }
  return textValue(totalUnit, metric.defaultUnit);
}

function extractMetric(period, metric) {
  const rawValue = rawMetric(period, metric);
  return {
    value: finiteNumber(rawValue),
    unit: rawUnit(period, metric, rawValue),
    productName: dominantProductName(period, rawValue),
  };
}

function growthMetricState(growth, definition, metric) {
  const groupState = firstOwn(growth, definition.aliases);
  if (!groupState.present) return { present: false, value: null };
  if (groupState.value === null || groupState.value === undefined) {
    return { present: true, value: null };
  }
  const group = groupState.value?.metrics
    ?? groupState.value?.values
    ?? groupState.value;
  const metricState = firstOwn(group, metric.aliases);
  if (!metricState.present) return { present: false, value: null };
  return { present: true, value: finiteNumber(metricState.value, { percentage: false }) };
}

function calculateGrowth(current, baseline) {
  const currentNumber = finiteNumber(current);
  const baselineNumber = finiteNumber(baseline);
  if (currentNumber === null || baselineNumber === null || baselineNumber === 0) return null;
  return currentNumber / baselineNumber - 1;
}

function companyName(company) {
  return textValue(
    firstDefined(company, ['name', 'companyName', 'title', 'issuerName']),
    'نام شرکت ثبت نشده',
  );
}

function companySymbol(company) {
  return textValue(firstDefined(company, ['symbol', 'ticker', 'symbolName']), 'بدون نماد');
}

function companyStatus(company) {
  const status = company?.status;
  if (typeof status === 'string' || typeof status === 'number') return textValue(status);
  if (!status || typeof status !== 'object') return '';
  return textValue(
    firstDefined(status, ['message', 'label', 'status', 'state', 'code']),
    safeJson(status),
  );
}

function statusHasIssue(status) {
  return /error|fail|partial|missing|incomplete|warning|not.?published|خطا|ناقص|ناموجود|منتشر نشده/i
    .test(status);
}

function getFirstCompany(industryGroups) {
  for (const industry of industryGroups) {
    if (Array.isArray(industry?.companies) && industry.companies.length) {
      return industry.companies[0];
    }
  }
  return null;
}

function labelFromDefinition(definitions, definition, type) {
  const container = type === 'growth' ? definitions?.growth : definitions?.periods;
  for (const alias of definition.aliases) {
    const label = container?.[alias]?.label;
    if (textValue(label)) return textValue(label);
  }
  return '';
}

function resolveColumnLabels(industryGroups, metadata) {
  const firstCompany = getFirstCompany(industryGroups);
  const definitions = metadata?.definitions
    ?? metadata?.periodDefinitions
    ?? firstCompany?.definitions
    ?? firstCompany?.periodDefinitions
    ?? null;
  const labels = metadata?.periodLabels ?? metadata?.columnLabels ?? {};

  const periodLabels = PERIODS.map((definition) => {
    const explicit = firstDefined(labels, definition.aliases);
    const fromDefinition = labelFromDefinition(definitions, definition, 'period');
    const period = resolvePeriod(firstCompany?.periods, definition);
    return textValue(
      explicit
        ?? fromDefinition
        ?? period?.label
        ?? period?.meta?.label,
      definition.fallbackLabel,
    );
  });
  const growthLabels = GROWTH_COLUMNS.map((definition) => textValue(
    firstDefined(labels, definition.aliases)
      ?? labelFromDefinition(definitions, definition, 'growth'),
    definition.fallbackLabel,
  ));

  return [...periodLabels, ...growthLabels];
}

function resolveMetricUnit(periodEntries, metric) {
  const units = periodEntries
    .map((entry) => entry.unit)
    .filter(Boolean);
  const distinctUnits = [...new Set(units)];
  if (!distinctUnits.length) return metric.defaultUnit;
  if (distinctUnits.length === 1) return distinctUnits[0];
  return 'متغیر؛ طبق یادداشت سلول';
}

function resolveTargetProduct(periodEntries) {
  return periodEntries[4]?.productName
    || [...periodEntries].reverse().find((entry) => entry.productName)?.productName
    || '';
}

function periodSourceUrl(period) {
  const direct = firstDefined(period, ['sourceUrl', 'url', 'reportUrl', 'htmlUrl']);
  if (typeof direct === 'string') return direct;
  const source = period?.source ?? period?.meta?.source;
  if (typeof source === 'string') return source;
  return textValue(firstDefined(source, ['url', 'sourceUrl', 'reportUrl', 'htmlUrl']));
}

function buildCellNote(period, metricEntry, metric) {
  const lines = [];
  if (metric.dominantProduct && metricEntry.productName) {
    lines.push(`محصول غالب این دوره: ${metricEntry.productName}`);
  }
  if (metricEntry.unit) lines.push(`واحد این دوره: ${metricEntry.unit}`);
  const sourceUrl = periodSourceUrl(period);
  if (sourceUrl) lines.push(`منبع: ${sourceUrl}`);
  const reportCount = finiteNumber(period?.reportCount ?? period?.meta?.reportCount);
  const requestedCount = finiteNumber(
    period?.requestedMonthCount ?? period?.meta?.requestedMonthCount,
  );
  if (reportCount !== null && requestedCount !== null && reportCount !== requestedCount) {
    lines.push(`پوشش دوره: ${reportCount} گزارش از ${requestedCount} ماه درخواستی`);
  } else if ((period?.complete ?? period?.meta?.complete) === false) {
    lines.push('پوشش این دوره ناقص است؛ جزئیات ماه‌های مفقود را در ممیزی بررسی کنید.');
  }
  return lines.join('\n');
}

function formulaGrowthCell(cell, numeratorCell, denominatorCell, result) {
  if (result === null) {
    cell.value = null;
    return;
  }
  cell.value = {
    formula: `IF(OR(${denominatorCell}="",${denominatorCell}=0,${numeratorCell}=""),"",${numeratorCell}/${denominatorCell}-1)`,
    result,
  };
}

function borderBottom(style = 'thin', color = COLORS.gray300) {
  return { style, color: { argb: color } };
}

function setTitleBand(sheet, range, value, fill = COLORS.navy) {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(':')[0]);
  cell.value = value;
  cell.font = { name: 'Tahoma', size: 14, bold: true, color: { argb: COLORS.white } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
}

function configureIndustrySheet(sheet, industryName, columnLabels, metadata) {
  sheet.views = [{
    state: 'frozen',
    xSplit: 5,
    ySplit: HEADER_ROW,
    topLeftCell: 'F5',
    activeCell: 'F5',
    rightToLeft: true,
    showGridLines: false,
  }];
  sheet.properties.defaultRowHeight = 22;
  sheet.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
  sheet.pageSetup.printTitlesRow = '1:4';
  sheet.headerFooter.oddFooter = '&Rصفحه &P از &N&Lگزارش ماهانه کدال';
  sheet.columns = [
    { key: 'symbol', width: 13 },
    { key: 'company', width: 27 },
    { key: 'metric', width: 27 },
    { key: 'unit', width: 22 },
    { key: 'product', width: 27 },
    ...Array.from({ length: 6 }, () => ({ width: 21 })),
    ...Array.from({ length: 3 }, () => ({ width: 22 })),
    { key: 'previousPriorBaseline', width: 18, hidden: true },
  ];

  setTitleBand(sheet, 'A1:N1', `گزارش فعالیت ماهانه شرکت‌های تولیدی ـ ${industryName}`);
  sheet.getRow(1).height = 32;
  sheet.mergeCells('A2:N2');
  sheet.getCell('A2').value = 'دوره مبنا یک ماه قبل از ماه اجرای برنامه است؛ سلول خالی یعنی داده معتبر در دسترس نبوده است.';
  sheet.getCell('A2').font = { name: 'Tahoma', size: 10, color: { argb: COLORS.gray700 } };
  sheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.blueLight } };
  sheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
  sheet.getRow(2).height = 24;

  sheet.mergeCells('A3:N3');
  const generatedAt = metadata?.generatedAt ? new Date(metadata.generatedAt) : new Date();
  const generatedLabel = Number.isNaN(generatedAt.getTime())
    ? textValue(metadata?.generatedAt)
    : generatedAt.toLocaleString('fa-IR');
  sheet.getCell('A3').value = `زمان تولید: ${generatedLabel} | منبع: کدال | ارقام رشد بر مبنای مقدار دوره مقایسه محاسبه شده‌اند.`;
  sheet.getCell('A3').font = { name: 'Tahoma', size: 9, italic: true, color: { argb: COLORS.gray500 } };
  sheet.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };

  const headers = [
    'نماد',
    'نام شرکت',
    'شاخص',
    'واحد',
    'محصول غالب (ماه مبنا)',
    ...columnLabels,
  ];
  const header = sheet.getRow(HEADER_ROW);
  header.values = headers;
  header.getCell(15).value = 'مبنای رشد ماه قبل (مخفی)';
  header.height = 58;
  header.eachCell({ includeEmpty: true }, (cell, column) => {
    const isGrowth = column >= 12;
    cell.font = { name: 'Tahoma', size: 9, bold: true, color: { argb: COLORS.white } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: isGrowth ? COLORS.teal : COLORS.navy2 },
    };
    cell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
      readingOrder: 'rtl',
    };
    cell.border = {
      bottom: { style: 'medium', color: { argb: COLORS.navy } },
      left: { style: 'thin', color: { argb: COLORS.white } },
    };
  });
  sheet.autoFilter = { from: 'A4', to: 'N4' };
}

function comparisonPeriod(company) {
  return company?.comparisonPeriods?.previousMonthPriorYear
    ?? company?.previousPrior
    ?? company?.periods?.previousMonthPriorYear
    ?? company?.previousMonthPriorYear
    ?? null;
}

function addCompanyBlock(sheet, company, startRow, blockIndex) {
  const periods = PERIODS.map((definition) => resolvePeriod(company?.periods, definition));
  const symbol = companySymbol(company);
  const name = companyName(company);
  const status = companyStatus(company);
  const stripeColor = blockIndex % 2 === 0 ? COLORS.white : 'FFF8FAFC';

  METRICS.forEach((metric, metricIndex) => {
    const rowNumber = startRow + metricIndex;
    const row = sheet.getRow(rowNumber);
    const entries = periods.map((period) => extractMetric(period, metric));
    const targetProduct = resolveTargetProduct(entries);
    row.height = 24;
    row.getCell(1).value = symbol;
    row.getCell(2).value = name;
    row.getCell(3).value = metric.label;
    row.getCell(4).value = resolveMetricUnit(entries, metric);
    row.getCell(5).value = metric.dominantProduct ? targetProduct : '';

    entries.forEach((entry, periodIndex) => {
      const cell = row.getCell(6 + periodIndex);
      cell.value = entry.value;
      cell.numFmt = metric.numberFormat;
      const note = buildCellNote(periods[periodIndex], entry, metric);
      if (note) cell.note = note;
    });

    const targetGrowthState = growthMetricState(company?.growth, GROWTH_COLUMNS[0], metric);
    const ytdGrowthState = growthMetricState(company?.growth, GROWTH_COLUMNS[1], metric);
    const calculatedTargetGrowth = calculateGrowth(entries[4].value, entries[0].value);
    const calculatedYtdGrowth = calculateGrowth(entries[5].value, entries[1].value);
    const targetGrowthResult = targetGrowthState.present
      ? targetGrowthState.value === null || calculatedTargetGrowth === null
        ? null
        : targetGrowthState.value
      : calculatedTargetGrowth;
    const ytdGrowthResult = ytdGrowthState.present
      ? ytdGrowthState.value === null || calculatedYtdGrowth === null
        ? null
        : ytdGrowthState.value
      : calculatedYtdGrowth;
    formulaGrowthCell(
      row.getCell(12),
      `J${rowNumber}`,
      `F${rowNumber}`,
      targetGrowthResult,
    );
    formulaGrowthCell(
      row.getCell(13),
      `K${rowNumber}`,
      `G${rowNumber}`,
      ytdGrowthResult,
    );

    const previousGrowthState = growthMetricState(
      company?.growth,
      GROWTH_COLUMNS[2],
      metric,
    );
    const previousComparable = comparisonPeriod(company);
    const previousBaseline = previousComparable
      ? extractMetric(previousComparable, metric).value
      : null;
    const calculatedPriorMonthGrowth = calculateGrowth(entries[3].value, previousBaseline);
    const priorMonthGrowth = previousGrowthState.present
      ? previousGrowthState.value
      : calculatedPriorMonthGrowth;
    row.getCell(15).value = previousBaseline;
    row.getCell(15).numFmt = metric.numberFormat;
    const priorMonthGrowthResult = priorMonthGrowth === null
      || calculatedPriorMonthGrowth === null
      ? null
      : priorMonthGrowth;
    formulaGrowthCell(
      row.getCell(14),
      `I${rowNumber}`,
      `O${rowNumber}`,
      priorMonthGrowthResult,
    );

    for (let column = 1; column <= LAST_COLUMN; column += 1) {
      const cell = row.getCell(column);
      cell.font = { name: 'Tahoma', size: 9, color: { argb: COLORS.gray900 } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stripeColor } };
      cell.alignment = {
        horizontal: column <= 5 ? 'right' : 'center',
        vertical: 'middle',
        wrapText: column <= 5,
        readingOrder: 'rtl',
      };
      cell.border = {
        bottom: borderBottom(metricIndex === METRICS.length - 1 ? 'medium' : 'hair'),
      };
    }

    row.getCell(3).font = { name: 'Tahoma', size: 9, bold: metricIndex < 3, color: { argb: COLORS.gray900 } };
    row.getCell(4).font = { name: 'Tahoma', size: 8, color: { argb: COLORS.gray700 } };
    row.getCell(5).font = { name: 'Tahoma', size: 8, color: { argb: COLORS.teal } };
    for (let column = 6; column <= 11; column += 1) row.getCell(column).numFmt = metric.numberFormat;
    for (let column = 12; column <= 14; column += 1) row.getCell(column).numFmt = GROWTH_NUMBER_FORMAT;
  });

  for (let rowNumber = startRow; rowNumber < startRow + METRICS.length; rowNumber += 1) {
    const symbolCell = sheet.getCell(rowNumber, 1);
    const nameCell = sheet.getCell(rowNumber, 2);
    symbolCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.tealLight } };
    nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.tealLight } };
    symbolCell.font = { name: 'Tahoma', size: 9, bold: true, color: { argb: COLORS.navy } };
    nameCell.font = { name: 'Tahoma', size: 9, bold: true, color: { argb: COLORS.navy } };
    if (statusHasIssue(status)) {
      symbolCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.amberLight } };
      nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.amberLight } };
    }
  }
  if (status) sheet.getCell(startRow, 1).note = `وضعیت پردازش: ${status}`;
}

function applyGrowthConditionalFormatting(sheet, lastRow) {
  if (lastRow < FIRST_DATA_ROW) return;
  sheet.addConditionalFormatting({
    ref: `L${FIRST_DATA_ROW}:N${lastRow}`,
    rules: [
      {
        type: 'cellIs',
        operator: 'greaterThan',
        formulae: ['0'],
        style: {
          font: { color: { argb: COLORS.green }, bold: true },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.greenLight } },
        },
      },
      {
        type: 'cellIs',
        operator: 'lessThan',
        formulae: ['0'],
        style: {
          font: { color: { argb: COLORS.red }, bold: true },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.redLight } },
        },
      },
      {
        type: 'cellIs',
        operator: 'equal',
        formulae: ['0'],
        style: {
          font: { color: { argb: COLORS.gray700 } },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.gray100 } },
        },
      },
    ],
  });
}

function validSheetBaseName(value, fallback) {
  const cleaned = textValue(value, fallback)
    .replace(/[\\/*?:\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '');
  return (cleaned || fallback).slice(0, 31).trim();
}

function allocateIndustrySheetNames(industryGroups) {
  const used = new Set([
    COVER_SHEET_NAME.toLocaleLowerCase('fa'),
    AUDIT_SHEET_NAME.toLocaleLowerCase('fa'),
  ]);
  return industryGroups.map((industry, index) => {
    const base = validSheetBaseName(
      industry?.industryName ?? industry?.name,
      `صنعت ${index + 1}`,
    );
    let candidate = base;
    for (let suffix = 2; used.has(candidate.toLocaleLowerCase('fa')); suffix += 1) {
      if (suffix >= 10_000) {
        throw new Error(`امکان ساخت نام یکتا برای شیت «${base}» وجود ندارد.`);
      }
      const suffixText = ` (${suffix})`;
      candidate = `${base.slice(0, 31 - suffixText.length)}${suffixText}`;
    }
    used.add(candidate.toLocaleLowerCase('fa'));
    return candidate;
  });
}

function styleCoverLabel(cell) {
  cell.font = { name: 'Tahoma', size: 9, bold: true, color: { argb: COLORS.navy } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.tealLight } };
  cell.alignment = { horizontal: 'right', vertical: 'middle', readingOrder: 'rtl' };
}

function createCoverSheet(workbook, industryGroups, metadata, industrySheetNames, columnLabels) {
  const sheet = workbook.addWorksheet(COVER_SHEET_NAME, {
    views: [{ rightToLeft: true, showGridLines: false }],
    properties: { tabColor: { argb: COLORS.navy } },
  });
  sheet.columns = Array.from({ length: LAST_COLUMN }, (_, index) => ({
    width: [17, 17, 18, 18, 16, 16, 16, 16, 16, 16, 18, 18, 18, 18][index],
  }));
  setTitleBand(sheet, 'A1:N1', textValue(metadata?.title, 'گزارش تحلیلی فعالیت ماهانه شرکت‌های تولیدی'));
  sheet.getRow(1).height = 38;
  sheet.mergeCells('A2:N2');
  sheet.getCell('A2').value = 'داده‌های عمومی گزارش فعالیت ماهانه کدال؛ هر صنعت در یک شیت جدا و هر شرکت در یک بلوک شش‌ردیفی.';
  sheet.getCell('A2').font = { name: 'Tahoma', size: 10, color: { argb: COLORS.gray700 } };
  sheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };

  const generatedAt = metadata?.generatedAt ? new Date(metadata.generatedAt) : new Date();
  const companyCount = industryGroups.reduce(
    (sum, industry) => sum + (Array.isArray(industry?.companies) ? industry.companies.length : 0),
    0,
  );
  const targetLabel = columnLabels[4];
  const infoRows = [
    ['A3:C3', 'D3:G3', 'دوره مبنا', targetLabel],
    ['H3:J3', 'K3:N3', 'تاریخ و زمان تولید', Number.isNaN(generatedAt.getTime()) ? textValue(metadata?.generatedAt) : generatedAt],
    ['A4:C4', 'D4:G4', 'تعداد صنایع', industryGroups.length],
    ['H4:J4', 'K4:N4', 'تعداد شرکت‌ها', companyCount],
    ['A5:C5', 'D5:G5', 'منبع اصلی', textValue(metadata?.sourceName, 'سامانه کدال')],
    ['H5:J5', 'K5:N5', 'نشانی منبع', textValue(metadata?.sourceUrl, DEFAULT_SOURCE_URL)],
  ];
  for (const [labelRange, valueRange, label, value] of infoRows) {
    sheet.mergeCells(labelRange);
    sheet.mergeCells(valueRange);
    const labelCell = sheet.getCell(labelRange.split(':')[0]);
    const valueCell = sheet.getCell(valueRange.split(':')[0]);
    labelCell.value = label;
    valueCell.value = value;
    styleCoverLabel(labelCell);
    valueCell.font = { name: 'Tahoma', size: 9, color: { argb: COLORS.gray900 } };
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.gray100 } };
    valueCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
    if (value instanceof Date) valueCell.numFmt = 'yyyy-mm-dd hh:mm';
    if (label === 'نشانی منبع' && /^https?:\/\//i.test(textValue(value))) {
      valueCell.value = { text: textValue(value), hyperlink: textValue(value) };
      valueCell.font = { name: 'Tahoma', size: 9, color: { argb: 'FF0563C1' }, underline: true };
    }
  }

  setTitleBand(sheet, 'A7:N7', 'راهنمای شاخص‌ها', COLORS.teal);
  const guideHeader = sheet.getRow(8);
  guideHeader.values = ['شاخص', '', 'تعریف', '', '', '', '', '', 'واحد معمول', '', 'نکته', '', '', ''];
  for (const range of ['A8:B8', 'C8:H8', 'I8:J8', 'K8:N8']) sheet.mergeCells(range);
  for (const cell of [sheet.getCell('A8'), sheet.getCell('C8'), sheet.getCell('I8'), sheet.getCell('K8')]) {
    cell.font = { name: 'Tahoma', size: 9, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy2 } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
  }
  METRICS.forEach((metric, index) => {
    const rowNumber = 9 + index;
    for (const range of [`A${rowNumber}:B${rowNumber}`, `C${rowNumber}:H${rowNumber}`, `I${rowNumber}:J${rowNumber}`, `K${rowNumber}:N${rowNumber}`]) {
      sheet.mergeCells(range);
    }
    sheet.getCell(rowNumber, 1).value = metric.label;
    sheet.getCell(rowNumber, 3).value = metric.description;
    sheet.getCell(rowNumber, 9).value = metric.defaultUnit;
    sheet.getCell(rowNumber, 11).value = metric.dominantProduct
      ? 'محصول غالب ممکن است بین دوره‌ها تغییر کند؛ نام دقیق هر دوره در یادداشت سلول است.'
      : '';
    for (const column of [1, 3, 9, 11]) {
      const cell = sheet.getCell(rowNumber, column);
      cell.font = { name: 'Tahoma', size: 9, color: { argb: COLORS.gray900 } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? COLORS.gray100 : COLORS.white } };
      cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
      cell.border = { bottom: borderBottom('thin', COLORS.gray200) };
    }
    sheet.getRow(rowNumber).height = 34;
  });

  setTitleBand(sheet, 'A16:N16', 'قواعد محاسبه و خواندن فایل', COLORS.teal);
  const notes = [
    'ماه مبنا همیشه یک ماه عقب‌تر از ماه اجرای برنامه است؛ بنابراین هنگام اجرا در شهریور، گزارش مرداد بررسی می‌شود.',
    'رشد برابر است با «مقدار دوره جدید ÷ مقدار دوره مقایسه − ۱». اگر مقدار مبنا صفر یا یکی از دو مقدار ناموجود باشد، سلول رشد خالی می‌ماند.',
    'محصول غالب در هر دوره محصولی است که بیشترین مبلغ فروش همان دوره را دارد؛ برای میانگین‌های چندماهه، انتخاب بر مبنای مبلغ کل همان بازه انجام می‌شود.',
    'نرخ فروش موزون کل از تقسیم جمع مبلغ فروشِ تبدیل‌شده به ریال بر جمع مقدار فروش محاسبه می‌شود و میانگین ساده نرخ محصولات نیست.',
    'اگر واحد محصولات قابل جمع نباشد، مقدار تولید/فروش کل خالی است؛ مبلغ فروش و شاخص‌های معتبر محصول غالب همچنان نمایش داده می‌شوند.',
    'برای ردیابی هر عدد، یادداشت سلول و شیت «ممیزی منابع» را بررسی کنید. گزارش اصلاحی باید بر نسخه اولیه اولویت داشته باشد.',
  ];
  notes.forEach((note, index) => {
    const rowNumber = 17 + index;
    sheet.mergeCells(`A${rowNumber}:N${rowNumber}`);
    const cell = sheet.getCell(rowNumber, 1);
    cell.value = `• ${note}`;
    cell.font = { name: 'Tahoma', size: 9, color: { argb: COLORS.gray900 } };
    cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? COLORS.white : COLORS.gray100 } };
    sheet.getRow(rowNumber).height = 28;
  });

  const listTitleRow = 24;
  setTitleBand(sheet, `A${listTitleRow}:N${listTitleRow}`, 'فهرست صنایع و شیت‌ها');
  sheet.mergeCells(`A${listTitleRow + 1}:F${listTitleRow + 1}`);
  sheet.mergeCells(`G${listTitleRow + 1}:I${listTitleRow + 1}`);
  sheet.mergeCells(`J${listTitleRow + 1}:N${listTitleRow + 1}`);
  const listHeaders = [
    [1, 'صنعت'],
    [7, 'تعداد شرکت'],
    [10, 'نام شیت'],
  ];
  for (const [column, value] of listHeaders) {
    const cell = sheet.getCell(listTitleRow + 1, column);
    cell.value = value;
    cell.font = { name: 'Tahoma', size: 9, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy2 } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
  }
  industryGroups.forEach((industry, index) => {
    const rowNumber = listTitleRow + 2 + index;
    sheet.mergeCells(`A${rowNumber}:F${rowNumber}`);
    sheet.mergeCells(`G${rowNumber}:I${rowNumber}`);
    sheet.mergeCells(`J${rowNumber}:N${rowNumber}`);
    sheet.getCell(rowNumber, 1).value = textValue(industry?.industryName ?? industry?.name, `صنعت ${index + 1}`);
    sheet.getCell(rowNumber, 7).value = Array.isArray(industry?.companies) ? industry.companies.length : 0;
    const targetSheetName = industrySheetNames[index];
    sheet.getCell(rowNumber, 10).value = targetSheetName
      ? { text: targetSheetName, hyperlink: `#'${targetSheetName.replace(/'/g, "''")}'!A1` }
      : '';
    for (const column of [1, 7, 10]) {
      const cell = sheet.getCell(rowNumber, column);
      cell.font = {
        name: 'Tahoma',
        size: 9,
        color: { argb: column === 10 ? 'FF0563C1' : COLORS.gray900 },
        underline: column === 10,
      };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? COLORS.gray100 : COLORS.white } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
      cell.border = { bottom: borderBottom('thin', COLORS.gray200) };
    }
  });
  sheet.views = [{ state: 'frozen', ySplit: 2, topLeftCell: 'A3', rightToLeft: true, showGridLines: false }];
  sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return sheet;
}

function normalizeSource(source, context = {}) {
  if (typeof source === 'string') {
    return {
      ...context,
      url: /^https?:\/\//i.test(source) ? source : '',
      title: /^https?:\/\//i.test(source) ? '' : source,
      note: '',
    };
  }
  if (!source || typeof source !== 'object') return null;
  const sourceYear = finiteNumber(source.year);
  const sourceMonth = finiteNumber(source.month);
  const monthKey = Number.isInteger(sourceYear) && Number.isInteger(sourceMonth)
    ? `${sourceYear}/${String(sourceMonth).padStart(2, '0')}`
    : '';
  const sourceNote = textValue(firstDefined(source, ['note', 'notes', 'message', 'status']));
  return {
    ...context,
    periodKey: textValue(
      firstDefined(source, ['periodKey', 'period', 'key']),
      context.periodKey || monthKey,
    ),
    periodLabel: textValue(
      firstDefined(source, ['periodLabel', 'monthLabel']),
      context.periodLabel || monthKey,
    ),
    title: textValue(firstDefined(source, ['title', 'reportTitle', 'letterTitle', 'name'])),
    publicationDate: firstDefined(source, [
      'publicationDate',
      'publishedAt',
      'publishDate',
      'date',
      'publishDateTime',
    ]),
    tracingNo: textValue(firstDefined(source, [
      'tracingNo',
      'tracingNumber',
      'letterSerial',
      'documentId',
      'id',
    ])),
    url: textValue(firstDefined(source, ['url', 'sourceUrl', 'reportUrl', 'htmlUrl', 'link'])),
    note: [sourceNote, source.correction === true ? 'گزارش اصلاحیه' : '']
      .filter(Boolean)
      .join(' | '),
  };
}

function companyAuditNote(company) {
  const notes = [];
  const errors = Array.isArray(company?.errors)
    ? company.errors.filter(Boolean).map(textValue)
    : [];
  if (errors.length) notes.push(`خطاها/کمبودها: ${errors.join(' | ')}`);
  const downloaded = finiteNumber(company?.downloadedReportCount);
  const required = finiteNumber(company?.requiredReportCount);
  if (downloaded !== null && required !== null && downloaded !== required) {
    notes.push(`پوشش دریافت: ${downloaded} گزارش از ${required} گزارش موردنیاز`);
  }
  return notes.join(' | ');
}

function collectCompanySources(company, columnLabels) {
  const collected = [];
  const add = (source, context) => {
    if (Array.isArray(source)) {
      source.forEach((item) => add(item, context));
      return;
    }
    const normalized = normalizeSource(source, context);
    if (normalized) collected.push(normalized);
  };

  if (Array.isArray(company?.sources)) {
    add(company.sources, {});
  } else if (company?.sources && typeof company.sources === 'object') {
    for (const [periodKey, source] of Object.entries(company.sources)) {
      const periodIndex = PERIODS.findIndex((definition) => definition.aliases.includes(periodKey));
      add(source, { periodKey, periodLabel: periodIndex >= 0 ? columnLabels[periodIndex] : '' });
    }
  }

  PERIODS.forEach((definition, index) => {
    const period = resolvePeriod(company?.periods, definition);
    const context = { periodKey: definition.key, periodLabel: columnLabels[index] };
    if (period?.sources) add(period.sources, context);
    if (period?.source) add(period.source, context);
    if (periodSourceUrl(period)) add(period, context);
  });

  const seen = new Set();
  return collected.filter((source) => {
    const signature = [
      source.periodKey,
      source.url,
      source.tracingNo,
      source.title,
      source.publicationDate,
    ].join('|');
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function createAuditSheet(workbook, industryGroups, metadata, columnLabels) {
  const sheet = workbook.addWorksheet(AUDIT_SHEET_NAME, {
    properties: { tabColor: { argb: COLORS.teal } },
  });
  sheet.views = [{
    state: 'frozen',
    xSplit: 4,
    ySplit: HEADER_ROW,
    topLeftCell: 'E5',
    activeCell: 'E5',
    rightToLeft: true,
    showGridLines: false,
  }];
  sheet.columns = [
    { width: 8 },
    { width: 24 },
    { width: 14 },
    { width: 27 },
    { width: 22 },
    { width: 19 },
    { width: 25 },
    { width: 42 },
    { width: 20 },
    { width: 19 },
    { width: 55 },
    { width: 42 },
  ];
  setTitleBand(sheet, 'A1:L1', 'ممیزی منابع و وضعیت پردازش');
  sheet.getRow(1).height = 32;
  sheet.mergeCells('A2:L2');
  sheet.getCell('A2').value = 'هر ردیف نماینده یک منبع/گزارش کدال است. URL کامل برای بازبینی و ردگیری در ستون «نشانی منبع» نگهداری می‌شود.';
  sheet.getCell('A2').font = { name: 'Tahoma', size: 9, color: { argb: COLORS.gray700 } };
  sheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
  sheet.mergeCells('A3:L3');
  sheet.getCell('A3').value = `منبع پیش‌فرض: ${textValue(metadata?.sourceUrl, DEFAULT_SOURCE_URL)} | زمان تولید: ${new Date().toLocaleString('fa-IR')}`;
  sheet.getCell('A3').font = { name: 'Tahoma', size: 8, italic: true, color: { argb: COLORS.gray500 } };
  sheet.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };

  const headers = [
    'ردیف',
    'صنعت',
    'نماد',
    'نام شرکت',
    'وضعیت پردازش',
    'کلید دوره',
    'عنوان دوره',
    'عنوان گزارش',
    'تاریخ انتشار',
    'شناسه رهگیری',
    'نشانی منبع',
    'یادداشت ممیزی',
  ];
  const header = sheet.getRow(HEADER_ROW);
  header.values = headers;
  header.height = 40;
  header.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: 'Tahoma', size: 9, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy2 } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
  });

  let rowNumber = FIRST_DATA_ROW;
  let sequence = 1;
  industryGroups.forEach((industry, industryIndex) => {
    const industryName = textValue(industry?.industryName ?? industry?.name, `صنعت ${industryIndex + 1}`);
    const companies = Array.isArray(industry?.companies) ? industry.companies : [];
    companies.forEach((company) => {
      const sources = collectCompanySources(company, columnLabels);
      const companySources = sources.length ? sources : [{
        periodKey: '',
        periodLabel: '',
        title: '',
        publicationDate: '',
        tracingNo: '',
        url: '',
        note: 'منبع جزئی برای این شرکت در داده ورودی ثبت نشده است.',
      }];
      const auditNote = companyAuditNote(company);
      companySources.forEach((source, sourceIndex) => {
        const rowNote = [source.note, sourceIndex === 0 ? auditNote : '']
          .filter(Boolean)
          .join(' | ');
        const row = sheet.getRow(rowNumber);
        row.values = [
          sequence,
          industryName,
          companySymbol(company),
          companyName(company),
          companyStatus(company),
          source.periodKey,
          source.periodLabel,
          source.title,
          source.publicationDate,
          source.tracingNo,
          source.url,
          rowNote,
        ];
        row.height = 30;
        row.eachCell({ includeEmpty: true }, (cell, column) => {
          cell.font = { name: 'Tahoma', size: 8, color: { argb: COLORS.gray900 } };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: rowNumber % 2 ? COLORS.white : COLORS.gray100 },
          };
          cell.alignment = {
            horizontal: column === 1 ? 'center' : 'right',
            vertical: 'middle',
            wrapText: true,
            readingOrder: 'rtl',
          };
          cell.border = { bottom: borderBottom('thin', COLORS.gray200) };
        });
        if (source.url && /^https?:\/\//i.test(source.url)) {
          row.getCell(11).value = { text: source.url, hyperlink: source.url };
          row.getCell(11).font = { name: 'Tahoma', size: 8, color: { argb: 'FF0563C1' }, underline: true };
        }
        if (statusHasIssue(companyStatus(company))) {
          row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.amberLight } };
          row.getCell(5).font = { name: 'Tahoma', size: 8, color: { argb: COLORS.amber }, bold: true };
        }
        rowNumber += 1;
        sequence += 1;
      });
    });
  });

  if (rowNumber === FIRST_DATA_ROW) {
    sheet.getCell(FIRST_DATA_ROW, 1).value = 'داده‌ای برای ممیزی وجود ندارد.';
    sheet.mergeCells(`A${FIRST_DATA_ROW}:L${FIRST_DATA_ROW}`);
  }
  sheet.autoFilter = { from: 'A4', to: 'L4' };
  sheet.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  return sheet;
}

/**
 * Build (but do not save) the report workbook. Exported separately to make
 * structural tests and future delivery methods (stream/buffer) straightforward.
 */
export function createReportWorkbook({ industryGroups = [], metadata = {} } = {}) {
  if (!Array.isArray(industryGroups)) {
    throw new TypeError('industryGroups باید آرایه باشد.');
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = textValue(metadata?.creator, 'Codal Monthly Report');
  workbook.lastModifiedBy = workbook.creator;
  workbook.created = metadata?.generatedAt && !Number.isNaN(new Date(metadata.generatedAt).getTime())
    ? new Date(metadata.generatedAt)
    : new Date();
  workbook.modified = new Date();
  workbook.subject = 'گزارش تحلیلی فعالیت ماهانه شرکت‌های تولیدی';
  workbook.title = textValue(metadata?.title, 'گزارش ماهانه شرکت‌های تولیدی');
  workbook.description = 'گزارش ماهانه کدال با شش شاخص و سه مقایسه رشد';
  workbook.keywords = 'کدال, گزارش ماهانه, تولید, فروش, نرخ فروش, شرکت بورسی';
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.calcProperties.forceFullCalc = true;
  workbook.calcProperties.calcMode = 'auto';

  const columnLabels = resolveColumnLabels(industryGroups, metadata);
  const industrySheetNames = allocateIndustrySheetNames(industryGroups);
  createCoverSheet(workbook, industryGroups, metadata, industrySheetNames, columnLabels);

  industryGroups.forEach((industry, industryIndex) => {
    const industryName = textValue(
      industry?.industryName ?? industry?.name,
      `صنعت ${industryIndex + 1}`,
    );
    const sheetName = industrySheetNames[industryIndex];
    const sheet = workbook.addWorksheet(sheetName, {
      properties: { tabColor: { argb: industryIndex % 2 ? COLORS.teal : COLORS.navy2 } },
    });
    configureIndustrySheet(sheet, industryName, columnLabels, metadata);
    const companies = Array.isArray(industry?.companies) ? industry.companies : [];
    companies.forEach((company, companyIndex) => {
      addCompanyBlock(sheet, company, FIRST_DATA_ROW + companyIndex * METRICS.length, companyIndex);
    });
    const lastRow = companies.length
      ? FIRST_DATA_ROW + companies.length * METRICS.length - 1
      : FIRST_DATA_ROW;
    if (!companies.length) {
      sheet.mergeCells(`A${FIRST_DATA_ROW}:N${FIRST_DATA_ROW}`);
      sheet.getCell(FIRST_DATA_ROW, 1).value = 'شرکت تولیدی واجد داده برای این صنعت یافت نشد.';
      sheet.getCell(FIRST_DATA_ROW, 1).alignment = { horizontal: 'center', readingOrder: 'rtl' };
    }
    applyGrowthConditionalFormatting(sheet, lastRow);
    sheet.autoFilter = { from: 'A4', to: `N${lastRow}` };
  });

  createAuditSheet(workbook, industryGroups, metadata, columnLabels);
  workbook.views = [{ activeTab: 0, firstSheet: 0, visibility: 'visible' }];
  return workbook;
}

/**
 * Write the final XLSX report.
 *
 * @param {object} input
 * @param {Array<object>} input.industryGroups one item per industry
 * @param {object} [input.metadata] report dates/labels/source metadata
 * @param {string} input.outputPath destination .xlsx path
 * @returns {Promise<{outputPath: string, industryCount: number, companyCount: number, worksheetNames: string[]}>}
 */
export async function writeReportWorkbook({ industryGroups = [], metadata = {}, outputPath } = {}) {
  if (!textValue(outputPath)) throw new TypeError('outputPath الزامی است.');
  const resolvedOutputPath = path.resolve(outputPath);
  const workbook = createReportWorkbook({ industryGroups, metadata });
  await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  await workbook.xlsx.writeFile(resolvedOutputPath);
  return {
    outputPath: resolvedOutputPath,
    industryCount: industryGroups.length,
    companyCount: industryGroups.reduce(
      (sum, industry) => sum + (Array.isArray(industry?.companies) ? industry.companies.length : 0),
      0,
    ),
    worksheetNames: workbook.worksheets.map((sheet) => sheet.name),
  };
}

export const excelReportSchema = Object.freeze({
  metrics: METRICS.map(({ key, aliases, label }) => ({ key, aliases, label })),
  periods: PERIODS.map(({ key, aliases }) => ({ key, aliases })),
  growth: GROWTH_COLUMNS.map(({ key, aliases }) => ({ key, aliases })),
});
