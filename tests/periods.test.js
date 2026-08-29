import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addJalaliMonths,
  aggregatePeriod,
  buildSymbolPeriodMetrics,
  calculateGrowth,
  getReportPeriods,
  previousJalaliMonth,
} from '../src/periods.js';

function report(year, month, values = {}) {
  return {
    year,
    month,
    totals: {
      production: values.production ?? 100,
      sales: values.sales ?? 10,
      revenue: values.revenue ?? 100,
      unit: values.unit ?? 'تن',
      unitsCompatible: values.unitsCompatible ?? true,
    },
    products: values.products ?? [
      {
        name: 'محصول اصلی',
        unit: values.unit ?? 'تن',
        sales: values.sales ?? 10,
        revenue: values.revenue ?? 100,
      },
    ],
  };
}

test('Jalali month arithmetic crosses year boundaries', () => {
  assert.deepEqual(previousJalaliMonth({ year: 1405, month: 1 }), {
    year: 1404,
    month: 12,
  });
  assert.deepEqual(addJalaliMonths({ year: 1404, month: 12 }, 2), {
    year: 1405,
    month: 2,
  });
});

test('execution month is shifted back and column periods match the requested design', () => {
  const result = getReportPeriods({ year: 1405, month: 6 });

  assert.deepEqual(result.targetMonth, { year: 1405, month: 5 });
  assert.deepEqual(result.priorYearTargetMonth, { year: 1404, month: 5 });
  assert.deepEqual(result.previousMonth, { year: 1405, month: 4 });
  assert.deepEqual(result.previousMonthPriorYear, { year: 1404, month: 4 });
  assert.equal(result.periods.priorYearYtdAverage.months.length, 5);
  assert.equal(result.periods.priorYearFullYearAverage.months.length, 12);
  assert.equal(result.periods.currentYearYtdAverage.months.length, 5);
  assert.deepEqual(result.columnOrder, [
    'priorYearTarget',
    'priorYearYtdAverage',
    'priorYearFullYearAverage',
    'previousMonth',
    'targetMonth',
    'currentYearYtdAverage',
    'targetYoY',
    'ytdYoY',
    'previousMonthYoY',
  ]);
});

test('Farvardin execution correctly targets Esfand of the prior year', () => {
  const result = getReportPeriods({ year: 1405, month: 1 });

  assert.deepEqual(result.targetMonth, { year: 1404, month: 12 });
  assert.deepEqual(result.previousMonth, { year: 1404, month: 11 });
  assert.deepEqual(result.priorYearTargetMonth, { year: 1403, month: 12 });
  assert.equal(result.periods.currentYearYtdAverage.months.length, 12);
  assert.equal(result.periods.priorYearFullYearAverage.months[0].year, 1403);
});

test('period aggregation averages quantities but weights both rates by sales', () => {
  const reports = [
    report(1405, 1, {
      production: 100,
      sales: 10,
      revenue: 200,
      products: [
        { name: 'A', unit: 'تن', sales: 5, revenue: 100 },
        { name: 'B', unit: 'تن', sales: 10, revenue: 100 },
      ],
    }),
    report(1405, 2, {
      production: 300,
      sales: 30,
      revenue: 900,
      products: [
        { name: 'A', unit: 'تن', sales: 10, revenue: 500 },
        { name: 'B', unit: 'تن', sales: 20, revenue: 400 },
      ],
    }),
  ];

  const result = aggregatePeriod(
    reports,
    [{ year: 1405, month: 1 }, { year: 1405, month: 2 }],
    { average: true },
  );

  assert.equal(result.metrics.production, 200);
  assert.equal(result.metrics.sales, 20);
  assert.equal(result.metrics.revenue, 550);
  assert.equal(result.dominantProduct.name, 'A');
  assert.equal(result.metrics.dominantProductSales, 7.5);
  assert.equal(result.metrics.dominantProductRate, 40_000_000);
  assert.equal(result.metrics.weightedRate, 27_500_000);
  assert.equal(result.meta.complete, true);
});

test('period dominant product uses cumulative revenue, not monthly winner frequency', () => {
  const reports = [
    report(1405, 1, {
      products: [
        { name: 'A', unit: 'تن', sales: 1, revenue: 90 },
        { name: 'B', unit: 'تن', sales: 1, revenue: 100 },
      ],
    }),
    report(1405, 2, {
      products: [
        { name: 'A', unit: 'تن', sales: 1, revenue: 90 },
        { name: 'C', unit: 'تن', sales: 1, revenue: 100 },
      ],
    }),
  ];

  const result = aggregatePeriod(
    reports,
    [{ year: 1405, month: 1 }, { year: 1405, month: 2 }],
  );
  assert.equal(result.dominantProduct.name, 'A');
  assert.equal(result.dominantProduct.periodRevenueTotal, 180);
});

test('incompatible units suppress meaningless total quantities and total weighted rate', () => {
  const result = aggregatePeriod(
    [report(1405, 1, { unitsCompatible: false, revenue: 500 })],
    [{ year: 1405, month: 1 }],
  );

  assert.equal(result.metrics.production, null);
  assert.equal(result.metrics.sales, null);
  assert.equal(result.metrics.revenue, 500);
  assert.equal(result.metrics.weightedRate, null);
  assert.equal(result.dominantProduct.name, 'محصول اصلی');
});

test('missing reports are exposed in metadata and do not fabricate zeroes', () => {
  const result = aggregatePeriod(
    [report(1405, 1)],
    [{ year: 1405, month: 1 }, { year: 1405, month: 2 }],
    { average: true },
  );

  assert.equal(result.meta.reportCount, 1);
  assert.equal(result.meta.complete, false);
  assert.deepEqual(result.meta.missingMonths, [{ year: 1405, month: 2 }]);
  assert.equal(result.metrics.production, 100);
});

test('growth is null for missing or zero baselines', () => {
  assert.ok(Math.abs(calculateGrowth(120, 100) - 0.2) < Number.EPSILON);
  assert.equal(calculateGrowth(100, 0), null);
  assert.equal(calculateGrowth(null, 100), null);
});

test('all three growth groups are built from their matching periods', () => {
  const reports = [];
  // Execution in Shahrivar 1405 means target Mordad and previous month Tir.
  for (let month = 1; month <= 5; month += 1) {
    reports.push(report(1404, month, {
      production: 100,
      sales: 10,
      revenue: 100,
    }));
    reports.push(report(1405, month, {
      production: 200,
      sales: 20,
      revenue: 200,
    }));
  }
  // Complete prior-year 12-month average input as well.
  for (let month = 6; month <= 12; month += 1) {
    reports.push(report(1404, month));
  }

  const result = buildSymbolPeriodMetrics(reports, { year: 1405, month: 6 });

  assert.equal(result.growth.targetYoY.production, 1);
  assert.equal(result.growth.ytdYoY.production, 1);
  assert.equal(result.growth.previousMonthYoY.production, 1);
  assert.equal(result.periods.priorYearFullYearAverage.meta.complete, true);
});
