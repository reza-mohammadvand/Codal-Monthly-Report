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
    revenueScale: values.revenueScale ?? 1_000_000,
    totals: {
      production: values.production ?? 100,
      sales: values.sales ?? 10,
      revenue: values.revenue ?? 100,
      rate: values.rate ?? 10,
      unit: values.unit ?? 'تن',
      units: values.units ?? [values.unit ?? 'تن'],
      unitsCompatible: values.unitsCompatible ?? true,
    },
    products: values.products ?? [
      {
        name: 'محصول اصلی',
        unit: values.unit ?? 'تن',
        production: values.production ?? 100,
        sales: values.sales ?? 10,
        revenue: values.revenue ?? 100,
        rate: values.rate ?? 10,
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
  assert.equal(result.fiscalYearEndMonth, 12);
  assert.deepEqual(result.currentFiscalYearStart, { year: 1405, month: 1 });
  assert.deepEqual(result.priorFiscalYearStart, { year: 1404, month: 1 });
  assert.equal(result.periods.priorYearYtdAverage.months.length, 5);
  assert.equal(result.periods.priorYearFullYearAverage.months.length, 12);
  assert.equal(result.periods.currentYearYtdAverage.months.length, 5);
  assert.equal(
    result.periods.currentYearYtdAverage.label,
    'میانگین از ابتدای سال مالی تا مرداد 1405',
  );
  assert.equal(result.periods.priorYearFullYearAverage.label, 'میانگین ۱۲ ماهه سال مالی قبل');
  assert.deepEqual(result.growth.targetMoM, {
    key: 'targetMoM',
    label: 'رشد مرداد 1405 نسبت به تیر 1405',
    numerator: 'targetMonth',
    denominator: 'previousMonth',
  });
  assert.deepEqual(result.columnOrder, [
    'priorYearTarget',
    'priorYearYtdAverage',
    'priorYearFullYearAverage',
    'previousMonth',
    'targetMonth',
    'currentYearYtdAverage',
    'targetYoY',
    'ytdYoY',
    'targetMoM',
  ]);
});

test('Farvardin execution correctly targets Esfand of the prior year', () => {
  const result = getReportPeriods({ year: 1405, month: 1 });

  assert.deepEqual(result.targetMonth, { year: 1404, month: 12 });
  assert.deepEqual(result.previousMonth, { year: 1404, month: 11 });
  assert.deepEqual(result.priorYearTargetMonth, { year: 1403, month: 12 });
  assert.equal(result.periods.currentYearYtdAverage.months.length, 12);
  assert.deepEqual(result.periods.currentYearYtdAverage.months[0], {
    year: 1404,
    month: 1,
  });
  assert.deepEqual(result.periods.currentYearYtdAverage.months.at(-1), {
    year: 1404,
    month: 12,
  });
  assert.deepEqual(result.periods.priorYearFullYearAverage.months[0], {
    year: 1403,
    month: 1,
  });
  assert.deepEqual(result.periods.priorYearFullYearAverage.months.at(-1), {
    year: 1403,
    month: 12,
  });
  assert.equal(result.growth.targetMoM.numerator, 'targetMonth');
  assert.equal(result.growth.targetMoM.denominator, 'previousMonth');
});

test('fiscal YTD ranges cross Jalali years when the fiscal year ends in Shahrivar', () => {
  const result = getReportPeriods(
    { year: 1405, month: 6 },
    { fiscalYearEndMonth: 6 },
  );

  assert.equal(result.fiscalYearEndMonth, 6);
  assert.equal(result.fiscalYearStartMonth, 7);
  assert.deepEqual(result.currentFiscalYearStart, { year: 1404, month: 7 });
  assert.deepEqual(result.priorFiscalYearStart, { year: 1403, month: 7 });

  assert.equal(result.periods.currentYearYtdAverage.months.length, 11);
  assert.deepEqual(result.periods.currentYearYtdAverage.months[0], {
    year: 1404,
    month: 7,
  });
  assert.deepEqual(result.periods.currentYearYtdAverage.months.at(-1), {
    year: 1405,
    month: 5,
  });

  assert.equal(result.periods.priorYearYtdAverage.months.length, 11);
  assert.deepEqual(result.periods.priorYearYtdAverage.months[0], {
    year: 1403,
    month: 7,
  });
  assert.deepEqual(result.periods.priorYearYtdAverage.months.at(-1), {
    year: 1404,
    month: 5,
  });

  assert.equal(result.periods.priorYearFullYearAverage.months.length, 12);
  assert.deepEqual(result.periods.priorYearFullYearAverage.months[0], {
    year: 1403,
    month: 7,
  });
  assert.deepEqual(result.periods.priorYearFullYearAverage.months.at(-1), {
    year: 1404,
    month: 6,
  });
});

