/**
 * Jalali month/period helpers and aggregation for monthly Codal reports.
 *
 * A normalized monthly report has this shape:
 * {
 *   year: 1405,
 *   month: 5,
 *   revenueScale: 1_000_000, // optional; Codal amounts are normally million IRR
 *   totals: {
 *     production: Number | null,
 *     sales: Number | null,
 *     revenue: Number | null,
 *     unit: String | null,
 *     unitsCompatible: Boolean
 *   },
 *   products: [ // recommended; needed for exact period-level dominant product
 *     { name, unit, sales, revenue, rate }
 *   ],
 *   dominantProduct: { name, unit, sales, revenue, rate } // fallback only
 * }
 */

export const JALALI_MONTH_NAMES = Object.freeze([
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
]);

export const METRIC_KEYS = Object.freeze([
  'production',
  'sales',
  'revenue',
  'dominantProductSales',
  'dominantProductRate',
  'weightedRate',
]);

const DEFAULT_REVENUE_SCALE = 1_000_000;

function assertInteger(value, name) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
}

export function normalizeJalaliMonth(value) {
  if (!value || typeof value !== 'object') {
    throw new TypeError('A Jalali month must be an object with year and month');
  }

  const year = Number(value.year);
  const month = Number(value.month);
  assertInteger(year, 'year');
  assertInteger(month, 'month');

  if (year < 1) throw new RangeError('year must be positive');
  if (month < 1 || month > 12) {
    throw new RangeError('month must be between 1 and 12');
  }

  return { year, month };
}

/** Add a signed number of months to a Jalali year/month. */
export function addJalaliMonths(value, offset) {
  const { year, month } = normalizeJalaliMonth(value);
  assertInteger(offset, 'offset');

  const absoluteMonth = (year - 1) * 12 + (month - 1) + offset;
  if (absoluteMonth < 0) throw new RangeError('resulting Jalali month is before year 1');

  return {
    year: Math.floor(absoluteMonth / 12) + 1,
    month: (absoluteMonth % 12) + 1,
  };
}
export function previousJalaliMonth(value, count = 1) {
  assertInteger(count, 'count');
  if (count < 0) throw new RangeError('count must not be negative');
  return addJalaliMonths(value, -count);
}

export function formatJalaliMonth(value) {
  const { year, month } = normalizeJalaliMonth(value);
  return `${JALALI_MONTH_NAMES[month - 1]} ${year}`;
}

export function jalaliYearMonths(year, endMonth = 12, startMonth = 1) {
  year = Number(year);
  startMonth = Number(startMonth);
  endMonth = Number(endMonth);
  assertInteger(year, 'year');
  assertInteger(startMonth, 'startMonth');
  assertInteger(endMonth, 'endMonth');
  if (year < 1) throw new RangeError('year must be positive');
  if (startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12) {
    throw new RangeError('month bounds must be between 1 and 12');
  }
  if (startMonth > endMonth) {
    throw new RangeError('startMonth must not be after endMonth');
  }

  return Array.from(
    { length: endMonth - startMonth + 1 },
    (_, index) => ({ year, month: startMonth + index }),
  );
}

/**
 * Defines the six displayed value periods and the three growth comparisons.
 * The target month is always one month before the execution month.
 */
