import test from 'node:test';
import assert from 'node:assert/strict';

import ExcelJS from 'exceljs';

import { createReportWorkbook } from '../src/excel.js';

function period(multiplier, { dominantRate = 2_000_000 } = {}) {
  return {
    metrics: {
      totalProduction: 10 * multiplier,
      totalSales: 8 * multiplier,
      totalRevenue: 16 * multiplier,
      dominantSales: 5 * multiplier,
      dominantRate,
      weightedRate: 2_000_000,
    },
    unit: 'تن',
    dominantProductName: 'محصول الف',
    dominantProductUnit: 'تن',
    complete: true,
    reportCount: 1,
    requestedMonthCount: 1,
  };
}

test('Excel report serializes with a compact layout and auditable growth formulas', async () => {
  const longIndustryName = 'محصولات غذایی و آشامیدنی به جز قند و شکر';
  const workbook = createReportWorkbook({
    industryGroups: [{
      industryName: longIndustryName,
      companies: [{
        symbol: 'نماد',
        name: 'شرکت آزمایشی',
        status: 'کامل',
        periods: {
          priorTarget: period(1),
          priorYtd: period(2),
          priorAnnual: period(3),
          previous: period(4),
          target: period(2, { dominantRate: null }),
          currentYtd: period(4),
        },
        comparisonPeriods: { previousMonthPriorYear: period(2) },
      }],
    }],
    metadata: {
      generatedAt: '2026-08-29T08:00:00.000Z',
      periodLabels: {
        priorTarget: 'مرداد 1404',
        priorYtd: 'میانگین تا مرداد 1404',
        priorAnnual: 'میانگین 12 ماهه 1404',
        previous: 'تیر 1405',
        target: 'مرداد 1405',
        currentYtd: 'میانگین تا مرداد 1405',
      },
    },
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer);

  assert.deepEqual(reopened.worksheets.map((sheet) => sheet.name), [
    'راهنما',
    longIndustryName.slice(0, 31).trim(),
    'ممیزی منابع',
  ]);

  const coverSheet = reopened.getWorksheet('راهنما');
  const detailedGuideRows = [
    ...Array.from({ length: 8 }, (_, index) => 7 + index),
    ...Array.from({ length: 7 }, (_, index) => 16 + index),
  ];
  for (const rowNumber of detailedGuideRows) {
    assert.equal(
      coverSheet.getRow(rowNumber).hidden,
      true,
      `guide detail row ${rowNumber} should be hidden`,
    );
  }
  assert.equal(reopened.getWorksheet('ممیزی منابع').state, 'hidden');

  const sheet = reopened.worksheets[1];
  assert.equal(sheet.views[0].rightToLeft, true);
  assert.equal(sheet.views[0].xSplit, 3);
  assert.equal(sheet.rowCount, 10);
  assert.equal(sheet.getColumn(15).hidden, true);
  assert.ok(!sheet.autoFilter);
  assert.ok(sheet.model.merges.includes('A5:A10'));
  assert.ok(sheet.model.merges.includes('B5:B10'));
  assert.ok(sheet.model.merges.includes('E8:E9'));
  assert.equal(sheet.getCell('A5').value, 'نماد');
  assert.equal(sheet.getCell('A10').master.address, 'A5');
  assert.equal(sheet.getCell('B10').master.address, 'B5');
  assert.equal(sheet.getCell('E8').value, 'محصول الف');
  assert.equal(sheet.getCell('E9').master.address, 'E8');
  assert.equal(sheet.getCell('C10').value, 'نرخ فروش موزون کل');
  assert.equal(sheet.getCell('L5').value.formula, 'IF(OR(F5="",F5=0,J5=""),"",J5/F5-1)');
  assert.equal(sheet.getCell('M5').value.formula, 'IF(OR(G5="",G5=0,K5=""),"",K5/G5-1)');
  assert.equal(sheet.getCell('N5').value.formula, 'IF(OR(O5="",O5=0,I5=""),"",I5/O5-1)');
  assert.equal(sheet.getCell('O5').value, 20);
  assert.equal(sheet.getCell('L9').value, null);
});