test('fiscal year end month must be a valid Jalali month', () => {
  assert.throws(
    () => getReportPeriods({ year: 1405, month: 6 }, { fiscalYearEndMonth: 0 }),
    /fiscalYearEndMonth must be between 1 and 12/,
  );
  assert.throws(
    () => getReportPeriods({ year: 1405, month: 6 }, { fiscalYearEndMonth: 6.5 }),
    /fiscalYearEndMonth must be an integer/,
  );
});

test('period aggregation averages totals and derives the weighted sales rate', () => {
  const reports = [
    report(1405, 1, {
      production: 100,
      sales: 10,
      revenue: 200,
      rate: 30,
    }),
    report(1405, 2, {
      production: 300,
      sales: 30,
      revenue: 900,
      rate: 50,
    }),
  ];

  const result = aggregatePeriod(
    reports,
    [{ year: 1405, month: 1 }, { year: 1405, month: 2 }],
    { average: true },
  );

  assert.equal(result.metrics.dominantProductProduction, 200);
  assert.equal(result.metrics.dominantProductSales, 20);
  assert.equal(result.metrics.dominantProductRevenue, 550);
  assert.equal(result.metrics.dominantProductRate, 1_100_000_000 / 40);
  assert.equal(result.meta.complete, true);
});

test('reported company totals take precedence over product-cell sums', () => {
  const result = aggregatePeriod(
    [report(1405, 1, {
      production: 100,
      sales: 80,
      revenue: 900,
      rate: 700,
      products: [
        { name: 'A', unit: 'تن', production: 5, sales: 4, revenue: 50, rate: 10 },
        { name: 'B', unit: 'تن', production: 3, sales: 2, revenue: 30, rate: 20 },
      ],
    })],
    [{ year: 1405, month: 1 }],
  );

  assert.equal(result.metrics.dominantProductProduction, 100);
  assert.equal(result.metrics.dominantProductSales, 80);
  assert.equal(result.metrics.dominantProductRevenue, 900);
  assert.equal(result.metrics.dominantProductRate, 900_000_000 / 80);
});

test('missing totals fall back to all product cells despite unit mismatch', () => {
  const result = aggregatePeriod(
    [{
      year: 1405,
      month: 1,
      totals: { unitsCompatible: false, units: ['تن', 'عدد'] },
      products: [
        { name: 'A', unit: 'تن', production: 12, sales: 10, revenue: 150, rate: 15 },
        { name: 'B', unit: 'عدد', production: 8, sales: 7, revenue: 70, rate: 10 },
      ],
    }],
    [{ year: 1405, month: 1 }],
  );

  assert.equal(result.metrics.dominantProductProduction, 20);
  assert.equal(result.metrics.dominantProductSales, 17);
  assert.equal(result.metrics.dominantProductRevenue, 220);
  assert.equal(result.metrics.dominantProductRate, 220_000_000 / 17);
  assert.equal(result.totals.unitsCompatible, false);
  assert.deepEqual(result.totals.units, ['تن', 'عدد']);
});

test('raw quantities are not converted before summing different unit scales', () => {
  const result = aggregatePeriod(
    [{
      year: 1405,
      month: 1,
      totals: { unitsCompatible: false },
      products: [
        { name: 'A', unit: 'هزار تن', production: 3, sales: 2, revenue: 2_000, rate: 1_000_000 },
        { name: 'B', unit: 'تن', production: 4, sales: 3, revenue: 900, rate: 300_000 },
      ],
    }],
    [{ year: 1405, month: 1 }],
  );

  assert.equal(result.metrics.dominantProductProduction, 7);
  assert.equal(result.metrics.dominantProductSales, 5);
  assert.equal(result.metrics.dominantProductRate, 2_900_000_000 / 5);
  assert.equal(result.totals.unitsCompatible, false);
});

