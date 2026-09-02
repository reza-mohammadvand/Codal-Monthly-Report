import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CodalClient,
  PRODUCTION_REPORTING_TYPE,
  extractCodalDatasource,
  extractReportPeriod,
  normalizeFinancialYears,
  parseCodalNumber,
  parseHtmlTables,
  parseProductionSalesReport,
  resolveFiscalYearEndMonth,
  selectLatestCorrectionPerMonth,
  selectLatestReportForMonth,
} from '../src/codal.js';

const productionSalesHtml = `
<html><body>
  <div class="table-title">تولید و فروش</div>
  <div class="table-description">کلیه مبالغ به میلیون ریال است</div>
  <table class="rayanDynamicStatement">
    <thead>
      <tr>
        <th colspan="2">شرح</th>
        <th colspan="4">دوره یک ماهه منتهی به ۱۴۰۵/۰۵/۳۱</th>
        <th colspan="4">از ابتدای سال مالی تا تاریخ ۱۴۰۵/۰۵/۳۱</th>
        <th colspan="4">از ابتدای سال مالی تا تاریخ ۱۴۰۴/۰۵/۳۱</th>
      </tr>
      <tr>
        <th>نام محصول</th><th>واحد</th>
        <th>تعداد تولید</th><th>تعداد فروش</th><th>نرخ فروش (ریال)</th><th>مبلغ فروش (میلیون ریال)</th>
        <th>تعداد تولید</th><th>تعداد فروش</th><th>نرخ فروش (ریال)</th><th>مبلغ فروش (میلیون ریال)</th>
        <th>تعداد تولید</th><th>تعداد فروش</th><th>نرخ فروش (ریال)</th><th>مبلغ فروش (میلیون ریال)</th>
      </tr>
    </thead>
    <tbody>
      <tr><td>فروش داخلی:</td><td></td>${'<td></td>'.repeat(12)}</tr>
      <tr><td>محصول الف</td><td>تن</td><td>۱۰</td><td>۱۲</td><td>۱۰,۰۰۰,۰۰۰</td><td>۱۲۰</td><td>۵۰</td><td>۶۰</td><td>۱۰,۰۰۰,۰۰۰</td><td>۶۰۰</td><td>۴۰</td><td>۵۰</td><td>۸,۰۰۰,۰۰۰</td><td>۴۰۰</td></tr>
      <tr><td>محصول ب</td><td>تن</td><td>۸</td><td>۱۰</td><td>۲۰,۰۰۰,۰۰۰</td><td>۲۰۰</td><td>۳۰</td><td>۳۵</td><td>۲۰,۰۰۰,۰۰۰</td><td>۷۰۰</td><td>۲۵</td><td>۳۰</td><td>۱۵,۰۰۰,۰۰۰</td><td>۴۵۰</td></tr>
      <tr><td>فروش صادراتی:</td><td></td>${'<td></td>'.repeat(12)}</tr>
      <tr><td>محصول الف</td><td>تن</td><td>۵</td><td>۸</td><td>۱۲,۵۰۰,۰۰۰</td><td>۱۰۰</td><td>۲۰</td><td>۲۵</td><td>۱۲,۰۰۰,۰۰۰</td><td>۳۰۰</td><td>۱۰</td><td>۲۰</td><td>۱۰,۰۰۰,۰۰۰</td><td>۲۰۰</td></tr>
      <tr><td>جمع فروش صادراتی</td><td>تن</td><td>۵</td><td>۸</td><td>۱۲,۵۰۰,۰۰۰</td><td>۱۰۰</td>${'<td>۰</td>'.repeat(8)}</tr>
      <tr><td>محصول ناسازگار</td><td>عدد</td><td>۲</td><td>۲</td><td>۵,۰۰۰,۰۰۰</td><td>۱۰</td><td>۳</td><td>۳</td><td>۵,۰۰۰,۰۰۰</td><td>۱۵</td><td>۱</td><td>۱</td><td>۵,۰۰۰,۰۰۰</td><td>۵</td></tr>
    </tbody>
  </table>
</body></html>`;

test('Persian numbers and negative parentheses are parsed', () => {
  assert.equal(parseCodalNumber('۱,۲۳۴٫۵'), 1234.5);
  assert.equal(parseCodalNumber('(۲۵۰)'), -250);
  assert.equal(parseCodalNumber('—'), null);
  assert.equal(parseCodalNumber('متن'), null);
});

