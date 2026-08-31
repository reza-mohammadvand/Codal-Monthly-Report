import http from 'node:http';
import https from 'node:https';

export const CODAL_SEARCH_BASE_URL = 'https://search.codal.ir';
export const CODAL_EXCEL_BASE_URL = 'https://excel.codal.ir';
export const PRODUCTION_REPORTING_TYPE = 1_000_000;

const DEFAULT_HEADERS = Object.freeze({
  Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
  'Accept-Encoding': 'identity',
  'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.6',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'User-Agent': 'Mozilla/5.0 (compatible; CodalMonthlyReport/1.0)',
});

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

const HTML_ENTITIES = Object.freeze({
  amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  ndash: '–', mdash: '—', zwnj: '\u200c',
});

export class CodalHttpError extends Error {
  constructor(message, { status = null, url = null, body = '', cause } = {}) {
    super(message, { cause });
    this.name = 'CodalHttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/** Convert Persian/Arabic digits to ASCII without otherwise changing the text. */
export function toAsciiDigits(value) {
  return String(value ?? '').replace(/[۰-۹٠-٩]/g, (digit) => {
    const persianIndex = PERSIAN_DIGITS.indexOf(digit);
    return String(persianIndex >= 0 ? persianIndex : ARABIC_DIGITS.indexOf(digit));
  });
}

export function decodeHtmlEntities(value) {
  return String(value ?? '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isFinite(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Normalization used for matching, while retaining readable Persian output. */
export function normalizeCodalText(value) {
  return toAsciiDigits(decodeHtmlEntities(String(value ?? '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')))
    .replace(/[\u064a\u0649]/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .replace(/\u0640/g, '')
    .replace(/[\u200c\u200d\u200e\u200f\ufeff]/g, ' ')
    .replace(/[\u00a0\s]+/g, ' ')
    .trim();
}

/** Parse Codal's Persian-formatted numeric cells. Empty/dash cells return null. */
export function parseCodalNumber(value) {
  let text = normalizeCodalText(value);
  if (!text || /^(?:-|--|–|—|N\/?A)$/i.test(text)) return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text
    .replace(/[,٬]/g, '')
    .replace(/٫/g, '.')
    .replace(/[−–—]/g, '-')
    .replace(/\s/g, '')
    .replace(/%$/, '');

  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? (negative ? -Math.abs(number) : number) : null;
}

function parseSpan(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:["'](\\d+)["']|(\\d+))`, 'i'));
  return Math.max(1, Number(match?.[1] ?? match?.[2] ?? 1));
}

function parseRows(fragment) {
  const sourceRows = [];
  for (const rowMatch of fragment.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)) {
      cells.push({
        tag: cellMatch[1].toLowerCase(),
        text: normalizeCodalText(cellMatch[3]),
        colspan: parseSpan(cellMatch[2], 'colspan'),
        rowspan: parseSpan(cellMatch[2], 'rowspan'),
      });
    }
    if (cells.length) sourceRows.push(cells);
  }

  const matrix = [];
  const cellMatrix = [];
  for (let rowIndex = 0; rowIndex < sourceRows.length; rowIndex += 1) {
    matrix[rowIndex] ??= [];
    cellMatrix[rowIndex] ??= [];
    let columnIndex = 0;
    for (const cell of sourceRows[rowIndex]) {
      while (matrix[rowIndex][columnIndex] !== undefined) columnIndex += 1;
      for (let rowOffset = 0; rowOffset < cell.rowspan; rowOffset += 1) {
        const targetRow = rowIndex + rowOffset;
        matrix[targetRow] ??= [];
        cellMatrix[targetRow] ??= [];
        for (let columnOffset = 0; columnOffset < cell.colspan; columnOffset += 1) {
          matrix[targetRow][columnIndex + columnOffset] = cell.text;
          cellMatrix[targetRow][columnIndex + columnOffset] = cell;
        }
      }
      columnIndex += cell.colspan;
    }
  }
  const width = matrix.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  for (const row of matrix) {
    while (row.length < width) row.push('');
  }
  for (const row of cellMatrix) {
    while (row.length < width) row.push(null);
  }
  return { rows: matrix, cells: cellMatrix };
}

/**
 * Parse ordinary HTML and Codal's Excel-compatible HTML into rectangular rows.
 * Colspan/rowspan values are expanded, which makes multi-row Codal headers usable.
 */
export function parseHtmlTables(html) {
  const source = String(html ?? '');
  const tables = [];
  for (const match of source.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi)) {
    const full = match[0];
    const inner = match[2];
    const thead = inner.match(/<thead\b[^>]*>([\s\S]*?)<\/thead\s*>/i)?.[1] ?? '';
    const tbodyMatches = [...inner.matchAll(/<tbody\b[^>]*>([\s\S]*?)<\/tbody\s*>/gi)];
    const tbody = tbodyMatches.map((item) => item[1]).join('');
    const header = parseRows(thead);
    let body = parseRows(tbody);

    // Some older Excel HTML omits thead/tbody. Treat leading TH rows as headers.
    if (!thead && !tbody) {
      const parsed = parseRows(inner);
      const splitAt = parsed.cells.findIndex((row) => row.some((cell) => cell?.tag === 'td'));
      const boundary = splitAt < 0 ? parsed.rows.length : splitAt;
      header.rows = parsed.rows.slice(0, boundary);
      header.cells = parsed.cells.slice(0, boundary);
      body = { rows: parsed.rows.slice(boundary), cells: parsed.cells.slice(boundary) };
    }

    const start = match.index ?? source.indexOf(full);
    const context = normalizeCodalText(source.slice(Math.max(0, start - 1_500), start));
    tables.push({
      attributes: match[1],
      context,
      headerRows: header.rows,
      rows: body.rows,
      matrix: [...header.rows, ...body.rows],
      width: Math.max(
        ...header.rows.map((row) => row.length),
        ...body.rows.map((row) => row.length),
        0,
      ),
    });
  }
  return tables;
}

function pad2(number) {
  return String(number).padStart(2, '0');
}

export function extractJalaliDate(value) {
  const text = toAsciiDigits(value);
  const matches = [...text.matchAll(/\b((?:13|14)\d{2})\s*[\/-]\s*(\d{1,2})\s*[\/-]\s*(\d{1,2})\b/g)];
  if (!matches.length) return null;
  const [, yearText, monthText, dayText] = matches.at(-1);
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return {
    year,
    month,
    day,
    key: `${year}/${pad2(month)}`,
    value: `${year}/${pad2(month)}/${pad2(day)}`,
  };
}

export function extractReportPeriod(report) {
  if (typeof report === 'string') return extractJalaliDate(report);
  const candidates = [
    report?.PeriodEndToDate,
    report?.PeriodEndDate,
    report?.EndDate,
    report?.Title,
    report?.title,
  ];
  for (const candidate of candidates) {
    const parsed = extractJalaliDate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

export function isCorrectionReport(report) {
  return /اصلاح(?:یه|ي?ه| شده)/i.test(normalizeCodalText(report?.Title ?? report?.title ?? report));
}

function reportTimestamp(report) {
  const value = toAsciiDigits(
    report?.PublishDateTime
      ?? report?.SentDateTime
      ?? report?.publishDateTime
      ?? report?.sentDateTime
      ?? '',
  );
  const digits = value.match(/\d+/g)?.map((part, index) => (index === 0 ? part.padStart(4, '0') : part.padStart(2, '0'))).join('') ?? '';
  return digits;
}

function compareReportPriority(left, right) {
  const correctionDifference = Number(isCorrectionReport(left)) - Number(isCorrectionReport(right));
  if (correctionDifference) return correctionDifference;
  const timestampDifference = reportTimestamp(left).localeCompare(reportTimestamp(right));
  if (timestampDifference) return timestampDifference;
  return Number(left?.TracingNo ?? left?.tracingNo ?? 0) - Number(right?.TracingNo ?? right?.tracingNo ?? 0);
}

/** Select one filing for every symbol/month, preferring the latest correction. */
export function selectLatestCorrectionPerMonth(reports) {
  const selected = new Map();
  for (const report of reports ?? []) {
    const period = extractReportPeriod(report);
    if (!period) continue;
    const symbol = normalizeCodalText(report?.Symbol ?? report?.symbol ?? '');
    const key = `${symbol}|${period.key}`;
    const current = selected.get(key);
    if (!current || compareReportPriority(report, current) > 0) selected.set(key, report);
  }
  return [...selected.values()].sort((left, right) => {
    const leftPeriod = extractReportPeriod(left)?.value ?? '';
    const rightPeriod = extractReportPeriod(right)?.value ?? '';
    return leftPeriod.localeCompare(rightPeriod)
      || normalizeCodalText(left?.Symbol).localeCompare(normalizeCodalText(right?.Symbol), 'fa');
  });
}

export function selectLatestReportForMonth(reports, year, month, symbol = null) {
  const normalizedSymbol = symbol == null ? null : normalizeCodalText(symbol);
  return selectLatestCorrectionPerMonth(reports)
    .filter((report) => {
      const period = extractReportPeriod(report);
      return period?.year === Number(year)
        && period?.month === Number(month)
        && (normalizedSymbol == null || normalizeCodalText(report?.Symbol ?? report?.symbol) === normalizedSymbol);
    })
    .sort(compareReportPriority)
    .at(-1) ?? null;
}

function unique(values) {
  return [...new Set(values)];
}

function compactHeaderChain(table, columnIndex) {
  const chain = [];
  for (const row of table.headerRows) {
    const text = normalizeCodalText(row[columnIndex]);
    if (text && chain.at(-1) !== text) chain.push(text);
  }
  return chain;
}

function classifyMetric(chain) {
  const text = chain.join(' | ');
  if (/(?:تعداد|مقدار)\s*تولید/.test(text)) return 'production';
  if (/(?:تعداد|مقدار)\s*فروش/.test(text)) return 'salesQuantity';
  if (/نرخ\s*فروش/.test(text)) return 'rate';
  if (/مبلغ\s*فروش/.test(text)) return 'revenue';
  if (/نام\s*محصول|شرح\s*محصول/.test(text)) return 'product';
  if (/واحد/.test(text) && !/مبلغ|نرخ/.test(text)) return 'unit';
  return null;
}

function periodLabelFromChain(chain, metric) {
  return chain.filter((part) => {
    if (metric === 'production' && /(?:تعداد|مقدار)\s*تولید/.test(part)) return false;
    if (metric === 'salesQuantity' && /(?:تعداد|مقدار)\s*فروش/.test(part)) return false;
    if (metric === 'rate' && /نرخ\s*فروش/.test(part)) return false;
    if (metric === 'revenue' && /مبلغ\s*فروش/.test(part)) return false;
    return !/^(?:شرح|نام\s*محصول|واحد)$/.test(part);
  }).join(' | ');
}

function classifyPeriod(label) {
  const text = normalizeCodalText(label);
  if (/اصلاحات/.test(text) && !/اصلاح\s*شده/.test(text)) return 'adjustment';
  if (/ابتدای\s*سال|تجمعی/.test(text)) return 'cumulative';
  if (/یک\s*ماهه|1\s*ماهه|ماه\s*جاری|دوره\s*جاری/.test(text)) return 'monthly';
  return 'unknown';
}

function describeColumns(table) {
  return Array.from({ length: table.width }, (_, index) => {
    const chain = compactHeaderChain(table, index);
    const metric = classifyMetric(chain);
    const periodLabel = periodLabelFromChain(chain, metric);
    return {
      index,
      chain,
      metric,
      periodLabel,
      periodKind: classifyPeriod(periodLabel),
      date: extractJalaliDate(periodLabel),
    };
  });
}

function tableScore(table) {
  const header = normalizeCodalText(table.headerRows.flat().join(' '));
  let score = 0;
  if (/نام\s*محصول|شرح\s*محصول/.test(header)) score += 4;
  if (/(?:تعداد|مقدار)\s*تولید/.test(header)) score += 3;
  if (/(?:تعداد|مقدار)\s*فروش/.test(header)) score += 3;
  if (/مبلغ\s*فروش/.test(header)) score += 4;
  if (/نرخ\s*فروش/.test(header)) score += 2;
  if (/تولید\s*و\s*فروش/.test(table.context)) score += 2;
  return score;
}

function normalizeUnit(value) {
  const compact = normalizeCodalText(value).replace(/\s+/g, '');
  if (!compact) return '';
  // Filers inconsistently use "هزار تن", "هزارتن" and ZWNJ variants.
  return compact
    .replace(/^(هزار|میلیون|میلیارد)(?=\S)/, '$1 ')
    .replace(/مترمربع/g, 'متر مربع')
    .replace(/مترمکعب/g, 'متر مکعب')
    .replace(/واتساعت/g, 'وات ساعت');
}

function productKey(value) {
  return normalizeCodalText(value).replace(/[\s:؛،,.\-_/]+/g, ' ').trim();
}

function isTotalRow(name) {
  return /^(?:جمع|مجموع|کل)(?:\s|$)/.test(productKey(name));
}

function isGrandTotalRow(name) {
  return /^(?:جمع(?:\s+کل)?|مجموع(?:\s+کل)?|کل)$/.test(productKey(name));
}

function identifySection(value) {
  const text = productKey(value);
  if (/^فروش\s*داخلی(?:\s|$)/.test(text)) return 'domestic';
  if (/^فروش\s*صادرات|^صادراتی(?:\s|$)/.test(text)) return 'export';
  if (/^(?:درآمد\s*)?(?:حاصل\s*از\s*)?ارائه\s*خدمات(?:\s|$)|^درآمد\s*خدمات(?:\s|$)|^خدمات$/.test(text)) return 'services';
  if (/^(?:برگشت|بازگشت)\s*از\s*فروش(?:\s|$)|^برگشتی(?:\s|$)/.test(text)) return 'returns';
  if (/^تخفیف(?:ات)?(?:\s|$)/.test(text)) return 'discounts';
  return null;
}

function sumPresent(values) {
  const present = values.filter((value) => value != null && Number.isFinite(value));
  return present.length ? present.reduce((sum, value) => sum + value, 0) : null;
}

function detectRevenueMultiplier(text) {
  const normalized = normalizeCodalText(text);
  if (/میلیارد\s*ریال/.test(normalized)) return 1_000_000_000;
  if (/میلیون\s*ریال/.test(normalized)) return 1_000_000;
  if (/هزار\s*ریال/.test(normalized)) return 1_000;
  return 1_000_000; // Codal's monthly production form default.
}

function buildPeriodColumnSets(columns) {
  const sets = new Map();
  for (const column of columns) {
    if (!['production', 'salesQuantity', 'rate', 'revenue'].includes(column.metric)) continue;
    const key = `${column.periodKind}|${column.periodLabel}`;
    if (!sets.has(key)) {
      sets.set(key, {
        label: column.periodLabel,
        kind: column.periodKind,
        date: column.date,
        columns: {},
      });
    }
    sets.get(key).columns[column.metric] = column.index;
  }
  return [...sets.values()].filter((set) => set.columns.revenue != null || set.columns.salesQuantity != null);
}

function selectPeriodSets(sets) {
  const monthlyCandidates = sets
    .filter((set) => set.kind === 'monthly')
    .sort((left, right) => (left.date?.value ?? '').localeCompare(right.date?.value ?? ''));
  const monthly = monthlyCandidates.at(-1) ?? null;
  const targetDate = monthly?.date;
  const cumulativeSets = sets.filter((set) => set.kind === 'cumulative');

  const exactCurrent = cumulativeSets.filter((set) => set.date?.value === targetDate?.value);
  const cumulativeCurrent = exactCurrent.find((set) => !/اصلاح\s*شده/.test(set.label))
    ?? exactCurrent.at(-1)
    ?? cumulativeSets.filter((set) => set.date?.year === targetDate?.year).at(-1)
    ?? null;

  const cumulativePriorYear = targetDate
    ? cumulativeSets.find((set) => set.date?.year === targetDate.year - 1 && set.date?.month === targetDate.month) ?? null
    : null;

  return { monthly, cumulativeCurrent, cumulativePriorYear };
}

function extractPeriodEntries(table, columns, set) {
  if (!set) return [];
  const productColumn = columns.find((column) => column.metric === 'product')?.index ?? 0;
  const unitColumn = columns.find((column) => column.metric === 'unit')?.index ?? 1;
  let section = 'unspecified';
  const entries = [];

  for (const row of table.rows) {
    const name = normalizeCodalText(row[productColumn]);
    if (!name) continue;
    const detectedSection = identifySection(name);
    const metrics = {
      production: parseCodalNumber(row[set.columns.production]),
      salesQuantity: parseCodalNumber(row[set.columns.salesQuantity]),
      reportedRate: parseCodalNumber(row[set.columns.rate]),
      revenue: parseCodalNumber(row[set.columns.revenue]),
    };
    const hasMetric = Object.values(metrics).some((value) => value != null);
    if (detectedSection) {
      section = detectedSection;
      // Most section labels are empty headings. Codal also uses rows such as
      // "تخفیفات" (and occasionally "برگشت از فروش") as signed financial
      // adjustments. Keep those rows in company totals, but mark them so they
      // can never be mistaken for the period's dominant product.
      if (!hasMetric || !['returns', 'discounts'].includes(detectedSection)) continue;
    }
    if (!hasMetric || isTotalRow(name)) continue;
    entries.push({
      name,
      key: productKey(name),
      section,
      isAdjustment: Boolean(detectedSection),
      unit: normalizeUnit(row[unitColumn]),
      ...metrics,
    });
  }
  return entries;
}

function extractReportedTotals(table, columns, set) {
  if (!set) return null;
  const productColumn = columns.find((column) => column.metric === 'product')?.index ?? 0;
  const unitColumn = columns.find((column) => column.metric === 'unit')?.index ?? 1;
  const row = [...table.rows]
    .reverse()
    .find((candidate) => isGrandTotalRow(normalizeCodalText(candidate[productColumn])));
  if (!row) return null;
  return {
    production: parseCodalNumber(row[set.columns.production]),
    salesQuantity: parseCodalNumber(row[set.columns.salesQuantity]),
    reportedRate: parseCodalNumber(row[set.columns.rate]),
    revenue: parseCodalNumber(row[set.columns.revenue]),
    unit: normalizeUnit(row[unitColumn]),
  };
}

function aggregateEntries(entries, revenueMultiplier, reportedTotals = null) {
  const productEntries = entries.filter((entry) => !entry.isAdjustment);
  const grouped = new Map();
  for (const entry of productEntries) {
    if (!entry.key) continue;
    if (!grouped.has(entry.key)) grouped.set(entry.key, []);
    grouped.get(entry.key).push(entry);
  }

  const products = [...grouped.values()].map((parts) => {
    const units = unique(parts.map((part) => part.unit).filter(Boolean));
    const compatibleUnits = units.length <= 1;
    const production = compatibleUnits ? sumPresent(parts.map((part) => part.production)) : null;
    const salesQuantity = compatibleUnits ? sumPresent(parts.map((part) => part.salesQuantity)) : null;
    const revenue = sumPresent(parts.map((part) => part.revenue));
    const calculatedRate = compatibleUnits && revenue != null && salesQuantity
      ? (revenue * revenueMultiplier) / salesQuantity
      : null;
    const reportedRates = parts.map((part) => part.reportedRate).filter((rate) => rate != null);
    return {
      name: parts[0].name,
      key: parts[0].key,
      unit: compatibleUnits ? (units[0] ?? '') : null,
      units,
      compatibleUnits,
      production,
      salesQuantity,
      sales: salesQuantity,
      revenue,
      rate: calculatedRate ?? (reportedRates.length === 1 ? reportedRates[0] : null),
      reportedRate: reportedRates.length === 1 ? reportedRates[0] : null,
      sections: unique(parts.map((part) => part.section)),
      entries: parts,
    };
  }).sort((left, right) => (right.revenue ?? -Infinity) - (left.revenue ?? -Infinity));

  const units = unique(entries.map((entry) => entry.unit).filter(Boolean));
  const compatibleUnits = units.length <= 1;
  const production = compatibleUnits ? sumPresent(entries.map((entry) => entry.production)) : null;
  const salesQuantity = compatibleUnits ? sumPresent(entries.map((entry) => entry.salesQuantity)) : null;
  const calculatedRevenue = sumPresent(entries.map((entry) => entry.revenue));
  // The final Codal "جمع" row is the authoritative net sales amount and can
  // include signed discounts/adjustments that have no quantity column.
  const revenue = reportedTotals?.revenue ?? calculatedRevenue;
  const weightedRate = compatibleUnits && revenue != null && salesQuantity
    ? (revenue * revenueMultiplier) / salesQuantity
    : null;

  return {
    entries,
    adjustments: entries.filter((entry) => entry.isAdjustment),
    products,
    dominantProduct: products.find((product) => product.revenue != null && product.revenue > 0) ?? null,
    reportedTotals,
    calculatedRevenue,
    totals: {
      production,
      salesQuantity,
      sales: salesQuantity,
      revenue,
      weightedRate,
      rate: weightedRate,
      unit: compatibleUnits ? (units[0] ?? '') : null,
      units,
      compatibleUnits,
      unitsCompatible: compatibleUnits,
    },
  };
}

function parsePeriod(table, columns, set, revenueMultiplier) {
  if (!set) return null;
  const entries = extractPeriodEntries(table, columns, set);
  const reportedTotals = extractReportedTotals(table, columns, set);
  return {
    label: set.label,
    kind: set.kind,
    date: set.date,
    year: set.date?.year ?? null,
    month: set.date?.month ?? null,
    revenueScale: revenueMultiplier,
    ...aggregateEntries(entries, revenueMultiplier, reportedTotals),
  };
}

/**
 * Extract the monthly, current-YTD and prior-year-YTD production/sales sections.
 * Monetary values stay in the unit reported by Codal (normally million rials);
 * calculated rates are returned in rials per reported quantity unit.
 */
export function parseProductionSalesReport(html) {
  const tables = parseHtmlTables(html);
  const ranked = tables
    .map((table) => ({ table, score: tableScore(table) }))
    .sort((left, right) => right.score - left.score);
  const table = ranked[0]?.score >= 10 ? ranked[0].table : null;
  if (!table) {
    return {
      tableFound: false,
      monthly: null,
      cumulativeCurrent: null,
      cumulativePriorYear: null,
      periods: {},
      warnings: ['Production/sales table was not found.'],
    };
  }

  const columns = describeColumns(table);
  const availablePeriodSets = buildPeriodColumnSets(columns);
  const selected = selectPeriodSets(availablePeriodSets);
  const revenueMultiplier = detectRevenueMultiplier(`${table.context} ${table.headerRows.flat().join(' ')}`);
  const monthly = parsePeriod(table, columns, selected.monthly, revenueMultiplier);
  const cumulativeCurrent = parsePeriod(table, columns, selected.cumulativeCurrent, revenueMultiplier);
  const cumulativePriorYear = parsePeriod(table, columns, selected.cumulativePriorYear, revenueMultiplier);
  const warnings = [];
  if (!monthly) warnings.push('Monthly period columns were not found.');
  if (monthly && !monthly.totals.compatibleUnits) {
    warnings.push('Production/sales totals and weighted rate are unavailable because product units differ.');
  }

  return {
    tableFound: true,
    revenueMultiplier,
    revenueScale: revenueMultiplier,
    revenueUnit: revenueMultiplier === 1_000_000 ? 'million-rial' : 'rial',
    columns,
    availablePeriods: availablePeriodSets.map(({ columns: periodColumns, ...set }) => ({ ...set, columns: periodColumns })),
    monthly,
    cumulativeCurrent,
    cumulativePriorYear,
    periods: { monthly, cumulativeCurrent, cumulativePriorYear },
    warnings,
  };
}

function isCodalHost(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  return hostname === 'codal.ir' || hostname.endsWith('.codal.ir');
}

function tlsErrorCode(error) {
  return error?.code ?? error?.cause?.code ?? error?.cause?.cause?.code ?? '';
}

function isCodalTlsChainError(error, url) {
  return isCodalHost(url) && [
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ].includes(tlsErrorCode(error));
}

function nativeRequest(url, { headers, signal, insecureCodalTls = false, redirects = 0 } = {}) {
  if (redirects > 5) return Promise.reject(new CodalHttpError('Too many redirects', { url }));
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.request(parsed, {
      method: 'GET',
      headers,
      rejectUnauthorized: !(insecureCodalTls && isCodalHost(url)),
      signal,
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        const redirected = new URL(response.headers.location, url).toString();
        nativeRequest(redirected, { headers, signal, insecureCodalTls, redirects: redirects + 1 })
          .then(resolve, reject);
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status,
        headers: response.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function buildSearchParameters(options = {}) {
  const standard = {
    PageNumber: options.pageNumber ?? 1,
    Symbol: options.symbol,
    CompanyName: options.companyName,
    LetterType: options.letterType ?? 58,
    Category: options.category ?? 3,
    FromDate: options.fromDate,
    ToDate: options.toDate,
    Audited: options.audited ?? true,
    NotAudited: options.notAudited ?? true,
    Consolidatable: options.consolidatable ?? true,
    NotConsolidatable: options.notConsolidatable ?? true,
    Childs: options.childs ?? false,
    Mains: options.mains ?? true,
    Publisher: options.publisher ?? false,
    search: options.search ?? true,
  };
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(standard)) {
    if (value != null && value !== '') parameters.set(key, String(value));
  }
  for (const [key, value] of Object.entries(options.extraParameters ?? {})) {
    if (value != null) parameters.set(key, String(value));
  }
  return parameters;
}

/** Small, injectable client for the public Codal search and Excel services. */
export class CodalClient {
  constructor({
    fetchImpl = globalThis.fetch,
    fetchJson = null,
    fetchText = null,
    searchBaseUrl = CODAL_SEARCH_BASE_URL,
    headers = {},
    timeoutMs = 30_000,
    retries = 2,
    retryDelayMs = 350,
    allowCodalTlsFallback = true,
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.fetchJson = fetchJson;
    this.fetchText = fetchText;
    this.searchBaseUrl = searchBaseUrl.replace(/\/$/, '');
    this.headers = { ...DEFAULT_HEADERS, ...headers };
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.retryDelayMs = retryDelayMs;
    this.allowCodalTlsFallback = allowCodalTlsFallback;
  }

  async #request(url, responseType) {
    const injected = responseType === 'json' ? this.fetchJson : this.fetchText;
    if (injected) return injected(url, { headers: this.headers, timeoutMs: this.timeoutMs });

    let finalError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        let status;
        let body;
        try {
          if (typeof this.fetchImpl !== 'function') throw new TypeError('No fetch implementation is available.');
          const response = await this.fetchImpl(url, {
            method: 'GET',
            headers: this.headers,
            signal: controller.signal,
            redirect: 'follow',
          });
          status = response.status;
          body = await response.text();
        } catch (error) {
          if (!(this.allowCodalTlsFallback && isCodalTlsChainError(error, url))) throw error;
          const fallback = await nativeRequest(url, {
            headers: this.headers,
            signal: controller.signal,
            insecureCodalTls: true,
          });
          status = fallback.status;
          body = fallback.text;
        }

        if (status < 200 || status >= 300) {
          throw new CodalHttpError(`Codal returned HTTP ${status}`, {
            status,
            url,
            body: body.slice(0, 1_000),
          });
        }
        if (responseType === 'text') return body;
        try {
          return JSON.parse(body.replace(/^\ufeff/, ''));
        } catch (cause) {
          throw new CodalHttpError('Codal returned invalid JSON', {
            status,
            url,
            body: body.slice(0, 1_000),
            cause,
          });
        }
      } catch (error) {
        finalError = error;
        const retryable = error?.name === 'AbortError'
          || error?.status === 429
          || error?.status >= 500
          || !(error instanceof CodalHttpError);
        if (!retryable || attempt === this.retries) break;
        await sleep(this.retryDelayMs * (2 ** attempt));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw finalError;
  }

  async getJson(url) {
    return this.#request(url, 'json');
  }

  async getText(url) {
    return this.#request(url, 'text');
  }

  async fetchCompanies({ reportingType = null } = {}) {
    const payload = await this.getJson(`${this.searchBaseUrl}/api/search/v1/companies`);
    const companies = Array.isArray(payload) ? payload : (payload?.Companies ?? payload?.companies ?? []);
    return reportingType == null
      ? companies
      : companies.filter((company) => Number(company.RT ?? company.ReportingType ?? company.reportingType) === Number(reportingType));
  }

  async fetchProductionCompanies() {
    return this.fetchCompanies({ reportingType: PRODUCTION_REPORTING_TYPE });
  }

  async fetchIndustries() {
    const payload = await this.getJson(`${this.searchBaseUrl}/api/search/v1/IndustryGroup`);
    return Array.isArray(payload) ? payload : (payload?.Industries ?? payload?.industryGroups ?? []);
  }

  async searchMonthlyReportPage(options = {}) {
    const parameters = buildSearchParameters(options);
    const url = `${this.searchBaseUrl}/api/search/v2/q?${parameters}`;
    const payload = await this.getJson(url);
    return {
      letters: payload?.Letters ?? payload?.letters ?? [],
      total: Number(payload?.Total ?? payload?.total ?? 0),
      pages: Math.max(1, Number(payload?.Page ?? payload?.pages ?? 1)),
      raw: payload,
    };
  }

  async searchMonthlyReports(options = {}) {
    const firstPageNumber = Number(options.pageNumber ?? 1);
    const first = await this.searchMonthlyReportPage({ ...options, pageNumber: firstPageNumber });
    if (options.allPages === false || first.pages <= 1) return first.letters;
    const maximum = Math.min(first.pages, Number(options.maxPages ?? Number.POSITIVE_INFINITY));
    const pages = [];
    for (let pageNumber = firstPageNumber + 1; pageNumber <= maximum; pageNumber += 1) {
      pages.push(this.searchMonthlyReportPage({ ...options, pageNumber }));
    }
    const rest = await Promise.all(pages);
    return [...first.letters, ...rest.flatMap((page) => page.letters)];
  }

  async fetchReportHtml(reportOrUrl) {
    const url = typeof reportOrUrl === 'string'
      ? reportOrUrl
      : reportOrUrl?.ExcelUrl ?? reportOrUrl?.excelUrl;
    if (!url) throw new TypeError('The report does not contain an ExcelUrl.');
    return this.getText(new URL(url, this.searchBaseUrl).toString());
  }

  async fetchAndParseReport(reportOrUrl) {
    return parseProductionSalesReport(await this.fetchReportHtml(reportOrUrl));
  }
}
