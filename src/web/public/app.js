const PERIOD_COLUMNS = Object.freeze([
  { key: "priorTarget", definitionKey: "priorYearTarget", fallback: "ماه مشابه سال قبل" },
  { key: "priorYtd", definitionKey: "priorYearYtdAverage", fallback: "میانگین دوره مشابه سال مالی قبل" },
  { key: "priorAnnual", definitionKey: "priorYearFullYearAverage", fallback: "میانگین ۱۲ ماهه سال مالی قبل" },
  { key: "previous", definitionKey: "previousMonth", fallback: "ماه قبل" },
  { key: "target", definitionKey: "targetMonth", fallback: "ماه مبنا" },
  { key: "currentYtd", definitionKey: "currentYearYtdAverage", fallback: "میانگین سال مالی جاری" },
]);

const GROWTH_COLUMNS = Object.freeze([
  { key: "targetYoY", fallback: "رشد ماه مبنا نسبت به سال قبل" },
  { key: "ytdYoY", fallback: "رشد میانگین دوره مالی" },
  { key: "targetMoM", fallback: "رشد ماه مبنا نسبت به ماه قبل" },
]);

const METRICS = Object.freeze([
  { key: "totalProduction", label: "مقدار تولید کل", unit: "واحد گزارش" },
  { key: "totalSales", label: "مقدار فروش کل", unit: "واحد گزارش" },
  { key: "totalRevenue", label: "مبلغ فروش کل", unit: "میلیون ریال" },
  { key: "dominantSales", label: "مقدار فروش محصول غالب", unit: "واحد محصول", dominant: true },
  { key: "dominantRate", label: "نرخ فروش محصول غالب", unit: "ریال / واحد", dominant: true },
  { key: "weightedRate", label: "نرخ فروش موزون کل", unit: "ریال / واحد" },
]);

const JALALI_MONTHS = Object.freeze([
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
]);

const state = {
  dashboard: null,
  activeIndustryId: null,
  selectedSymbols: new Set(),
  expandedSymbols: new Set(),
  searchQuery: "",
  busyAction: null,
  pendingUpdateScope: null,
  toastTimer: null,
  updatePollTimer: null,
};