test('Excel HTML tables expand colspan and preserve rectangular body rows', () => {
  const [table] = parseHtmlTables(productionSalesHtml);
  assert.equal(table.headerRows[0][2], 'دوره یک ماهه منتهی به 1405/05/31');
  assert.equal(table.headerRows[0][5], 'دوره یک ماهه منتهی به 1405/05/31');
  assert.equal(table.headerRows[1][2], 'تعداد تولید');
  assert.equal(table.rows[1].length, 14);
});

test('production parser detects monthly/YTD periods and aggregates repeated products', () => {
  const parsed = parseProductionSalesReport(productionSalesHtml);
  assert.equal(parsed.tableFound, true);
  assert.equal(parsed.monthly.date.value, '1405/05/31');
  assert.equal(parsed.cumulativeCurrent.date.value, '1405/05/31');
  assert.equal(parsed.cumulativePriorYear.date.value, '1404/05/31');

  // Product A wins only after domestic + export sections are combined (120 + 100 > 200).
  assert.equal(parsed.monthly.dominantProduct.name, 'محصول الف');
  assert.equal(parsed.monthly.dominantProduct.salesQuantity, 20);
  assert.equal(parsed.monthly.dominantProduct.sales, 20);
  assert.equal(parsed.monthly.dominantProduct.revenue, 220);
  assert.equal(parsed.monthly.dominantProduct.rate, 11_000_000);
  assert.deepEqual(parsed.monthly.dominantProduct.sections, ['domestic', 'export']);

  // Mixed "تن" and "عدد" must not be summed into a meaningless company quantity/rate.
  assert.equal(parsed.monthly.totals.revenue, 430);
  assert.equal(parsed.monthly.totals.production, null);
  assert.equal(parsed.monthly.totals.salesQuantity, null);
  assert.equal(parsed.monthly.totals.sales, null);
  assert.equal(parsed.monthly.totals.weightedRate, null);
  assert.equal(parsed.monthly.totals.compatibleUnits, false);
  assert.equal(parsed.monthly.totals.unitsCompatible, false);
  assert.match(parsed.warnings.join(' '), /units differ/);
});

test('production parser recovers tables from Codal embedded datasource pages', async () => {
  const sourceTable = parseHtmlTables(productionSalesHtml)[0];
  const cells = [
    ...sourceTable.headerRows.flatMap((row, rowIndex) => row.map((value, columnIndex) => ({
      rowSequence: rowIndex + 1,
      columnSequence: columnIndex + 1,
      rowSpan: 1,
      colSpan: 1,
      cellGroupName: 'Header',
      isVisible: true,
      value,
    }))),
    ...sourceTable.rows.flatMap((row, rowIndex) => row.map((value, columnIndex) => ({
      rowSequence: rowIndex + sourceTable.headerRows.length + 1,
      columnSequence: columnIndex + 1,
      rowSpan: 1,
      colSpan: 1,
      cellGroupName: 'Body',
      isVisible: true,
      value,
    }))),
  ];
  const datasource = {
    yearEndToDate: '1405/12/29',
    sheets: [{
      tables: [{
        title_Fa: 'تولید و فروش',
        description: 'کلیه مبالغ به میلیون ریال است',
        aliasName: 'ProductionAndSales',
        cells,
      }],
    }],
  };
  const embeddedHtml = `<script>var datasource = ${JSON.stringify(datasource)};</script>`;

  assert.equal(extractCodalDatasource(embeddedHtml).yearEndToDate, '1405/12/29');
  const parsed = parseProductionSalesReport(embeddedHtml);
  assert.equal(parsed.tableFound, true);
  assert.equal(parsed.monthly.date.value, '1405/05/31');
  assert.equal(parsed.monthly.dominantProduct.name, 'محصول الف');

  const requests = [];
  const client = new CodalClient({
    fetchText: async (url) => {
      requests.push(url);
      return url.includes('excel.codal.ir') ? '<html>گزارش فعالیت ماهانه</html>' : embeddedHtml;
    },
  });
  const recovered = await client.fetchAndParseReport({
    ExcelUrl: 'https://excel.codal.ir/empty',
    Url: '/Reports/Decision.aspx?id=1',
  });
  assert.equal(recovered.monthly.date.value, '1405/05/31');
  assert.deepEqual(requests, [
    'https://excel.codal.ir/empty',
    'https://www.codal.ir/Reports/Decision.aspx?id=1',
  ]);
});

test('weighted total rate is calculated when all units are compatible', () => {
  const compatibleHtml = productionSalesHtml.replace(
    /<tr><td>محصول ناسازگار[\s\S]*?<\/tr>/,
    '',
  ).replace('<td>محصول ب</td><td>تن</td>', '<td>محصول ب</td><td> تـن </td>');
  const monthly = parseProductionSalesReport(compatibleHtml).monthly;
  assert.equal(monthly.totals.production, 23);
  assert.equal(monthly.totals.salesQuantity, 30);
  assert.equal(monthly.totals.revenue, 420);
  assert.equal(monthly.totals.weightedRate, (420 * 1_000_000) / 30);
});

