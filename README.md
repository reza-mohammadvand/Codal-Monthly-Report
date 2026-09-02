# Codal Monthly Manufacturing Report

Generate a multi-sheet Excel workbook from the public monthly activity reports
published on [Codal](https://www.codal.ir/). The project covers manufacturing
companies listed on the Tehran Stock Exchange and Iran Fara Bourse, groups them
by industry, and creates a six-row analytical block for every symbol.

## Features

- Fetches data directly from Codal's public APIs; no account is required.
- Resolves each company's fiscal-year end from Codal and builds company-specific
  fiscal reporting windows.
- Runs a focused four-symbol pilot (`فولاد`, `فملی`, `شپنا`, and `کگل`) by default.
- Includes a dark, right-to-left web dashboard backed by a persistent SQLite
  database, with industry and symbol selection controls.
- Performs a full extraction when the database is empty. Later updates always
  refresh the Codal filing index but download and parse only new monthly filings
  or corrections; unchanged monthly data is reused from SQLite.
- Processes companies sequentially and pauses for 10 seconds after each company
  by default to respect Codal's rate limits.
- Checkpoints each completed or changed company in SQLite immediately.
- Exports only the selected symbols to the same multi-sheet Excel format used
  by the command-line report.
- Includes only manufacturing issuers (`RT=1000000`) with TSE or IFB status
  (`st=0` or `st=1`).
- Automatically prefers the latest disclosure or correction for each month,
  but falls back to an earlier valid filing if the newest attachment is broken.
- Creates one right-to-left worksheet per industry.
- Adds a guide sheet and a source-audit sheet with report links and tracing IDs.
- Caches downloads locally so interrupted runs can resume without downloading
  every report again.
- Uses Excel formulas for all three growth columns.

## Reporting Periods

The report month is always shifted back by one month from the execution month.
For example, when the program runs in Shahrivar 1405, Mordad 1405 becomes the
target month and Tir 1405 becomes the previous month.

Using that example, the workbook contains these nine analytical columns:

1. Mordad 1404
2. Average from the start of the company's prior fiscal year through Mordad 1404
3. Monthly average for the company's previous complete fiscal year
4. Tir 1405
5. Mordad 1405
6. Average from the start of the company's current fiscal year through Mordad 1405
7. Mordad 1405 growth versus Mordad 1404
8. Current fiscal-year-to-date average growth versus the comparable prior
   fiscal-year period
9. Mordad 1405 growth versus Tir 1405

Fiscal windows are resolved separately for every symbol. For example, if a
company's fiscal year ends in Shahrivar, its Mordad 1405 fiscal-year-to-date
average covers Mehr 1404 through Mordad 1405. A company whose fiscal year ends
in Esfand uses Farvardin 1405 through Mordad 1405 instead.

The current Jalali date is detected in the `Asia/Tehran` time zone. You can also
provide an explicit Jalali execution date with `--as-of`.

## Metrics

Each company is represented by six rows:

1. Total production quantity
2. Total sales quantity
3. Total sales revenue in million rials
4. Sales quantity of the dominant product
5. Sales rate of the dominant product
6. Company-wide weighted sales rate

The dominant product is the product with the highest total revenue over the
selected period. The company-wide weighted rate is calculated as total sales
revenue in rials divided by total sales quantity; it is not a simple average of
the individual product rates.

## Requirements

- Node.js 22 or newer
- Internet access to Codal on the first run
- Microsoft Excel is optional and is only needed to open the generated workbook

## Installation

```powershell
git clone https://github.com/reza-mohammadvand/Codal-Monthly-Report.git
cd Codal-Monthly-Report
npm install
```

## Web Dashboard

Start the local website:

```powershell
npm run web
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173). On a new installation,
use **Update all** once to populate the database. The page thereafter reads the
latest stored data from `data/monthly-reports.sqlite`; it does not fetch from
Codal during normal page loads.

The right sidebar groups companies by industry. Industry and company checkboxes
control both **Update selected** and **Excel export**. **Update all** refreshes
the complete active manufacturing-company catalog returned by Codal (currently
408 issuers), while **Update selected** changes only the chosen database records.
Progress is shown while the full run is active, and each finished company is
saved immediately so a later failure cannot discard earlier results.
The initial run downloads the complete required history. Subsequent runs compare
Codal tracing numbers with the raw monthly records stored in SQLite and update
only companies with a new filing or correction. A technical failure during an
incremental check never replaces an already valid stored report.

For an initial full database load from the terminal, use:

```powershell
npm run bulk-update
```

The command output is English-only and reports complete, partial, no-data,
read-error, and processing-error counts independently.

The safe pacing defaults are one company at a time, a 1-second interval between
Codal search requests, and a 10-second pause after each company. The company
pause can be changed when needed:

```powershell
npm run bulk-update -- --company-delay=20000
```

`کگل` is included specifically as a fiscal-calendar test case. Its fiscal year
ends on Azar 30, so its fiscal-year-to-date and prior-period averages use
company-specific windows rather than Farvardin-to-target-month windows.

## Command-Line Usage

Run the default four-symbol pilot using the current date:

```powershell
npm start
```

Run the same pilot with an explicit output filename under `outputs/`:

```powershell
npm run sample
```

Run the report for every eligible manufacturing company:

```powershell
npm start -- --all-symbols
```

Run a limited report for selected symbols and a fixed Jalali execution date:

```powershell
npm start -- --symbols=فولاد,فملی,شپنا,کگل --as-of=1405/06/09 --output=outputs/pilot-fixed-date.xlsx
```

Display all command-line options:

```powershell
npm start -- --help
```

### Command-Line Options

| Option | Description |
| --- | --- |
| `--as-of=YYYY/MM/DD` | Jalali execution date. The target report month is one month earlier. |
| `--symbols=SYM1,SYM2` | Replace the default pilot list with specific Codal symbols. |
| `--all-symbols` | Process every eligible active manufacturing issuer instead of the pilot. |
| `--limit=10` | Limit the number of companies for testing. |
| `--output=PATH` | Set the destination `.xlsx` path. |
| `--cache-dir=PATH` | Set the download cache directory. Default: `.cache/codal`. |
| `--concurrency=2` | Set the number of concurrent company workers. |
| `--delay=500` | Set the minimum delay between request starts in milliseconds. |
| `--allow-partial` | Calculate averages from available months when a period is incomplete. |
| `--refresh` | Ignore cached responses and download the data again. |
| `--help` | Show the CLI help text. |

If no output path is provided, the workbook is saved under `outputs/` with the
target Jalali year and month in its filename.

## Workbook Structure

- **Guide:** a compact report summary and industry index; detailed guidance is
  retained in hidden rows and can be expanded when needed.
- **Industry sheets:** one worksheet per industry, with six rows per company,
  compact frozen headers, merged company labels, number formatting, and subtle
  growth font colors.
- **Source audit:** every selected Codal report, correction status, publication
  date, tracing number, source URL, and processing status. The sheet is hidden
  by default and can be unhidden in Excel for investigation.

## Data Quality Rules

- Product quantities are aggregated only when their units are compatible.
  Otherwise, total production, total sales quantity, and the company-wide
  weighted rate are reported as unavailable while revenue and dominant-product
  metrics remain available.
- Incomplete multi-month averages are blank by default. Use `--allow-partial`
  only when calculating from the available months is acceptable.
- If Codal's fiscal-year endpoint is empty, the program recovers the year-end
  from a recent monthly filing. A symbol with no fiscal calendar and no monthly
  filings is classified as no data; the program never silently assumes Esfand.
- If an Excel attachment is empty or malformed, the parser also reads the
  structured data embedded in the main Codal disclosure page.
- Growth is unavailable when either value is missing or the comparison value is
  zero.
- Sales returns and discounts are included in company net revenue but cannot be
  selected as the dominant product.
- The final Codal total row is treated as the authoritative company sales
  revenue.
- Downloaded responses are stored in `.cache/codal`; generated workbooks are
  stored in `outputs/`. Both directories are excluded from Git.
- No username or password is stored by this project, and the legacy workbook in
  the local project folder is never read or overwritten.

## Tests

Run the automated test suite:

```powershell
npm test
```

The tests cover Jalali month arithmetic, shifted and company-specific fiscal
periods, Codal fiscal-year lookup, HTML table parsing, corrections, sales
returns and discounts, incompatible units, dominant-product selection,
weighted rates, missing data, month-over-month and year-over-year growth, Excel
serialization, SQLite persistence, selective refresh/export behavior, and the
web HTTP routes.

## Data Source

All financial disclosure data comes from the public
[Codal disclosure system](https://www.codal.ir/).
