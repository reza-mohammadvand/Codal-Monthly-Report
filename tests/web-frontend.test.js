import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const CSS_FILE = new URL("../src/web/public/styles.css", import.meta.url);
const APP_FILE = new URL("../src/web/public/app.js", import.meta.url);
const INDEX_FILE = new URL("../src/web/public/index.html", import.meta.url);
const SORTING_FILE = new URL("../src/web/public/sorting.js", import.meta.url);

test("dashboard keeps the desktop sidebar on the right with brighter typography", async () => {
  const css = await fs.readFile(CSS_FILE, "utf8");
  assert.match(css, /\.app-shell\s*\{[^}]*direction:\s*ltr;/s);
  assert.match(css, /\.sidebar\s*\{[^}]*grid-column:\s*2;/s);
  assert.match(css, /--text:\s*#f6f9fc;/);
  assert.match(css, /body\s*\{[^}]*font-size:\s*15px;/s);
});

test("company summaries control animated, keyboard-accessible detail panels", async () => {
  const [css, app] = await Promise.all([
    fs.readFile(CSS_FILE, "utf8"),
    fs.readFile(APP_FILE, "utf8"),
  ]);
  assert.match(css, /\.company-details\s*\{[^}]*grid-template-rows:\s*0fr;/s);
  assert.match(css, /\.company-card\.expanded \.company-details\s*\{[^}]*grid-template-rows:\s*1fr;/s);
  assert.match(css, /\.company-card\.expanded \.company-details-inner\s*\{[^}]*transform:\s*translateY\(0\) scale\(1\);/s);
  assert.match(css, /\.company-chevron::before\s*\{[^}]*border-right:\s*2px solid var\(--cyan\);[^}]*border-bottom:\s*2px solid var\(--cyan\);/s);
  assert.match(css, /\.company-card\.expanded \.company-chevron\s*\{[^}]*transform:\s*rotate\(180deg\);/s);
  assert.match(app, /expandedSymbols:\s*new Set\(\)/);
  assert.match(app, /aria-expanded="\$\{expanded\}"/);
  assert.match(app, /querySelectorAll\("\[data-company-symbol\]"\)/);
  assert.match(app, /event\.key !== "Enter"/);
  assert.match(app, /event\.key !== " "/);
  assert.match(app, /const faYear = new Intl\.NumberFormat\("fa-IR", \{[^}]*useGrouping: false,/s);
  assert.match(app, /faYear\.format\(year\)/);
  const dominantBasketLabels = (app.match(/سبد غالب:/g) ?? []).length;
  assert.ok(dominantBasketLabels >= 1 && dominantBasketLabels <= 2);
  assert.doesNotMatch(app, /metric\.dominant \? period\?\.dominantProductName/);
});

test("selecting companies immediately enables selected update and Excel export", async () => {
  const [app, html] = await Promise.all([
    fs.readFile(APP_FILE, "utf8"),
    fs.readFile(INDEX_FILE, "utf8"),
  ]);
  assert.match(app, /dashboardContent\.addEventListener\("input"/);
  assert.match(app, /industryList\.addEventListener\("input"/);
  assert.match(app, /exportButton\.disabled = busy/);
  assert.match(app, /updateSelectedButton\.disabled = busy/);
  assert.match(app, /exportButton\.setAttribute\("aria-disabled", String\(count === 0 \|\| busy\)\)/);
  assert.match(app, /event\.target\.closest\("\[data-company-checkbox\]"\)/);
  assert.match(app, /function syncSelectionFromPage\(\)/);
  assert.match(app, /dashboardContent\.querySelectorAll\("\[data-company-checkbox\]"\)/);
  assert.match(app, /if \(scope === "selected"\) syncSelectionFromPage\(\)/);
  assert.match(app, /async function exportSelected\(\) \{\s*syncSelectionFromPage\(\);/s);
  assert.match(app, /card\.classList\.toggle\("selected", checked\)/);
  assert.match(app, /exportButton\.onclick = \(event\) =>/);
  assert.match(app, /updateSelectedButton\.onclick = \(event\) =>/);
  assert.match(app, /requestUpdate\("selected"\)/);
  assert.match(app, /confirmUpdateButton\.onclick = \(\) =>/);
  assert.match(app, /function syncNativeActionForm\(\)/);
  assert.match(app, /input\.name = "symbols"/);
  assert.match(app, /showToast\(message, "busy", \{ persistent: true \}\)/);
  assert.doesNotMatch(html, /id="(?:exportButton|updateSelectedButton)"[^>]*\sdisabled(?:\s|>)/);
  assert.match(html, /sorting\.js\?v=1" defer/);
  assert.match(html, /app\.js\?v=25" defer/);
  assert.match(html, /id="dashboardActionsForm"/);
  assert.match(html, /formaction="\/actions\/export"/);
  assert.match(html, /formaction="\/actions\/update\?scope=selected"/);
  assert.match(html, /formaction="\/actions\/update\?scope=all"/);
  assert.match(html, /id="recentDaysInput"/);
  assert.match(html, /name="recentDays"/);
  assert.match(app, /scope === "all" \? \{ recentDays \} : \{\}/);
  assert.match(html, /id="incompleteButton"/);
  assert.match(app, /function openIncompleteDialog\(\)/);
  assert.match(app, /نتایج جست‌وجو در همه صنایع/);
  assert.match(app, /const ALL_INDUSTRIES_KEY = "__all__"/);
  assert.match(html, /id="sortMetric"/);
  assert.match(html, /id="sortColumn"/);
  assert.equal((html.match(/<option value="(?:targetYoY|ytdYoY|targetMoM)"/g) ?? []).length, 3);
  assert.match(html, /id="metricVisibilityMenu"/);
  assert.doesNotMatch(html, /metricVisibilitySummary/);
  assert.equal((html.match(/data-metric-visibility=/g) ?? []).length, 4);
  assert.match(html, /id="sortAscendingButton"/);
  assert.match(html, /id="sortDescendingButton"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /id="tableViewToggle"/);
  assert.match(app, /function sortCompanies\(companies\)/);
  assert.match(app, /if \(!state\.sortDirection\) return \[\.\.\.companies\]/);
  assert.match(app, /left\.growth\?\.\[state\.sortColumn\]\?\.\[state\.sortMetric\]/);
  assert.match(app, /CodalDashboardSorting\.compareNullableNumbers/);
  assert.match(app, /setSortDirection\(null\)/);
  assert.match(app, /function renderSortColumnOptions\(\)/);
  assert.match(app, /function toggleSortDirection\(direction\)/);
  assert.match(app, /faDecimal = new Intl\.NumberFormat\("fa-IR", \{ maximumFractionDigits: 0 \}\)/);
  assert.match(app, /minimumFractionDigits: 0,[\s\S]*maximumFractionDigits: 0,/);
  assert.match(app, /function renderUnifiedTable\(companies\)/);
  assert.match(app, /function codalSymbolLink\(symbol\)/);
  assert.match(app, /https:\/\/www\.codal\.ir\/ReportList\.aspx\?search&Symbol=/);
  assert.match(app, /data-codal-symbol-link/);
  assert.match(app, /target="_blank"/);
  assert.match(app, /event\.target\.closest\("\[data-codal-symbol-link\]"\)/);
  assert.match(app, /function visibleMetrics\(\)/);
  assert.match(app, /function renderMetricVisibilityState\(\)/);
  assert.doesNotMatch(html, /type="module"/);
  assert.doesNotMatch(html, /runtime-badge|نسخه ۱۵: رابط آماده/);
});

test("growth sorting preserves negative, zero, and positive numeric order", async () => {
  const source = await fs.readFile(SORTING_FILE, "utf8");
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  const compare = sandbox.CodalDashboardSorting.compareNullableNumbers;
  const values = [0.25, -0.4, null, 0, -0.1, 1.2];

  assert.deepEqual([...values].sort((left, right) => compare(left, right, "asc")), [
    -0.4, -0.1, 0, 0.25, 1.2, null,
  ]);
  assert.deepEqual([...values].sort((left, right) => compare(left, right, "desc")), [
    1.2, 0.25, 0, -0.1, -0.4, null,
  ]);
});

test("every statically queried UI element exists in the dashboard HTML", async () => {
  const [app, html] = await Promise.all([
    fs.readFile(APP_FILE, "utf8"),
    fs.readFile(INDEX_FILE, "utf8"),
  ]);
  const queriedIds = [...app.matchAll(/document\.querySelector\("#([^"]+)"\)/g)]
    .map((match) => match[1]);
  assert.ok(queriedIds.length > 0);
  for (const id of queriedIds) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
});

test("bulk updates expose all-company scope and keep polling progress", async () => {
  const app = await fs.readFile(APP_FILE, "utf8");
  assert.match(app, /metadata\?\.companyCatalogCount/);
  assert.match(app, /fetch\("\/api\/update\/status"/);
  assert.match(app, /setInterval\(poll, 2_000\)/);
  assert.match(app, /monitorActiveUpdate\(\)/);
});