export function getReportPeriods(executionMonth) {
  const execution = normalizeJalaliMonth(executionMonth);
  const target = previousJalaliMonth(execution);
  const priorYearTarget = { year: target.year - 1, month: target.month };
  const previousMonth = previousJalaliMonth(target);
  const previousMonthPriorYear = {
    year: previousMonth.year - 1,
    month: previousMonth.month,
  };

  if (priorYearTarget.year < 1 || previousMonthPriorYear.year < 1) {
    throw new RangeError('execution month is too early to build prior-year comparisons');
  }

  const periods = {
    priorYearTarget: {
      key: 'priorYearTarget',
      label: formatJalaliMonth(priorYearTarget),
      months: [priorYearTarget],
      aggregation: 'single',
    },
    priorYearYtdAverage: {
      key: 'priorYearYtdAverage',
      label: `میانگین فروردین تا ${formatJalaliMonth(priorYearTarget)}`,
      months: jalaliYearMonths(priorYearTarget.year, priorYearTarget.month),
      aggregation: 'average',
    },
    priorYearFullYearAverage: {
      key: 'priorYearFullYearAverage',
      label: `میانگین ۱۲ ماهه ${priorYearTarget.year}`,
      months: jalaliYearMonths(priorYearTarget.year),
      aggregation: 'average',
    },
    previousMonth: {
      key: 'previousMonth',
      label: formatJalaliMonth(previousMonth),
      months: [previousMonth],
      aggregation: 'single',
    },
    targetMonth: {
      key: 'targetMonth',
      label: formatJalaliMonth(target),
      months: [target],
      aggregation: 'single',
    },
    currentYearYtdAverage: {
      key: 'currentYearYtdAverage',
      label: `میانگین فروردین تا ${formatJalaliMonth(target)}`,
      months: jalaliYearMonths(target.year, target.month),
      aggregation: 'average',
    },
  };

  const growth = {
    targetYoY: {
      key: 'targetYoY',
      label: `رشد ${formatJalaliMonth(target)} نسبت به ${formatJalaliMonth(priorYearTarget)}`,
      numerator: 'targetMonth',
      denominator: 'priorYearTarget',
    },
    ytdYoY: {
      key: 'ytdYoY',
      label: `رشد میانگین سال ${target.year} نسبت به ${priorYearTarget.year}`,
      numerator: 'currentYearYtdAverage',
      denominator: 'priorYearYtdAverage',
    },
    previousMonthYoY: {
      key: 'previousMonthYoY',
      label: `رشد ${formatJalaliMonth(previousMonth)} نسبت به ${formatJalaliMonth(previousMonthPriorYear)}`,
      numerator: 'previousMonth',
      denominator: 'previousMonthPriorYear',
      denominatorMonths: [previousMonthPriorYear],
    },
  };

  return {
    executionMonth: execution,
    targetMonth: target,
    priorYearTargetMonth: priorYearTarget,
    previousMonth,
    previousMonthPriorYear,
    periods,
    growth,
    columnOrder: [
      'priorYearTarget',
      'priorYearYtdAverage',
      'priorYearFullYearAverage',
      'previousMonth',
      'targetMonth',
      'currentYearYtdAverage',
      'targetYoY',
      'ytdYoY',
      'previousMonthYoY',
    ],
  };
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function monthKey(value) {
  const { year, month } = normalizeJalaliMonth(value);
  return `${year}-${String(month).padStart(2, '0')}`;
}

function numericSum(values) {
  const numbers = values.map(finiteNumber).filter((value) => value !== null);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : null;
}

function numericAverage(values) {
  const numbers = values.map(finiteNumber).filter((value) => value !== null);
  return numbers.length
    ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length
    : null;
}

function aggregateNumber(values, average) {
  return average ? numericAverage(values) : numericSum(values);
}

function normalizedUnit(value) {
  const unit = String(value ?? '').trim();
  return unit || null;
}

function reportRevenueScale(report, fallback) {
  const scale = finiteNumber(report?.revenueScale);
  return scale !== null && scale > 0 ? scale : fallback;
}

function productEntries(report) {
  if (Array.isArray(report.products) && report.products.length) {
    return report.products;
  }
  return report.dominantProduct ? [report.dominantProduct] : [];
}

function aggregateDominantProduct(reports, average, revenueScale) {
  const products = new Map();

  for (const report of reports) {
    const scale = reportRevenueScale(report, revenueScale);
    for (const product of productEntries(report)) {
      const name = String(product?.name ?? '').trim();
      if (!name) continue;
      const unit = normalizedUnit(product.unit);
      const key = `${name}\u0000${unit ?? ''}`;
      const current = products.get(key) ?? {
        name,
        unit,
        sales: 0,
        hasSales: false,
        revenue: 0,
        hasRevenue: false,
        revenueInBaseUnit: 0,
        firstSeen: products.size,
      };
      const sales = finiteNumber(product.sales);
      const revenue = finiteNumber(product.revenue);
      if (sales !== null) {
        current.sales += sales;
        current.hasSales = true;
      }
      if (revenue !== null) {
        current.revenue += revenue;
        current.revenueInBaseUnit += revenue * scale;
        current.hasRevenue = true;
      }
      products.set(key, current);
    }
  }

  const candidates = [...products.values()].filter(
    (product) => product.hasRevenue && product.revenueInBaseUnit > 0,
  );
  candidates.sort((left, right) => {
    const revenueDifference = right.revenueInBaseUnit - left.revenueInBaseUnit;
    return revenueDifference || left.firstSeen - right.firstSeen;
  });
  const dominant = candidates[0] ?? null;
  if (!dominant) return null;

  const sales = dominant.hasSales
    ? dominant.sales / (average ? reports.length || 1 : 1)
    : null;
  const rate = dominant.hasSales && dominant.sales !== 0
    ? dominant.revenueInBaseUnit / dominant.sales
    : null;

  return {
    name: dominant.name,
    unit: dominant.unit,
    sales,
    revenue: average ? dominant.revenue / (reports.length || 1) : dominant.revenue,
    rate,
    periodSalesTotal: dominant.hasSales ? dominant.sales : null,
    periodRevenueTotal: dominant.revenue,
  };
}

/**
 * Aggregate normalized reports for the requested Jalali months.
 *
 * For averages, quantity/revenue metrics are arithmetic monthly averages.
 * Rates are never averaged arithmetically: they are calculated from period
 * revenue divided by period sales quantity. The period's dominant product is
 * the product with the greatest total revenue over the whole period.
 */
export function aggregatePeriod(monthlyReports, months, options = {}) {
  if (!Array.isArray(monthlyReports)) throw new TypeError('monthlyReports must be an array');
  if (!Array.isArray(months) || months.length === 0) {
    throw new TypeError('months must be a non-empty array');
  }

  const average = options.average ?? months.length > 1;
  const revenueScale = finiteNumber(options.revenueScale) ?? DEFAULT_REVENUE_SCALE;
  if (revenueScale <= 0) throw new RangeError('revenueScale must be positive');

  // Later entries replace earlier ones. The fetch/normalization layer can put
  // a corrected disclosure after its original report.
  const reportsByMonth = new Map();
  for (const report of monthlyReports) {
    if (!report || typeof report !== 'object') continue;
    try {
      reportsByMonth.set(monthKey(report), report);
    } catch {
      // Malformed unrelated entries do not make the requested period unusable.
    }
  }

  const requestedMonths = months.map(normalizeJalaliMonth);
  const reports = requestedMonths
    .map((month) => reportsByMonth.get(monthKey(month)))
    .filter(Boolean);

  const units = new Set(
    reports.map((report) => normalizedUnit(report.totals?.unit)).filter(Boolean),
  );
  const unitsCompatible = reports.length > 0
    && reports.every((report) => report.totals?.unitsCompatible !== false)
    && units.size <= 1;

  const production = unitsCompatible
    ? aggregateNumber(reports.map((report) => report.totals?.production), average)
    : null;
  const sales = unitsCompatible
    ? aggregateNumber(reports.map((report) => report.totals?.sales), average)
    : null;
  const revenue = aggregateNumber(
    reports.map((report) => report.totals?.revenue),
    average,
  );

  const totalSalesForRate = unitsCompatible
    ? numericSum(reports.map((report) => report.totals?.sales))
    : null;
  const revenueInBaseUnit = reports.reduce((sum, report) => {
    const reportRevenue = finiteNumber(report.totals?.revenue);
    return reportRevenue === null
      ? sum
      : sum + reportRevenue * reportRevenueScale(report, revenueScale);
  }, 0);
  const hasRevenue = reports.some(
    (report) => finiteNumber(report.totals?.revenue) !== null,
  );
  const weightedRate = totalSalesForRate !== null
    && totalSalesForRate !== 0
    && hasRevenue
    ? revenueInBaseUnit / totalSalesForRate
    : null;

  const dominantProduct = aggregateDominantProduct(
    reports,
    Boolean(average),
    revenueScale,
  );
  const metrics = {
    production,
    sales,
    revenue,
    dominantProductSales: dominantProduct?.sales ?? null,
    dominantProductRate: dominantProduct?.rate ?? null,
    weightedRate,
  };

  return {
    metrics,
    totals: {
      production,
      sales,
      revenue,
      weightedRate,
      unit: unitsCompatible ? [...units][0] ?? null : null,
      unitsCompatible,
    },
    dominantProduct,
    meta: {
      average: Boolean(average),
      requestedMonthCount: requestedMonths.length,
      reportCount: reports.length,
      complete: reports.length === requestedMonths.length,
      requestedMonths,
      availableMonths: reports.map(({ year, month }) => ({ year, month })),
      missingMonths: requestedMonths.filter((month) => !reportsByMonth.has(monthKey(month))),
    },
  };
}

export function calculateGrowth(current, baseline) {
  const currentNumber = finiteNumber(current);
  const baselineNumber = finiteNumber(baseline);
  if (currentNumber === null || baselineNumber === null || baselineNumber === 0) {
    return null;
  }
  return currentNumber / baselineNumber - 1;
}

export function calculateMetricGrowth(currentMetrics, baselineMetrics) {
  return Object.fromEntries(
    METRIC_KEYS.map((key) => [
      key,
      calculateGrowth(currentMetrics?.[key], baselineMetrics?.[key]),
    ]),
  );
}

/** Build all six value columns and all three growth columns for one symbol. */
export function buildSymbolPeriodMetrics(monthlyReports, executionMonth, options = {}) {
  const definitions = getReportPeriods(executionMonth);
  const periodValues = {};

  for (const definition of Object.values(definitions.periods)) {
    periodValues[definition.key] = aggregatePeriod(
      monthlyReports,
      definition.months,
      {
        ...options,
        average: definition.aggregation === 'average',
      },
    );
  }

  const previousMonthPriorYear = aggregatePeriod(
    monthlyReports,
    [definitions.previousMonthPriorYear],
    { ...options, average: false },
  );

  const growth = {
    targetYoY: calculateMetricGrowth(
      periodValues.targetMonth.metrics,
      periodValues.priorYearTarget.metrics,
    ),
    ytdYoY: calculateMetricGrowth(
      periodValues.currentYearYtdAverage.metrics,
      periodValues.priorYearYtdAverage.metrics,
    ),
    previousMonthYoY: calculateMetricGrowth(
      periodValues.previousMonth.metrics,
      previousMonthPriorYear.metrics,
    ),
  };

  return {
    executionMonth: definitions.executionMonth,
    targetMonth: definitions.targetMonth,
    periods: periodValues,
    growth,
    definitions,
    comparisonPeriods: { previousMonthPriorYear },
  };
}
