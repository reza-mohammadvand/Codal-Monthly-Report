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
        production: values.production ?? 100,
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

test('period aggregation averages the dominant basket and weights its rate by sales', () => {
  const reports = [
    report(1405, 1, {
      production: 100,
      sales: 10,
      revenue: 200,
      products: [
        { name: 'A', unit: 'تن', production: 8, sales: 5, revenue: 100 },
        { name: 'B', unit: 'تن', production: 12, sales: 10, revenue: 100 },
      ],
    }),
    report(1405, 2, {
      production: 300,
      sales: 30,
      revenue: 900,
      products: [
        { name: 'A', unit: 'تن', production: 16, sales: 10, revenue: 500 },
        { name: 'B', unit: 'تن', production: 24, sales: 20, revenue: 400 },
      ],
    }),
  ];

  const result = aggregatePeriod(
    reports,
    [{ year: 1405, month: 1 }, { year: 1405, month: 2 }],
    { average: true },
  );

  assert.equal(result.dominantProduct.name, 'A');
  assert.equal(result.metrics.dominantProductProduction, 12);
  assert.equal(result.metrics.dominantProductSales, 7.5);
  assert.equal(result.metrics.dominantProductRevenue, 300);
  assert.equal(result.metrics.dominantProductRate, 40_000_000);
  assert.ok(result.dominantProduct.revenueShare > 0.5);
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
  assert.equal(result.dominantProduct.name, 'A، B');
  assert.deepEqual(result.dominantProduct.names, ['A', 'B']);
  assert.equal(result.dominantProduct.periodRevenueTotal, 280);
  assert.ok(result.dominantProduct.revenueShare > 0.5);
});

test('dominant basket keeps adding revenue-ranked products until it strictly exceeds 50 percent', () => {
  const result = aggregatePeriod(
    [report(1405, 1, {
      products: [
        { name: 'A', unit: 'تن', production: 5, sales: 5, revenue: 50 },
        { name: 'B', unit: 'تن', production: 3, sales: 3, revenue: 30 },
        { name: 'C', unit: 'تن', production: 2, sales: 2, revenue: 20 },
      ],
    })],
    [{ year: 1405, month: 1 }],
  );

  assert.deepEqual(result.dominantProduct.names, ['A', 'B']);
  assert.equal(result.dominantProduct.revenueShare, 0.8);
  assert.equal(result.metrics.dominantProductProduction, 8);
  assert.equal(result.metrics.dominantProductSales, 8);
  assert.equal(result.metrics.dominantProductRevenue, 80);
  assert.equal(result.metrics.dominantProductRate, 10_000_000);
});

test('a company with one sale product uses that product as its dominant basket', () => {
  const result = aggregatePeriod(
    [report(1405, 1, {
      products: [{ name: 'Only', unit: 'تن', production: 12, sales: 10, revenue: 150 }],
    })],
    [{ year: 1405, month: 1 }],
  );

  assert.deepEqual(result.dominantProduct.names, ['Only']);
  assert.equal(result.dominantProduct.revenueShare, 1);
});

test('dominant basket rate converts prefixed quantity units to their base unit', () => {
  const result = aggregatePeriod(
    [report(1405, 1, {
      unit: 'هزار تن',
      products: [{ name: 'A', unit: 'هزار تن', production: 3, sales: 2, revenue: 2_000 }],
    })],
    [{ year: 1405, month: 1 }],
  );

  assert.equal(result.metrics.dominantProductRate, 1_000_000);
  assert.equal(result.dominantProduct.unit, 'هزار تن');
  assert.equal(result.dominantProduct.rateUnit, 'تن');
});

test('period dominant metrics are null when every product has zero revenue', () => {
  const result = aggregatePeriod(
    [
      report(1405, 1, {
        sales: 22,
        revenue: 0,
        products: [
          { name: 'A', unit: 'تن', sales: 12, revenue: 0 },
          { name: 'B', unit: 'تن', sales: 10, revenue: 0 },
        ],
      }),
    ],
    [{ year: 1405, month: 1 }],
  );

  assert.equal(result.dominantProduct, null);
  assert.equal(result.metrics.dominantProductProduction, null);
  assert.equal(result.metrics.dominantProductSales, null);
  assert.equal(result.metrics.dominantProductRevenue, null);
  assert.equal(result.metrics.dominantProductRate, null);
});

test('incompatible company totals do not suppress a compatible dominant basket', () => {
  const result = aggregatePeriod(
    [report(1405, 1, { unitsCompatible: false, revenue: 500 })],
    [{ year: 1405, month: 1 }],
  );

  assert.equal(result.dominantProduct.name, 'محصول اصلی');
  assert.equal(result.metrics.dominantProductProduction, 100);
  assert.equal(result.metrics.dominantProductSales, 10);
  assert.equal(result.metrics.dominantProductRevenue, 500);
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
