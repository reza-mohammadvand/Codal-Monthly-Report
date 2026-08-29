# Codal Monthly Manufacturing Report

Generate a multi-sheet Excel workbook from the public monthly activity reports
published on [Codal](https://www.codal.ir/). The project covers manufacturing
companies listed on the Tehran Stock Exchange and Iran Fara Bourse, groups them
by industry, and creates a six-row analytical block for every symbol.

## Features

- Fetches data directly from Codal's public APIs; no account is required.
- Includes only manufacturing issuers (`RT=1000000`) with TSE or IFB status
  (`st=0` or `st=1`).
- Automatically selects the latest disclosure or correction for each month.
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
2. Average from Farvardin through Mordad 1404
3. Full-year monthly average for 1404
4. Tir 1405
5. Mordad 1405
6. Average from Farvardin through Mordad 1405
7. Mordad 1405 growth versus Mordad 1404
8. Current-year-to-date average growth versus the comparable 1404 average
9. Tir 1405 growth versus Tir 1404

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

## Usage

Run the report for every eligible manufacturing company using the current date:

```powershell
npm start
```

Run the built-in single-symbol sample:

```powershell
npm run sample
```

Run a limited report for selected symbols and a fixed Jalali execution date:

```powershell
npm start -- --symbols=فولاد,فملی,غپاک --as-of=1405/06/07 --output=outputs/sample-multi.xlsx
```

Display all command-line options:

```powershell
npm start -- --help
```

### Command-Line Options

| Option | Description |
| --- | --- |
| `--as-of=YYYY/MM/DD` | Jalali execution date. The target report month is one month earlier. |
| `--symbols=SYM1,SYM2` | Restrict the run to specific Codal symbols. |
| `--limit=10` | Limit the number of companies for testing. |
| `--output=PATH` | Set the destination `.xlsx` path. |
| `--cache-dir=PATH` | Set the download cache directory. Default: `.cache/codal`. |
| `--concurrency=3` | Set the number of concurrent company workers. |
| `--delay=350` | Set the minimum delay between request starts in milliseconds. |
| `--allow-partial` | Calculate averages from available months when a period is incomplete. |
| `--refresh` | Ignore cached responses and download the data again. |
| `--help` | Show the CLI help text. |

If no output path is provided, the workbook is saved under `outputs/` with the
target Jalali year and month in its filename.

## Workbook Structure

- **Guide:** report metadata, calculation rules, metric definitions, and an
  industry index.
- **Industry sheets:** one worksheet per industry, with six rows per company,
  frozen headers, filters, number formatting, and conditional growth colors.
- **Source audit:** every selected Codal report, correction status, publication
  date, tracing number, source URL, and processing status.

## Data Quality Rules

- Product quantities are aggregated only when their units are compatible.
  Otherwise, total production, total sales quantity, and the company-wide
  weighted rate are reported as unavailable while revenue and dominant-product
  metrics remain available.
- Incomplete multi-month averages are blank by default. Use `--allow-partial`
  only when calculating from the available months is acceptable.
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

The tests cover Jalali month arithmetic, shifted reporting periods, Codal HTML
table parsing, corrections, sales returns and discounts, incompatible units,
dominant-product selection, weighted rates, missing data, growth calculations,
and Excel workbook serialization.

## Data Source

All financial disclosure data comes from the public
[Codal disclosure system](https://www.codal.ir/).