const elements = {
  appShell: document.querySelector("#appShell"),
  industrySidebar: document.querySelector("#industrySidebar"),
  industryList: document.querySelector("#industryList"),
  industryCount: document.querySelector("#industryCount"),
  menuButton: document.querySelector("#menuButton"),
  sidebarBackdrop: document.querySelector("#sidebarBackdrop"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  sidebarSelectedCount: document.querySelector("#sidebarSelectedCount"),
  overviewSelectedCount: document.querySelector("#overviewSelectedCount"),
  dashboardStatus: document.querySelector("#dashboardStatus"),
  dashboardSubtitle: document.querySelector("#dashboardSubtitle"),
  lastUpdated: document.querySelector("#lastUpdated"),
  targetMonth: document.querySelector("#targetMonth"),
  activeIndustryTitle: document.querySelector("#activeIndustryTitle"),
  activeIndustryCompanyCount: document.querySelector("#activeIndustryCompanyCount"),
  companySearch: document.querySelector("#companySearch"),
  dashboardContent: document.querySelector("#dashboardContent"),
  exportButton: document.querySelector("#exportButton"),
  updateSelectedButton: document.querySelector("#updateSelectedButton"),
  updateAllButton: document.querySelector("#updateAllButton"),
  updateDialog: document.querySelector("#updateDialog"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogDescription: document.querySelector("#dialogDescription"),
  confirmUpdateButton: document.querySelector("#confirmUpdateButton"),
  toast: document.querySelector("#toast"),
};

const faInteger = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });
const faYear = new Intl.NumberFormat("fa-IR", {
  useGrouping: false,
  maximumFractionDigits: 0,
});
const faDecimal = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 });
const faPercent = new Intl.NumberFormat("fa-IR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const faDateTime = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tehran",
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(value) {
  return String(value ?? "")
    .replaceAll("ي", "ی")
    .replaceAll("ك", "ک")
    .replace(/[\u064B-\u065F\u0670\u200C\s]/g, "")
    .toLocaleLowerCase("fa");
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatValue(value, isGrowth = false) {
  const number = finiteNumber(value);
  if (number === null) return "—";
  if (isGrowth) return faPercent.format(number);
  return faDecimal.format(number);
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : faDateTime.format(date);
}

function formatJalaliMonth(value) {
  const year = finiteNumber(value?.year);
  const month = finiteNumber(value?.month);
  if (year === null || month === null || month < 1 || month > 12) return "—";
  return `${JALALI_MONTHS[month - 1]} ${faYear.format(year)}`;
}

function latestUpdateValue() {
  const companyDates = getIndustries()
    .flatMap((industry) => industry.companies ?? [])
    .map((company) => company.updatedAt)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (companyDates.length) return new Date(Math.max(...companyDates.map((date) => date.getTime())));
  return state.dashboard?.metadata?.updatedAt
    ?? state.dashboard?.metadata?.generatedAt
    ?? null;
}

function getIndustries() {
  return Array.isArray(state.dashboard?.industries) ? state.dashboard.industries : [];
}

function industryKey(industry, index = 0) {
  return String(industry?.industryId ?? `industry-${index}`);
}

function companySymbol(company) {
  return String(company?.symbol ?? "").trim();
}

function allSymbols() {
  return getIndustries()
    .flatMap((industry) => Array.isArray(industry.companies) ? industry.companies : [])
    .map(companySymbol)
    .filter(Boolean);
}

function activeIndustry() {
  return getIndustries().find((industry, index) => industryKey(industry, index) === state.activeIndustryId) ?? null;
}

function setDrawer(open) {
  document.body.classList.toggle("drawer-open", open);
  elements.menuButton.setAttribute("aria-expanded", String(open));
  elements.sidebarBackdrop.tabIndex = open ? 0 : -1;
}

function showToast(message, tone = "success") {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast visible ${tone}`;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 4200);
}

async function responseError(response) {
  try {
    const data = await response.json();
    return data?.error ?? data?.message ?? `خطای سرور (${response.status})`;
  } catch {
    return `خطای سرور (${response.status})`;
  }
}

function loadingMarkup(message = "در حال آماده‌سازی داشبورد") {
  return `
    <div class="loading-state" role="status">
      <span class="loader" aria-hidden="true"></span>
      <strong>${escapeHtml(message)}</strong>
      <span>لطفاً چند لحظه صبر کنید…</span>
    </div>
    <div class="skeleton-card" aria-hidden="true"></div>
  `;
}

function renderError(message) {
  elements.dashboardContent.innerHTML = `
    <div class="error-state" role="alert">
      <strong>دریافت اطلاعات ناموفق بود</strong>
      <p>${escapeHtml(message)}</p>
      <button class="button button-secondary" type="button" data-action="retry">تلاش دوباره</button>
    </div>
  `;
  elements.dashboardStatus.textContent = "ارتباط با داده‌ها برقرار نشد";
  elements.appShell.setAttribute("aria-busy", "false");
}

function ingestDashboard(payload, { preserveSelection = false } = {}) {
  const dashboard = payload?.dashboard && !payload?.industries ? payload.dashboard : payload;
  if (!dashboard || !Array.isArray(dashboard.industries)) {
    throw new Error("ساختار داده دریافتی از سرور معتبر نیست.");
  }

  const previousSelection = new Set(state.selectedSymbols);
  state.dashboard = dashboard;
  const validSymbols = new Set(allSymbols());
  state.selectedSymbols = preserveSelection
    ? new Set([...previousSelection].filter((symbol) => validSymbols.has(symbol)))
    : new Set();

  const activeStillExists = getIndustries().some(
    (industry, index) => industryKey(industry, index) === state.activeIndustryId,
  );
  if (!activeStillExists) {
    state.activeIndustryId = getIndustries().length ? industryKey(getIndustries()[0], 0) : null;
  }
  renderDashboard();
}

async function loadDashboard() {
  elements.appShell.setAttribute("aria-busy", "true");
  elements.dashboardContent.innerHTML = loadingMarkup();
  try {
    const response = await fetch("/api/dashboard", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(await responseError(response));
    ingestDashboard(await response.json());
    if (state.dashboard?.metadata?.update?.running) monitorActiveUpdate();
  } catch (error) {
    renderError(error.message || "خطای ناشناخته");
  }
}

function renderDashboard() {
  renderMetadata();
  renderIndustryList();
  renderActiveIndustry();
  renderSelectionState();
  elements.appShell.setAttribute("aria-busy", "false");
}

function renderMetadata() {
  const metadata = state.dashboard?.metadata ?? {};
  const industries = getIndustries();
  const companies = industries.flatMap((industry) => industry.companies ?? []);
  const complete = companies.filter((company) => statusTone(company.status) === "complete").length;

  elements.industryCount.textContent = faInteger.format(industries.length);
  elements.lastUpdated.textContent = formatDateTime(latestUpdateValue());
  elements.targetMonth.textContent = formatJalaliMonth(metadata.targetMonth);
  elements.dashboardStatus.textContent = companies.length
    ? `${faInteger.format(complete)} از ${faInteger.format(companies.length)} نماد با پوشش کامل`
    : "داده‌ای برای نمایش ثبت نشده است";
  elements.dashboardSubtitle.textContent = companies.length
    ? `اطلاعات ${faInteger.format(companies.length)} شرکت تولیدی در ${faInteger.format(industries.length)} صنعت، مستقیماً از پایگاه داده خوانده شده است.`
    : "پس از نخستین بروزرسانی، اطلاعات شرکت‌ها در این بخش نمایش داده می‌شود.";
}

function renderIndustryList() {
  const industries = getIndustries();
  if (!industries.length) {
    elements.industryList.innerHTML = '<p class="empty-sidebar">هنوز صنعتی ثبت نشده است.</p>';
    return;
  }

  elements.industryList.innerHTML = industries.map((industry, index) => {
    const key = industryKey(industry, index);
    const companies = Array.isArray(industry.companies) ? industry.companies : [];
    const symbols = companies.map(companySymbol).filter(Boolean);
    const selectedCount = symbols.filter((symbol) => state.selectedSymbols.has(symbol)).length;
    const allSelected = symbols.length > 0 && selectedCount === symbols.length;
    const isActive = key === state.activeIndustryId;
    const industryName = industry.industryName || `صنعت ${index + 1}`;
    return `
      <div class="industry-item${isActive ? " active" : ""}" role="listitem" data-industry-row="${escapeHtml(key)}">
        <label class="industry-check">
          <span class="sr-only">انتخاب همه نمادهای ${escapeHtml(industryName)}</span>
          <input
            type="checkbox"
            data-industry-checkbox="${escapeHtml(key)}"
            ${allSelected ? "checked" : ""}
            ${symbols.length ? "" : "disabled"}
          >
        </label>
        <button
          class="industry-button"
          type="button"
          data-industry-button="${escapeHtml(key)}"
          aria-current="${isActive ? "true" : "false"}"
        >
          <span class="industry-name">${escapeHtml(industryName)}</span>
          <span class="industry-total">${faInteger.format(companies.length)}</span>
        </button>
      </div>
    `;
  }).join("");

  industries.forEach((industry, index) => {
    const key = industryKey(industry, index);
    const symbols = (industry.companies ?? []).map(companySymbol).filter(Boolean);
    const selectedCount = symbols.filter((symbol) => state.selectedSymbols.has(symbol)).length;
    const checkbox = [...elements.industryList.querySelectorAll("[data-industry-checkbox]")]
      .find((input) => input.dataset.industryCheckbox === key);
    if (checkbox) checkbox.indeterminate = selectedCount > 0 && selectedCount < symbols.length;
  });
}

function renderActiveIndustry() {
  const industry = activeIndustry();
  if (!industry) {
    elements.activeIndustryTitle.textContent = "بدون صنعت";
    elements.activeIndustryCompanyCount.textContent = "۰ شرکت";
    elements.dashboardContent.innerHTML = `
      <div class="empty-state">
        <strong>هنوز اطلاعاتی ثبت نشده است</strong>
        <p>برای دریافت گزارش‌های شرکت‌ها، دکمه «آپدیت همه» را بزنید.</p>
      </div>
    `;
    return;
  }

  const companies = Array.isArray(industry.companies) ? industry.companies : [];
  const query = normalizeText(state.searchQuery);
  const visibleCompanies = query
    ? companies.filter((company) => normalizeText(`${company.symbol} ${company.name}`).includes(query))
    : companies;

  elements.activeIndustryTitle.textContent = industry.industryName || "صنعت بدون نام";
  elements.activeIndustryCompanyCount.textContent = `${faInteger.format(companies.length)} شرکت`;

  if (!visibleCompanies.length) {
    elements.dashboardContent.innerHTML = `
      <div class="empty-state">
        <strong>${companies.length ? "شرکتی با این عبارت پیدا نشد" : "این صنعت هنوز شرکتی ندارد"}</strong>
        <p>${companies.length ? "نام شرکت یا نماد را با عبارت دیگری جست‌وجو کنید." : "پس از بروزرسانی داده‌ها، شرکت‌های این صنعت نمایش داده می‌شوند."}</p>
      </div>
    `;
    return;
  }

  elements.dashboardContent.innerHTML = visibleCompanies.map(renderCompanyCard).join("");
}

function definitionLabel(company, column, isGrowth = false) {
  const definitions = company?.definitions ?? state.dashboard?.metadata?.definitions ?? {};
  const container = isGrowth ? definitions.growth : definitions.periods;
  const definition = container?.[isGrowth ? column.key : column.definitionKey];
  return definition?.label || column.fallback;
}

function statusTone(status) {
  const normalized = normalizeText(status);
  if (normalized === "کامل" || normalized === "complete") return "complete";
  if (normalized.includes("ناقص") || normalized.includes("partial")) return "partial";
  if (normalized.includes("بدونداده") || normalized.includes("nodata")) return "nodata";
  if (normalized.includes("خطا") || normalized.includes("error")) return "error";
  return "nodata";
}

function fiscalEndLabel(monthValue) {
  const month = finiteNumber(monthValue);
  if (month === null || month < 1 || month > 12) return "سال مالی نامشخص";
  const day = month <= 6 ? 31 : month <= 11 ? 30 : 29;
  return `سال مالی: ${faInteger.format(day)} ${JALALI_MONTHS[month - 1]}`;
}

function companyStatusLabel(company) {
  if (company.status) return String(company.status);
  const parsed = finiteNumber(company.parsedReportCount) ?? 0;
  const required = finiteNumber(company.requiredReportCount) ?? 0;
  if (required && parsed >= required) return "کامل";
  if (parsed) return "ناقص";
  return "بدون داده";
}

function coveragePercent(company) {
  const explicit = finiteNumber(company.coverageRatio);
  if (explicit !== null) return Math.max(0, Math.min(1, explicit));
  const parsed = finiteNumber(company.parsedReportCount) ?? 0;
  const required = finiteNumber(company.requiredReportCount) ?? 0;
  return required ? Math.max(0, Math.min(1, parsed / required)) : 0;
}

function metricCell(value, { isGrowth = false, note = "", growthStart = false } = {}) {
  const number = finiteNumber(value);
  const tone = number === null
    ? "missing"
    : isGrowth
      ? number > 0 ? "positive" : number < 0 ? "negative" : "neutral"
      : "";
  return `
    <td class="${growthStart ? "growth-start" : ""}">
      <span class="metric-value ${tone}">${escapeHtml(formatValue(number, isGrowth))}</span>
      ${note && number !== null ? `<span class="cell-note">${escapeHtml(note)}</span>` : ""}
    </td>
  `;
}

function renderCompanyCard(company) {
  const symbol = companySymbol(company);
  const name = company.name || "نام شرکت ثبت نشده";
  const selected = state.selectedSymbols.has(symbol);
  const expanded = state.expandedSymbols.has(symbol);
  const detailsId = `company-details-${symbol}`;
  const parsed = finiteNumber(company.parsedReportCount) ?? 0;
  const required = finiteNumber(company.requiredReportCount) ?? 0;
  const coverage = coveragePercent(company);
  const status = companyStatusLabel(company);
  const tone = statusTone(status);
  const errors = Array.isArray(company.errors) ? company.errors.filter(Boolean) : [];
  const targetDominantProduct = company.periods?.target?.dominantProductName ?? null;

  const headers = [
    ...PERIOD_COLUMNS.map((column) => definitionLabel(company, column)),
    ...GROWTH_COLUMNS.map((column) => definitionLabel(company, column, true)),
  ];

  const rows = METRICS.map((metric) => {
    const periodCells = PERIOD_COLUMNS.map((column) => {
      const period = company.periods?.[column.key];
      return metricCell(period?.metrics?.[metric.key]);
    });
    const growthCells = GROWTH_COLUMNS.map((column, index) => metricCell(
      company.growth?.[column.key]?.[metric.key],
      { isGrowth: true, growthStart: index === 0 },
    ));
    return `
      <tr>
        <th class="metric-column" scope="row">
          <span class="metric-label">${escapeHtml(metric.label)}</span>
          <span class="metric-unit">${escapeHtml(metric.unit)}</span>
        </th>
        ${periodCells.join("")}
        ${growthCells.join("")}
      </tr>
    `;
  }).join("");

  return `
    <article class="company-card${selected ? " selected" : ""}${expanded ? " expanded" : ""}" data-company-symbol="${escapeHtml(symbol)}">
      <header
        class="company-header"
        data-company-toggle="${escapeHtml(symbol)}"
        role="button"
        tabindex="0"
        aria-expanded="${expanded}"
        aria-controls="${escapeHtml(detailsId)}"
      >
        <div class="company-identity">
          <label class="company-check">
            <span class="sr-only">انتخاب نماد ${escapeHtml(symbol)}</span>
            <input type="checkbox" data-company-checkbox="${escapeHtml(symbol)}" ${selected ? "checked" : ""}>
          </label>
          <span class="company-symbol">${escapeHtml(symbol || "—")}</span>
          <span class="company-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        </div>
        <div class="company-badges">
          <span class="badge status-${tone}">${escapeHtml(status)}</span>
          <span class="badge">${escapeHtml(fiscalEndLabel(company.fiscalYearEndMonth))}</span>
          ${targetDominantProduct ? `<span class="badge badge-dominant"><span>محصول غالب:</span> ${escapeHtml(targetDominantProduct)}</span>` : ""}
          <span class="badge">بروزرسانی: ${escapeHtml(formatDateTime(company.updatedAt ?? state.dashboard?.metadata?.generatedAt))}</span>
        </div>
        <div class="coverage" aria-label="پوشش گزارش ${faPercent.format(coverage)}">
          <div class="coverage-text">
            <span>پوشش گزارش‌ها</span>
            <span>${faInteger.format(parsed)} از ${faInteger.format(required)}</span>
          </div>
          <div class="coverage-track" aria-hidden="true">
            <span class="coverage-bar" style="width: ${Math.round(coverage * 100)}%"></span>
          </div>
        </div>
        <span class="company-chevron" aria-hidden="true"></span>
      </header>
      <div id="${escapeHtml(detailsId)}" class="company-details" aria-hidden="${!expanded}">
        <div class="company-details-inner">
          <div class="table-scroll" tabindex="0" role="region" aria-label="جدول تحلیلی نماد ${escapeHtml(symbol)}">
            <table class="metrics-table">
              <caption class="sr-only">مقادیر و رشدهای نماد ${escapeHtml(symbol)}</caption>
              <thead>
                <tr>
                  <th class="metric-column" scope="col">شاخص</th>
                  ${headers.map((label, index) => `<th scope="col" class="${index === PERIOD_COLUMNS.length ? "growth-start" : ""}">${escapeHtml(label)}</th>`).join("")}
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ${errors.length ? `
            <details class="company-errors">
              <summary>${faInteger.format(errors.length)} هشدار در دریافت یا پردازش گزارش‌ها</summary>
              <ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>
            </details>
          ` : ""}
        </div>
      </div>
    </article>
  `;
}

function toggleCompanyDetails(symbol) {
  if (!symbol) return;
  const expanded = !state.expandedSymbols.has(symbol);
  if (expanded) state.expandedSymbols.add(symbol);
  else state.expandedSymbols.delete(symbol);

  const card = [...elements.dashboardContent.querySelectorAll("[data-company-symbol]")]
    .find((element) => element.dataset.companySymbol === symbol);
  if (!card) return;
  card.classList.toggle("expanded", expanded);
  card.querySelector("[data-company-toggle]")?.setAttribute("aria-expanded", String(expanded));
  card.querySelector(".company-details")?.setAttribute("aria-hidden", String(!expanded));
}

function renderSelectionState() {
  const count = state.selectedSymbols.size;
  const busy = Boolean(state.busyAction);
  elements.sidebarSelectedCount.textContent = faInteger.format(count);
  elements.overviewSelectedCount.textContent = faInteger.format(count);
  elements.clearSelectionButton.disabled = count === 0 || busy;
  elements.exportButton.disabled = count === 0 || busy;
  elements.updateSelectedButton.disabled = count === 0 || busy;
  elements.updateAllButton.disabled = busy;

  elements.exportButton.setAttribute(
    "aria-label",
    count ? `خروجی اکسل برای ${faInteger.format(count)} نماد` : "برای خروجی اکسل ابتدا نماد انتخاب کنید",
  );
  elements.updateSelectedButton.setAttribute(
    "aria-label",
    count ? `بروزرسانی ${faInteger.format(count)} نماد انتخاب‌شده` : "برای بروزرسانی ابتدا نماد انتخاب کنید",
  );
}

function toggleIndustry(key, checked) {
  const industry = getIndustries().find((item, index) => industryKey(item, index) === key);
  if (!industry) return;
  for (const company of industry.companies ?? []) {
    const symbol = companySymbol(company);
    if (!symbol) continue;
    if (checked) state.selectedSymbols.add(symbol);
    else state.selectedSymbols.delete(symbol);
  }
  renderIndustryList();
  renderActiveIndustry();
  renderSelectionState();
}

function toggleCompany(symbol, checked) {
  if (checked) state.selectedSymbols.add(symbol);
  else state.selectedSymbols.delete(symbol);
  renderIndustryList();
  renderActiveIndustry();
  renderSelectionState();
}

function openUpdateDialog(scope) {
  if (scope === "selected" && !state.selectedSymbols.size) {
    showToast("ابتدا دست‌کم یک نماد را انتخاب کنید.", "error");
    return;
  }
  state.pendingUpdateScope = scope;
  const catalogCount = finiteNumber(state.dashboard?.metadata?.companyCatalogCount);
  const count = scope === "all" ? catalogCount : state.selectedSymbols.size;
  const initialLoad = !state.dashboard?.metadata?.hasData;
  elements.dialogTitle.textContent = scope === "all" ? "آپدیت همه نمادها" : "آپدیت نمادهای انتخاب‌شده";
  elements.dialogDescription.textContent = scope === "all"
    ? initialLoad
      ? `${count ? `گزارش‌های ${faInteger.format(count)} شرکت تولیدی` : "گزارش‌های تمام شرکت‌های تولیدی فعال"} برای بار نخست به‌طور کامل از کدال دریافت می‌شوند. میان پایان هر نماد و شروع نماد بعدی ۱۰ ثانیه فاصله خواهد بود.`
      : `فهرست اطلاعیه‌های ${count ? faInteger.format(count) : "تمام"} شرکت بررسی می‌شود و فقط گزارش‌های تازه یا اصلاحیه‌ها استخراج و ذخیره می‌شوند. نمادهای بدون تغییر دوباره دانلود نمی‌شوند.`
    : `اطلاعیه‌های ${faInteger.format(count)} نماد انتخاب‌شده بررسی می‌شوند و فقط گزارش تازه یا اصلاحیه در پایگاه داده جایگزین خواهد شد.`;
  if (typeof elements.updateDialog.showModal === "function") {
    elements.updateDialog.returnValue = "";
    elements.updateDialog.showModal();
  }
  else performUpdate(scope);
}

function updateProgressMessage(update) {
  const completed = finiteNumber(update?.completed) ?? 0;
  const total = finiteNumber(update?.total) ?? 0;
  const progress = total
    ? `${faInteger.format(completed)} از ${faInteger.format(total)}`
    : `${faInteger.format(completed)} شرکت`;
  const symbol = update?.symbol ? ` — ${update.symbol}` : "";
  const updated = finiteNumber(update?.updatedCount) ?? 0;
  const unchanged = finiteNumber(update?.unchangedCount) ?? 0;
  return `در حال بروزرسانی ${progress}${symbol} — جدید ${faInteger.format(updated)}، بدون تغییر ${faInteger.format(unchanged)}`;
}

function stopUpdateMonitor() {
  if (state.updatePollTimer) window.clearInterval(state.updatePollTimer);
  state.updatePollTimer = null;
}

function monitorActiveUpdate() {
  if (state.updatePollTimer) return;
  state.busyAction = "update";
  renderSelectionState();
  const poll = async () => {
    try {
      const response = await fetch("/api/update/status", { headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const update = await response.json();
      if (update.running) {
        elements.dashboardStatus.textContent = updateProgressMessage(update);
        return;
      }
      stopUpdateMonitor();
      state.busyAction = null;
      const dashboardResponse = await fetch("/api/dashboard", { headers: { Accept: "application/json" } });
      if (dashboardResponse.ok) ingestDashboard(await dashboardResponse.json(), { preserveSelection: true });
      renderSelectionState();
    } catch {
      // A later poll will retry while the long-running update remains active.
    }
  };
  state.updatePollTimer = window.setInterval(poll, 2_000);
  window.setTimeout(poll, 500);
}

async function performUpdate(scope) {
  const symbols = scope === "selected" ? [...state.selectedSymbols] : undefined;
  state.busyAction = "update";
  renderSelectionState();
  elements.dashboardContent.setAttribute("aria-busy", "true");
  showToast(scope === "all" ? "بروزرسانی همه نمادها آغاز شد…" : "بروزرسانی نمادهای منتخب آغاز شد…");
  monitorActiveUpdate();
  try {
    const response = await fetch("/api/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ scope, ...(symbols ? { symbols } : {}) }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    stopUpdateMonitor();
    ingestDashboard(await response.json(), { preserveSelection: true });
    showToast("اطلاعات با موفقیت بروزرسانی و ذخیره شد.", "success");
  } catch (error) {
    showToast(error.message || "بروزرسانی اطلاعات ناموفق بود.", "error");
  } finally {
    stopUpdateMonitor();
    state.busyAction = null;
    elements.dashboardContent.setAttribute("aria-busy", "false");
    renderSelectionState();
  }
}

function filenameFromResponse(response) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch) return decodeURIComponent(utfMatch[1].replaceAll('"', ""));
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] || `codal-monthly-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

async function exportSelected() {
  if (!state.selectedSymbols.size) {
    showToast("ابتدا نمادهای موردنظر را انتخاب کنید.", "error");
    return;
  }
  state.busyAction = "export";
  renderSelectionState();
  try {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      body: JSON.stringify({ symbols: [...state.selectedSymbols] }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filenameFromResponse(response);
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("فایل اکسل نمادهای منتخب آماده و دانلود شد.", "success");
  } catch (error) {
    showToast(error.message || "ساخت فایل اکسل ناموفق بود.", "error");
  } finally {
    state.busyAction = null;
    renderSelectionState();
  }
}

elements.industryList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-industry-button]");
  if (!button) return;
  state.activeIndustryId = button.dataset.industryButton;
  state.searchQuery = "";
  elements.companySearch.value = "";
  renderIndustryList();
  renderActiveIndustry();
  if (window.matchMedia("(max-width: 920px)").matches) setDrawer(false);
});

elements.industryList.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-industry-checkbox]");
  if (checkbox) toggleIndustry(checkbox.dataset.industryCheckbox, checkbox.checked);
});

