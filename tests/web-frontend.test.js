import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const CSS_FILE = new URL("../src/web/public/styles.css", import.meta.url);
const APP_FILE = new URL("../src/web/public/app.js", import.meta.url);

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
  assert.equal((app.match(/محصول غالب:/g) ?? []).length, 1);
  assert.doesNotMatch(app, /metric\.dominant \? period\?\.dominantProductName/);
});

test("bulk updates expose all-company scope and keep polling progress", async () => {
  const app = await fs.readFile(APP_FILE, "utf8");
  assert.match(app, /metadata\?\.companyCatalogCount/);
  assert.match(app, /fetch\("\/api\/update\/status"/);
  assert.match(app, /setInterval\(poll, 2_000\)/);
  assert.match(app, /monitorActiveUpdate\(\)/);
});