test('all-zero product revenue leaves the dominant product undefined', () => {
  const zeroRevenueHtml = `
  <html><body>
    <div>تولید و فروش - کلیه مبالغ به میلیون ریال است</div>
    <table>
      <thead>
        <tr><th colspan="2">شرح</th><th colspan="4">دوره یک ماهه منتهی به ۱۴۰۴/۰۱/۳۱</th></tr>
        <tr>
          <th>نام محصول</th><th>واحد</th><th>تعداد تولید</th><th>تعداد فروش</th>
          <th>نرخ فروش (ریال)</th><th>مبلغ فروش (میلیون ریال)</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>فروش داخلی:</td><td></td><td></td><td></td><td></td><td></td></tr>
        <tr><td>محصول الف</td><td>تن</td><td>۱۰</td><td>۱۲</td><td>۰</td><td>۰</td></tr>
        <tr><td>محصول ب</td><td>تن</td><td>۸</td><td>۱۰</td><td>۰</td><td>۰</td></tr>
        <tr><td>جمع</td><td>تن</td><td>۱۸</td><td>۲۲</td><td>۰</td><td>۰</td></tr>
      </tbody>
    </table>
  </body></html>`;

  const monthly = parseProductionSalesReport(zeroRevenueHtml).monthly;
  assert.equal(monthly.totals.production, 18);
  assert.equal(monthly.totals.salesQuantity, 22);
  assert.equal(monthly.totals.revenue, 0);
  assert.equal(monthly.totals.weightedRate, 0);
  assert.equal(monthly.dominantProduct, null);
});

test('returns and discounts affect net totals but cannot become the dominant product', () => {
  const adjustmentHtml = `
  <html><body>
    <div>تولید و فروش - کلیه مبالغ به میلیون ریال است</div>
    <table>
      <thead>
        <tr><th colspan="2">شرح</th><th colspan="4">دوره یک ماهه منتهی به ۱۴۰۵/۰۵/۳۱</th></tr>
        <tr>
          <th>نام محصول</th><th>واحد</th><th>تعداد تولید</th><th>تعداد فروش</th>
          <th>نرخ فروش (ریال)</th><th>مبلغ فروش (میلیون ریال)</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>فروش داخلی:</td><td></td><td></td><td></td><td></td><td></td></tr>
        <tr><td>محصول الف</td><td>هزارتن</td><td>۱۰</td><td>۱۰</td><td>۱۰,۰۰۰,۰۰۰</td><td>۱۰۰</td></tr>
        <tr><td>محصول ب</td><td>هزار تن</td><td>۸</td><td>۵</td><td>۱۶,۰۰۰,۰۰۰</td><td>۸۰</td></tr>
        <tr><td>برگشت از فروش:</td><td></td><td></td><td></td><td></td><td></td></tr>
        <tr><td>محصول الف</td><td>هزار‌تن</td><td>۰</td><td>(۱)</td><td>۱۰,۰۰۰,۰۰۰</td><td>(۱۰)</td></tr>
        <tr><td>تخفیفات</td><td></td><td></td><td></td><td></td><td>(۵)</td></tr>
        <tr><td>جمع</td><td>هزار تن</td><td>۱۸</td><td>۱۴</td><td></td><td>۱۶۴</td></tr>
      </tbody>
    </table>
  </body></html>`;

  const monthly = parseProductionSalesReport(adjustmentHtml).monthly;
  assert.equal(monthly.dominantProduct.name, 'محصول الف');
  assert.equal(monthly.dominantProduct.salesQuantity, 9);
  assert.equal(monthly.dominantProduct.revenue, 90);
  assert.equal(monthly.dominantProduct.rate, 10_000_000);
  assert.deepEqual(monthly.dominantProduct.sections, ['domestic', 'returns']);
  assert.equal(monthly.products.some((product) => /تخفیف/.test(product.name)), false);
  assert.equal(monthly.adjustments.length, 1);
  assert.equal(monthly.adjustments[0].section, 'discounts');
  assert.equal(monthly.totals.unit, 'هزار تن');
  assert.equal(monthly.totals.production, 18);
  assert.equal(monthly.totals.salesQuantity, 14);
  assert.equal(monthly.calculatedRevenue, 165);
  assert.equal(monthly.reportedTotals.revenue, 164);
  assert.equal(monthly.totals.revenue, 164);
  assert.equal(monthly.totals.weightedRate, (164 * 1_000_000) / 14);
});