elements.dashboardContent.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-company-checkbox]");
  if (checkbox) toggleCompany(checkbox.dataset.companyCheckbox, checkbox.checked);
});

elements.dashboardContent.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="retry"]')) {
    loadDashboard();
    return;
  }
  if (event.target.closest(".company-check")) return;
  const toggle = event.target.closest("[data-company-toggle]");
  if (toggle) toggleCompanyDetails(toggle.dataset.companyToggle);
});

elements.dashboardContent.addEventListener("keydown", (event) => {
  if (event.target.closest(".company-check")) return;
  const toggle = event.target.closest("[data-company-toggle]");
  if (!toggle || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  toggleCompanyDetails(toggle.dataset.companyToggle);
});

elements.companySearch.addEventListener("input", () => {
  state.searchQuery = elements.companySearch.value;
  renderActiveIndustry();
});

elements.clearSelectionButton.addEventListener("click", () => {
  state.selectedSymbols.clear();
  renderIndustryList();
  renderActiveIndustry();
  renderSelectionState();
});

elements.menuButton.addEventListener("click", () => {
  setDrawer(!document.body.classList.contains("drawer-open"));
});
elements.sidebarBackdrop.addEventListener("click", () => setDrawer(false));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("drawer-open")) setDrawer(false);
});
window.matchMedia("(min-width: 921px)").addEventListener("change", (event) => {
  if (event.matches) setDrawer(false);
});

elements.exportButton.addEventListener("click", exportSelected);
elements.updateSelectedButton.addEventListener("click", () => openUpdateDialog("selected"));
elements.updateAllButton.addEventListener("click", () => openUpdateDialog("all"));
elements.updateDialog.addEventListener("close", () => {
  if (elements.updateDialog.returnValue === "confirm" && state.pendingUpdateScope) {
    performUpdate(state.pendingUpdateScope);
  }
  state.pendingUpdateScope = null;
});

loadDashboard();