test('a unit change between otherwise compatible monthly reports is flagged', () => {
  const result = aggregatePeriod(
    [
      report(1405, 1, { unit: 'تن', production: 10 }),
      report(1405, 2, { unit: 'عدد', production: 20 }),
    ],
    [{ year: 1405, month: 1 }, { year: 1405, month: 2 }],
    { average: true },
  );

  assert.equal(result.metrics.dominantProductProduction, 15);
  assert.equal(result.totals.unitsCompatible, false);
  assert.deepEqual(result.totals.units, ['تن', 'عدد']);
});

test('zero totals remain valid values', () => {
  const result = aggregatePeriod(
    [
      report(1405, 1, {
        production: 0,
        sales: 22,
        revenue: 0,
        rate: 0,
        products: [
          { name: 'A', unit: 'تن', production: 0, sales: 12, revenue: 0, rate: 0 },
          { name: 'B', unit: 'تن', production: 0, sales: 10, revenue: 0, rate: 0 },
        ],
      }),
    ],
    [{ year: 1405, month: 1 }],
  );

  assert.equal(result.metrics.dominantProductProduction, 0);
  assert.equal(result.metrics.dominantProductSales, 22);
  assert.equal(result.metrics.dominantProductRevenue, 0);
  assert.equal(result.metrics.dominantProductRate, 0);
});

test('incompatible company units do not suppress company totals', () => {
  const result = aggregatePeriod(
    [report(1405, 1, { unitsCompatible: false, revenue: 500 })],
    [{ year: 1405, month: 1 }],
  );

  assert.equal(result.metrics.dominantProductProduction, 100);
  assert.equal(result.metrics.dominantProductSales, 10);
  assert.equal(result.metrics.dominantProductRevenue, 500);
  assert.equal(result.metrics.dominantProductRate, 50_000_000);
  assert.equal(result.totals.unitsCompatible, false);
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
  assert.equal(result.metrics.dominantProductProduction, 100);
});

test('growth is null for missing or zero baselines', () => {
  assert.ok(Math.abs(calculateGrowth(120, 100) - 0.2) < Number.EPSILON);
  assert.equal(calculateGrowth(100, 0), null);
  assert.equal(calculateGrowth(null, 100), null);
});

test('all three growth groups use fiscal YTD and target-month MoM comparisons', () => {
  const reports = [];
  // Prior fiscal YTD: Mehr 1403 through Mordad 1404, all with production 100.
  for (let offset = 0; offset < 11; offset += 1) {
    const month = addJalaliMonths({ year: 1403, month: 7 }, offset);
    reports.push(report(month.year, month.month, {
      production: 100,
      sales: 10,
      revenue: 100,
    }));
  }
  // Finish the previous full fiscal year with Shahrivar 1404.
  reports.push(report(1404, 6, {
    production: 100,
    sales: 10,
    revenue: 100,
  }));

  // Current fiscal YTD: Mehr 1404 through Mordad 1405, normally double.
  for (let offset = 0; offset < 11; offset += 1) {
    const month = addJalaliMonths({ year: 1404, month: 7 }, offset);
    reports.push(report(month.year, month.month, {
      production: 200,
      sales: 20,
      revenue: 200,
    }));
  }
  // Tir is the immediately previous month; make it half of Mordad for MoM.
  reports.push(report(1405, 4, {
    production: 100,
    sales: 10,
    revenue: 100,
  }));

  const result = buildSymbolPeriodMetrics(
    reports,
    { year: 1405, month: 6 },
    { fiscalYearEndMonth: 6 },
  );

  assert.equal(result.growth.targetYoY.dominantProductProduction, 1);
  assert.ok(Math.abs(result.growth.ytdYoY.dominantProductProduction - (10 / 11)) < Number.EPSILON);
  assert.equal(result.growth.targetMoM.dominantProductProduction, 1);
  assert.equal(result.periods.priorYearFullYearAverage.meta.complete, true);
  assert.equal(result.periods.currentYearYtdAverage.meta.reportCount, 11);
  assert.equal(result.comparisonPeriods, undefined);
});