test('latest correction is selected for each symbol and Jalali month', () => {
  const reports = [
    { Symbol: 'فولاد', Title: 'گزارش فعالیت ماهانه منتهی به ۱۴۰۴/۰۹/۳۰', PublishDateTime: '۱۴۰۴/۱۰/۰۷ ۱۰:۰۰:۰۰', TracingNo: 1 },
    { Symbol: 'فولاد', Title: 'گزارش فعالیت ماهانه منتهی به ۱۴۰۴/۰۹/۳۰ (اصلاحیه)', PublishDateTime: '۱۴۰۴/۱۰/۳۰ ۱۰:۰۰:۰۰', TracingNo: 2 },
    { Symbol: 'فولاد', Title: 'گزارش فعالیت ماهانه منتهی به ۱۴۰۴/۱۰/۳۰', PublishDateTime: '۱۴۰۴/۱۱/۰۶ ۱۰:۰۰:۰۰', TracingNo: 3 },
    { Symbol: 'فملی', Title: 'گزارش فعالیت ماهانه منتهی به ۱۴۰۴/۰۹/۳۰', PublishDateTime: '۱۴۰۴/۱۰/۰۸ ۱۰:۰۰:۰۰', TracingNo: 4 },
  ];
  const selected = selectLatestCorrectionPerMonth(reports);
  assert.equal(selected.length, 3);
  assert.equal(selectLatestReportForMonth(reports, 1404, 9, 'فولاد').TracingNo, 2);
  assert.deepEqual(extractReportPeriod(reports[0]), {
    year: 1404, month: 9, day: 30, key: '1404/09', value: '1404/09/30',
  });
});

test('financial-year dates are normalized and the latest fiscal end month is resolved', () => {
  const values = [
    '۱۴۰۳/۱۲/۲۹',
    ' 1404-06-31 ',
    '١٤٠٢/٠٩/٣٠',
    '1404/06/31',
    '1404/07/31',
    'not-a-date',
    null,
  ];

  assert.deepEqual(normalizeFinancialYears(values), [
    '1403/12/29',
    '1404/06/31',
    '1402/09/30',
  ]);
  assert.equal(resolveFiscalYearEndMonth(values), 6);
  assert.equal(resolveFiscalYearEndMonth(['invalid']), null);
  assert.throws(() => normalizeFinancialYears({}), /must be an array/);
});

test('CodalClient fetches URL-encoded financial years through an injected transport', async () => {
  const requested = [];
  const client = new CodalClient({
    searchBaseUrl: 'https://search.codal.ir/',
    fetchJson: async (url) => {
      requested.push(url);
      return ['۱۴۰۴/۱۲/۲۹', '1403-12-29', 'invalid'];
    },
    retries: 0,
  });

  assert.deepEqual(await client.fetchFinancialYears('فولاد & شرکت'), [
    '1404/12/29',
    '1403/12/29',
  ]);
  assert.equal(requested.length, 1);
  assert.equal(new URL(requested[0]).pathname, '/api/search/v1/financialYears');
  assert.equal(new URL(requested[0]).searchParams.get('Symbol'), 'فولاد & شرکت');
  assert.equal(requested[0].includes('فولاد'), false);
  await assert.rejects(() => client.fetchFinancialYears('  '), /symbol is required/i);
});

test('CodalClient supports injected transports, production filtering and pagination', async () => {
  const requested = [];
  const client = new CodalClient({
    fetchJson: async (url) => {
      requested.push(url);
      if (url.endsWith('/companies')) {
        return [{ sy: 'فولاد', RT: PRODUCTION_REPORTING_TYPE }, { sy: 'وبملت', RT: 1_000_001 }];
      }
      if (url.endsWith('/IndustryGroup')) return [{ Id: 27, Name: 'فلزات اساسی' }];
      const page = new URL(url).searchParams.get('PageNumber');
      return { Letters: [{ TracingNo: Number(page) }], Total: 2, Page: 2 };
    },
    retries: 0,
  });

  assert.deepEqual((await client.fetchProductionCompanies()).map((company) => company.sy), ['فولاد']);
  assert.equal((await client.fetchIndustries())[0].Id, 27);
  const letters = await client.searchMonthlyReports({ symbol: 'فولاد', fromDate: '1404/01/01' });
  assert.deepEqual(letters.map((letter) => letter.TracingNo), [1, 2]);
  const query = new URL(requested.find((url) => url.includes('/api/search/v2/q?'))).searchParams;
  assert.equal(query.get('Symbol'), 'فولاد');
  assert.equal(query.get('LetterType'), '58');
  assert.equal(query.get('Category'), '3');
});
