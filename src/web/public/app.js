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
  { key: "dominantProduction", label: "مقدار تولید سبد غالب", unit: "واحد محصول" },
  { key: "dominantSales", label: "مقدار فروش سبد غالب", unit: "واحد محصول" },
  { key: "dominantRevenue", label: "مبلغ فروش سبد غالب", unit: "میلیون ریال" },
  { key: "dominantRate", label: "نرخ فروش سبد غالب", unit: "ریال / واحد" },
]);

const JALALI_MONTHS = Object.freeze([
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
]);

const ALL_INDUSTRIES_KEY = "__all__";

const state = {
  dashboard: null,
  activeIndustryId: null,
  selectedSymbols: new Set(),
  expandedSymbols: new Set(),
  searchQuery: "",
  sortMetric: "dominantRevenue",
  sortColumn: "targetYoY",
  sortDirection: null,
  visibleMetricKeys: new Set(METRICS.map((metric) => metric.key)),
  tableView: false,
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
  dashboardStatus: document.querySelector("#dashboardStatus"),
  dashboardSubtitle: document.querySelector("#dashboardSubtitle"),
  lastUpdated: document.querySelector("#lastUpdated"),
  targetMonth: document.querySelector("#targetMonth"),
  activeIndustryTitle: document.querySelector("#activeIndustryTitle"),
  activeIndustryCompanyCount: document.querySelector("#activeIndustryCompanyCount"),
  companySearch: document.querySelector("#companySearch"),
  metricVisibilityMenu: document.querySelector("#metricVisibilityMenu"),
  sortMetric: document.querySelector("#sortMetric"),
  sortColumn: document.querySelector("#sortColumn"),
  sortAscendingButton: document.querySelector("#sortAscendingButton"),
  sortDescendingButton: document.querySelector("#sortDescendingButton"),
  tableViewToggle: document.querySelector("#tableViewToggle"),
  dashboardContent: document.querySelector("#dashboardContent"),
  dashboardActionsForm: document.querySelector("#dashboardActionsForm"),
  incompleteButton: document.querySelector("#incompleteButton"),
  incompleteButtonCount: document.querySelector("#incompleteButtonCount"),
  incompleteDialog: document.querySelector("#incompleteDialog"),
  incompleteDialogDescription: document.querySelector("#incompleteDialogDescription"),
  incompleteList: document.querySelector("#incompleteList"),
  exportButton: document.querySelector("#exportButton"),
  updateSelectedButton: document.querySelector("#updateSelectedButton"),
  updateAllButton: document.querySelector("#updateAllButton"),
  recentDaysInput: document.querySelector("#recentDaysInput"),
  updateDialog: document.querySelector("#updateDialog"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogDescription: document.querySelector("#dialogDescription"),
  confirmUpdateButton: document.querySelector("#confirmUpdateButton"),
  toast: document.querySelector("#toast"),
};

// Wire the primary actions immediately. Keeping these handlers near the DOM
// lookup makes the buttons operational even if a later optional UI feature is
// unavailable in a particular browser.
elements.exportButton.onclick = (event) => {
  event.preventDefault();
  exportSelected();
};
elements.updateSelectedButton.onclick = (event) => {
  event.preventDefault();
  requestUpdate("selected");
};
elements.updateAllButton.onclick = (event) => {
  event.preventDefault();
  requestUpdate("all");
};
elements.incompleteButton.onclick = () => openIncompleteDialog();
elements.confirmUpdateButton.onclick = () => {
  const scope = state.pendingUpdateScope;
  state.pendingUpdateScope = null;
  if (elements.updateDialog.open) elements.updateDialog.close();
  if (scope) performUpdate(scope);
};
elements.dashboardActionsForm.onsubmit = () => {
  showToast("درخواست ثبت شد؛ لطفاً تا پایان عملیات این صفحه را باز نگه دارید…", "busy", {
    persistent: true,
  });
};
const faInteger = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });
const faYear = new Intl.NumberFormat("fa-IR", {
  useGrouping: false,
  maximumFractionDigits: 0,
});
const faDecimal = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });
const faPercent = new Intl.NumberFormat("fa-IR", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
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

function allCompanies() {
  return getIndustries().flatMap((industry) => (
    Array.isArray(industry.companies) ? industry.companies : []
  ));
}

function allSymbols() {
  return allCompanies()
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

function showToast(message, tone = "success", { persistent = false } = {}) {
  window.clearTimeout(state.toastTimer);
  state.toastTimer = null;
  elements.toast.textContent = message;
  elements.toast.className = `toast visible ${tone}`;
  if (!persistent) {
    state.toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("visible");
    }, 4200);
  }
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
  ) || state.activeIndustryId === ALL_INDUSTRIES_KEY;
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
    const url = new URL(window.location.href);
    if (url.searchParams.get("action") === "updated") {
      showToast("اطلاعات با موفقیت بروزرسانی و در پایگاه داده ذخیره شد.", "success");
      url.searchParams.delete("action");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  } catch (error) {
    renderError(error.message || "خطای ناشناخته");
  }
}

function renderDashboard() {
  renderMetadata();
  renderIndustryList();
  renderSortColumnOptions();
  renderActiveIndustry();
  renderSelectionState();
  elements.appShell.setAttribute("aria-busy", "false");
}

function renderMetadata() {
  const metadata = state.dashboard?.metadata ?? {};
  const industries = getIndustries();
  const companies = industries.flatMap((industry) => industry.companies ?? []);
  const complete = companies.filter((company) => statusTone(company.status) === "complete").length;
  const incomplete = companies.filter((company) => missingDisplayedValueCount(company) > 0).length;

  elements.industryCount.textContent = faInteger.format(industries.length);
  elements.incompleteButtonCount.textContent = faInteger.format(incomplete);
  elements.lastUpdated.textContent = formatDateTime(latestUpdateValue());
  elements.targetMonth.textContent = formatJalaliMonth(metadata.targetMonth);
  elements.dashboardStatus.textContent = companies.length
    ? `${faInteger.format(complete)} از ${faInteger.format(companies.length)} نماد با پوشش کامل`
    : "داده‌ای برای نمایش ثبت نشده است";
  elements.dashboardSubtitle.textContent = companies.length
    ? `اطلاعات ${faInteger.format(companies.length)} شرکت تولیدی در ${faInteger.format(industries.length)} صنعت، مستقیماً از پایگاه داده خوانده شده است.`
    : "پس از نخستین بروزرسانی، اطلاعات شرکت‌ها در این بخش نمایش داده می‌شود.";
}

function missingDisplayedValueCount(company) {
  let missing = 0;
  for (const column of PERIOD_COLUMNS) {
    for (const metric of METRICS) {
      if (finiteNumber(company.periods?.[column.key]?.metrics?.[metric.key]) === null) missing += 1;
    }
  }
  for (const column of GROWTH_COLUMNS) {
    for (const metric of METRICS) {
      if (finiteNumber(company.growth?.[column.key]?.[metric.key]) === null) missing += 1;
    }
  }
  return missing;
}

function incompleteCompanies() {
  return getIndustries()
    .flatMap((industry) => (industry.companies ?? []).map((company) => ({
      company,
      industryName: industry.industryName || "صنعت نامشخص",
      missingCount: missingDisplayedValueCount(company),
    })))
    .filter((item) => item.missingCount > 0)
    .sort((left, right) => companySymbol(left.company).localeCompare(companySymbol(right.company), "fa"));
}

function openIncompleteDialog() {
  const companies = incompleteCompanies();
  elements.incompleteDialogDescription.textContent = companies.length
    ? `${faInteger.format(companies.length)} نماد دست‌کم یک مقدار خالی در جدول تحلیلی دارند.`
    : "هیچ نمادی با مقدار خالی در جدول تحلیلی پیدا نشد.";
  elements.incompleteList.innerHTML = companies.length
    ? companies.map(({ company, industryName, missingCount }) => `
        <div class="incomplete-item">
          <strong class="incomplete-symbol">${escapeHtml(companySymbol(company) || "—")}</strong>
          <span class="incomplete-name" title="${escapeHtml(company.name || industryName)}">${escapeHtml(company.name || industryName)}</span>
          <span class="incomplete-missing-count">${faInteger.format(missingCount)} مقدار خالی</span>
        </div>
      `).join("")
    : '<div class="incomplete-empty">اطلاعات همه نمادهای موجود کامل است.</div>';
  if (typeof elements.incompleteDialog.showModal === "function") {
    elements.incompleteDialog.showModal();
  } else {
    elements.incompleteDialog.setAttribute("open", "");
  }
}

function renderIndustryList() {
  const industries = getIndustries();
  if (!industries.length) {
    elements.industryList.innerHTML = '<p class="empty-sidebar">هنوز صنعتی ثبت نشده است.</p>';
    return;
  }

  const marketSymbols = allSymbols();
  const marketSelectedCount = marketSymbols.filter((symbol) => state.selectedSymbols.has(symbol)).length;
  const allMarketSelected = marketSymbols.length > 0 && marketSelectedCount === marketSymbols.length;
  const allIndustriesMarkup = `
    <div class="industry-item industry-item-all${state.activeIndustryId === ALL_INDUSTRIES_KEY ? " active" : ""}" role="listitem" data-industry-row="${ALL_INDUSTRIES_KEY}">
      <label class="industry-check">
        <span class="sr-only">انتخاب همه نمادهای بازار</span>
        <input
          type="checkbox"
          data-industry-checkbox="${ALL_INDUSTRIES_KEY}"
          ${allMarketSelected ? "checked" : ""}
        >
      </label>
      <button
        class="industry-button"
        type="button"
        data-industry-button="${ALL_INDUSTRIES_KEY}"
        aria-current="${state.activeIndustryId === ALL_INDUSTRIES_KEY ? "true" : "false"}"
      >
        <span class="industry-name">همه نمادها</span>
        <span class="industry-total">${faInteger.format(marketSymbols.length)}</span>
      </button>
    </div>
  `;

  const industryMarkup = industries.map((industry, index) => {
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
  elements.industryList.innerHTML = allIndustriesMarkup + industryMarkup;

  const allCheckbox = elements.industryList.querySelector(`[data-industry-checkbox="${ALL_INDUSTRIES_KEY}"]`);
  if (allCheckbox) {
    allCheckbox.indeterminate = marketSelectedCount > 0 && marketSelectedCount < marketSymbols.length;
  }

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
  const showingAll = state.activeIndustryId === ALL_INDUSTRIES_KEY;
  const query = normalizeText(state.searchQuery);
  if (!industry && !showingAll && !query) {
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

  const industryCompanies = showingAll
    ? allCompanies()
    : Array.isArray(industry?.companies) ? industry.companies : [];
  const searchableCompanies = query ? allCompanies() : industryCompanies;
  const filteredCompanies = query
    ? searchableCompanies.filter((company) => (
        normalizeText(`${company.symbol} ${company.name}`).includes(query)
      ))
    : industryCompanies;
  const visibleCompanies = sortCompanies(filteredCompanies);

  elements.activeIndustryTitle.textContent = query
    ? "نتایج جست‌وجو در همه صنایع"
    : showingAll ? "همه نمادها" : industry?.industryName || "صنعت بدون نام";
  elements.activeIndustryCompanyCount.textContent = query
    ? `${faInteger.format(visibleCompanies.length)} نتیجه`
    : `${faInteger.format(industryCompanies.length)} شرکت`;

  if (!visibleCompanies.length) {
    elements.dashboardContent.innerHTML = `
      <div class="empty-state">
        <strong>${query ? "شرکتی با این عبارت پیدا نشد" : "این صنعت هنوز شرکتی ندارد"}</strong>
        <p>${query ? "نام شرکت یا نماد را با عبارت دیگری جست‌وجو کنید." : "پس از بروزرسانی داده‌ها، شرکت‌های این صنعت نمایش داده می‌شوند."}</p>
      </div>
    `;
    return;
  }

  elements.dashboardContent.innerHTML = state.tableView
    ? renderUnifiedTable(visibleCompanies)
    : visibleCompanies.map(renderCompanyCard).join("");
}

function sortCompanies(companies) {
  if (!state.sortDirection) return [...companies];
  return [...companies].sort((left, right) => {
    const leftValue = finiteNumber(left.growth?.[state.sortColumn]?.[state.sortMetric]);
    const rightValue = finiteNumber(right.growth?.[state.sortColumn]?.[state.sortMetric]);
    const comparison = globalThis.CodalDashboardSorting.compareNullableNumbers(
      leftValue,
      rightValue,
      state.sortDirection,
    );
    return comparison || companySymbol(left).localeCompare(companySymbol(right), "fa");
  });
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

function companyMetricUnit(company, metric) {
  const target = company.periods?.target;
  if (metric.key === "dominantRevenue") return metric.unit;
  if (metric.key === "dominantRate") {
    const unit = target?.dominantProductRateUnit;
    return unit ? `ریال / ${unit}` : metric.unit;
  }
  return target?.dominantProductUnit || metric.unit;
}

function visibleMetrics() {
  return METRICS.filter((metric) => state.visibleMetricKeys.has(metric.key));
}

function renderUnifiedTable(companies) {
  const displayedMetrics = visibleMetrics();
  const sample = companies[0];
  const headers = [
    ...PERIOD_COLUMNS.map((column) => definitionLabel(sample, column)),
    ...GROWTH_COLUMNS.map((column) => definitionLabel(sample, column, true)),
  ];
  const body = companies.map((company) => {
    const symbol = companySymbol(company);
    const selected = state.selectedSymbols.has(symbol);
    const status = companyStatusLabel(company);
    const tone = statusTone(status);
    const dominantProduct = company.periods?.target?.dominantProductName ?? null;
    return displayedMetrics.map((metric, metricIndex) => {
      const periodCells = PERIOD_COLUMNS.map((column) => (
        metricCell(company.periods?.[column.key]?.metrics?.[metric.key])
      ));
      const growthCells = GROWTH_COLUMNS.map((column, index) => metricCell(
        company.growth?.[column.key]?.[metric.key],
        { isGrowth: true, growthStart: index === 0 },
      ));
      return `
        <tr class="unified-company-row${selected ? " selected" : ""}${metricIndex === 0 ? " group-start" : ""}" data-table-symbol="${escapeHtml(symbol)}">
          ${metricIndex === 0 ? `
            <th class="unified-company-column" scope="rowgroup" rowspan="${displayedMetrics.length}">
              <div class="unified-company-identity">
                <label class="company-check">
                  <span class="sr-only">انتخاب نماد ${escapeHtml(symbol)}</span>
                  <input type="checkbox" data-company-checkbox="${escapeHtml(symbol)}" ${selected ? "checked" : ""}>
                </label>
                <span>
                  <strong>${escapeHtml(symbol || "—")}</strong>
                  <small title="${escapeHtml(company.name || "")}">${escapeHtml(company.name || "نام شرکت ثبت نشده")}</small>
                </span>
                <span class="badge status-${tone}">${escapeHtml(status)}</span>
                ${dominantProduct ? `<small class="unified-dominant">سبد غالب: ${escapeHtml(dominantProduct)}</small>` : ""}
              </div>
            </th>
          ` : ""}
          <th class="metric-column unified-metric-column" scope="row">
            <span class="metric-label">${escapeHtml(metric.label)}</span>
            <span class="metric-unit">${escapeHtml(companyMetricUnit(company, metric))}</span>
          </th>
          ${periodCells.join("")}
          ${growthCells.join("")}
        </tr>
      `;
    }).join("");
  }).join("");

  return `
    <div class="table-scroll unified-table-scroll" tabindex="0" role="region" aria-label="جدول یکپارچه شرکت‌ها">
      <table class="metrics-table unified-table">
        <caption class="sr-only">مقایسه یکپارچه ${faInteger.format(companies.length)} نماد</caption>
        <thead>
          <tr>
            <th class="unified-company-column" scope="col">نماد و شرکت</th>
            <th class="metric-column unified-metric-column" scope="col">شاخص</th>
            ${headers.map((label, index) => `<th scope="col" class="${index === PERIOD_COLUMNS.length ? "growth-start" : ""}">${escapeHtml(label)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
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

  const rows = visibleMetrics().map((metric) => {
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
          <span class="metric-unit">${escapeHtml(companyMetricUnit(company, metric))}</span>
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
          ${targetDominantProduct ? `<span class="badge badge-dominant"><span>سبد غالب:</span> ${escapeHtml(targetDominantProduct)}</span>` : ""}
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
  const selectedActionsDisabled = count === 0 || busy;
  elements.sidebarSelectedCount.textContent = faInteger.format(count);
  elements.clearSelectionButton.disabled = selectedActionsDisabled;
  // Keep the actions clickable when nothing is selected so their handlers can
  // explain what is missing. During a running action they are truly disabled.
  elements.exportButton.disabled = busy;
  elements.updateSelectedButton.disabled = busy;
  elements.exportButton.setAttribute("aria-disabled", String(count === 0 || busy));
  elements.updateSelectedButton.setAttribute("aria-disabled", String(count === 0 || busy));
  elements.updateAllButton.disabled = busy;
  elements.recentDaysInput.disabled = busy;
  syncNativeActionForm();

  elements.exportButton.setAttribute(
    "aria-label",
    count ? `خروجی اکسل برای ${faInteger.format(count)} نماد` : "برای خروجی اکسل ابتدا نماد انتخاب کنید",
  );
  elements.updateSelectedButton.setAttribute(
    "aria-label",
    count ? `بروزرسانی ${faInteger.format(count)} نماد انتخاب‌شده` : "برای بروزرسانی ابتدا نماد انتخاب کنید",
  );
}

function syncNativeActionForm() {
  elements.dashboardActionsForm.replaceChildren();
  for (const symbol of state.selectedSymbols) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "symbols";
    input.value = symbol;
    elements.dashboardActionsForm.append(input);
  }
}

function toggleIndustry(key, checked) {
  const companies = key === ALL_INDUSTRIES_KEY
    ? allCompanies()
    : getIndustries().find((item, index) => industryKey(item, index) === key)?.companies;
  if (!companies) return;
  for (const company of companies) {
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
  if (state.tableView) {
    renderActiveIndustry();
    renderSelectionState();
    return;
  }
  const card = [...elements.dashboardContent.querySelectorAll("[data-company-symbol]")]
    .find((element) => element.dataset.companySymbol === symbol);
  if (card) {
    card.classList.toggle("selected", checked);
    const checkbox = card.querySelector("[data-company-checkbox]");
    if (checkbox) checkbox.checked = checked;
  }
  renderSelectionState();
}

function syncSelectionFromPage() {
  for (const checkbox of elements.dashboardContent.querySelectorAll("[data-company-checkbox]")) {
    const symbol = checkbox.dataset.companyCheckbox;
    if (!symbol) continue;
    if (checkbox.checked) state.selectedSymbols.add(symbol);
    else state.selectedSymbols.delete(symbol);
  }
  for (const checkbox of elements.industryList.querySelectorAll("[data-industry-checkbox]:checked")) {
    const key = checkbox.dataset.industryCheckbox;
    const industry = getIndustries().find((item, index) => industryKey(item, index) === key);
    for (const company of industry?.companies ?? []) {
      const symbol = companySymbol(company);
      if (symbol) state.selectedSymbols.add(symbol);
    }
  }
  renderSelectionState();
  return [...state.selectedSymbols];
}

function openUpdateDialog(scope) {
  if (scope === "selected") syncSelectionFromPage();
  if (scope === "selected" && !state.selectedSymbols.size) {
    showToast("ابتدا دست‌کم یک نماد را انتخاب کنید.", "error");
    return;
  }
  state.pendingUpdateScope = scope;
  const catalogCount = finiteNumber(state.dashboard?.metadata?.companyCatalogCount);
  const count = scope === "all" ? catalogCount : state.selectedSymbols.size;
  const initialLoad = !state.dashboard?.metadata?.hasData;
  const forceFullRefresh = state.dashboard?.metadata?.forceFullRefresh !== false;
  elements.dialogTitle.textContent = scope === "all" ? "آپدیت همه نمادها" : "آپدیت نمادهای انتخاب‌شده";
  elements.dialogDescription.textContent = scope === "all"
    ? initialLoad || forceFullRefresh
      ? `${count ? `گزارش‌های ${faInteger.format(count)} شرکت تولیدی` : "گزارش‌های تمام شرکت‌های تولیدی فعال"} ${initialLoad ? "برای بار نخست" : "به‌دلیل تغییر منطق سبد غالب، در این مرحله"} به‌طور کامل از کدال دریافت می‌شوند. میان پایان هر نماد و شروع نماد بعدی ۱۰ ثانیه فاصله خواهد بود.`
      : `فهرست اطلاعیه‌های ${count ? faInteger.format(count) : "تمام"} شرکت بررسی می‌شود و فقط گزارش‌های تازه یا اصلاحیه‌ها استخراج و ذخیره می‌شوند. نمادهای بدون تغییر دوباره دانلود نمی‌شوند.`
    : forceFullRefresh
      ? `تمام گزارش‌های موردنیاز ${faInteger.format(count)} نماد انتخاب‌شده دوباره از کدال دریافت، پردازش و در پایگاه داده ذخیره می‌شوند.`
      : `اطلاعیه‌های ${faInteger.format(count)} نماد انتخاب‌شده بررسی می‌شوند و فقط گزارش تازه یا اصلاحیه در پایگاه داده جایگزین خواهد شد.`;
  if (typeof elements.updateDialog.showModal === "function") {
    elements.updateDialog.returnValue = "";
    elements.updateDialog.showModal();
  }
  else performUpdate(scope);
}

function requestUpdate(scope) {
  if (scope === "selected") syncSelectionFromPage();
  if (scope === "selected" && !state.selectedSymbols.size) {
    showToast("ابتدا دست‌کم یک نماد را انتخاب کنید.", "error");
    return;
  }
  performUpdate(scope);
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
  const scan = finiteNumber(update?.recentDays);
  const matched = finiteNumber(update?.matchedCompanyCount) ?? 0;
  if (scan && !total && !matched) {
    return `در حال جست‌وجوی گزارش‌های ماهانه ${faInteger.format(scan)} روز اخیر در کدال…`;
  }
  const scanLabel = scan ? `بازه ${faInteger.format(scan)} روزه — ` : "";
  return `${scanLabel}در حال بروزرسانی ${progress}${symbol} — جدید ${faInteger.format(updated)}، بدون تغییر ${faInteger.format(unchanged)}`;
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
        const message = updateProgressMessage(update);
        elements.dashboardStatus.textContent = message;
        showToast(message, "busy", { persistent: true });
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
  const recentDays = scope === "all" ? Number(elements.recentDaysInput.value) : null;
  if (scope === "all" && (!Number.isInteger(recentDays) || recentDays < 1 || recentDays > 365)) {
    showToast("تعداد روزهای بررسی باید عددی صحیح بین ۱ تا ۳۶۵ باشد.", "error");
    elements.recentDaysInput.focus();
    return;
  }
  state.busyAction = "update";
  renderSelectionState();
  elements.dashboardContent.setAttribute("aria-busy", "true");
  showToast(
    scope === "all"
      ? `در حال جست‌وجوی گزارش‌های ماهانه ${faInteger.format(recentDays)} روز اخیر و تطبیق با شرکت‌های تولیدی…`
      : `در حال بررسی اطلاعیه‌های جدید و اطلاعات ناقص ${faInteger.format(symbols?.length ?? 0)} نماد انتخاب‌شده…`,
    "busy",
    { persistent: true },
  );
  monitorActiveUpdate();
  try {
    const response = await fetch("/api/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        scope,
        ...(symbols ? { symbols } : {}),
        ...(scope === "all" ? { recentDays } : {}),
      }),
    });
    if (!response.ok) throw new Error(await responseError(response));
    stopUpdateMonitor();
    const dashboard = await response.json();
    ingestDashboard(dashboard, { preserveSelection: true });
    const matched = finiteNumber(dashboard?.metadata?.update?.matchedCompanyCount);
    showToast(
      scope === "all" && matched === 0
        ? "در این بازه گزارش ماهانهٔ جدیدی برای شرکت‌های تولیدی پیدا نشد."
        : "اطلاعات با موفقیت بروزرسانی و ذخیره شد.",
      "success",
    );
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
  syncSelectionFromPage();
  if (!state.selectedSymbols.size) {
    showToast("ابتدا نمادهای موردنظر را انتخاب کنید.", "error");
    return;
  }
  state.busyAction = "export";
  renderSelectionState();
  showToast(
    `در حال آماده‌سازی خروجی اکسل برای ${faInteger.format(state.selectedSymbols.size)} نماد…`,
    "busy",
    { persistent: true },
  );
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
  const checkbox = event.target.closest("[data-industry-checkbox]");
  if (checkbox) {
    toggleIndustry(checkbox.dataset.industryCheckbox, checkbox.checked);
    return;
  }
  const button = event.target.closest("[data-industry-button]");
  if (!button) return;
  state.activeIndustryId = button.dataset.industryButton;
  state.searchQuery = "";
  elements.companySearch.value = "";
  renderIndustryList();
  renderActiveIndustry();
  if (window.matchMedia("(max-width: 920px)").matches) setDrawer(false);
});

elements.industryList.addEventListener("input", (event) => {
  const checkbox = event.target.closest("[data-industry-checkbox]");
  if (checkbox) toggleIndustry(checkbox.dataset.industryCheckbox, checkbox.checked);
});

elements.dashboardContent.addEventListener("input", (event) => {
  const checkbox = event.target.closest("[data-company-checkbox]");
  if (checkbox) toggleCompany(checkbox.dataset.companyCheckbox, checkbox.checked);
});

elements.dashboardContent.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="retry"]')) {
    loadDashboard();
    return;
  }
  const checkbox = event.target.closest("[data-company-checkbox]");
  if (checkbox) {
    toggleCompany(checkbox.dataset.companyCheckbox, checkbox.checked);
    return;
  }
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

function renderMetricVisibilityState() {
  elements.metricVisibilityMenu.querySelectorAll("[data-metric-visibility]").forEach((checkbox) => {
    checkbox.checked = state.visibleMetricKeys.has(checkbox.dataset.metricVisibility);
  });
}

function renderSortColumnOptions() {
  const sample = allCompanies()[0];
  for (const column of GROWTH_COLUMNS) {
    const option = elements.sortColumn.querySelector(`option[value="${column.key}"]`);
    if (option) option.textContent = definitionLabel(sample, column, true);
  }
  elements.sortColumn.value = state.sortColumn;
}

elements.metricVisibilityMenu.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-metric-visibility]");
  if (!checkbox) return;
  const metricKey = checkbox.dataset.metricVisibility;
  if (checkbox.checked) {
    state.visibleMetricKeys.add(metricKey);
  } else if (state.visibleMetricKeys.size > 1) {
    state.visibleMetricKeys.delete(metricKey);
  } else {
    checkbox.checked = true;
    showToast("حداقل یک ردیف باید نمایش داده شود.", "warning");
  }
  renderMetricVisibilityState();
  renderActiveIndustry();
});

elements.sortMetric.addEventListener("change", () => {
  state.sortMetric = elements.sortMetric.value;
  setSortDirection(null);
  renderActiveIndustry();
});

elements.sortColumn.addEventListener("change", () => {
  state.sortColumn = elements.sortColumn.value;
  setSortDirection(null);
  renderActiveIndustry();
});

function setSortDirection(direction) {
  state.sortDirection = direction;
  elements.sortAscendingButton.classList.toggle("active", state.sortDirection === "asc");
  elements.sortDescendingButton.classList.toggle("active", state.sortDirection === "desc");
  elements.sortAscendingButton.setAttribute("aria-pressed", String(state.sortDirection === "asc"));
  elements.sortDescendingButton.setAttribute("aria-pressed", String(state.sortDirection === "desc"));
}

function toggleSortDirection(direction) {
  setSortDirection(state.sortDirection === direction ? null : direction);
  renderActiveIndustry();
}

elements.sortAscendingButton.addEventListener("click", () => toggleSortDirection("asc"));
elements.sortDescendingButton.addEventListener("click", () => toggleSortDirection("desc"));

elements.tableViewToggle.addEventListener("change", () => {
  state.tableView = elements.tableViewToggle.checked;
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

elements.updateDialog.addEventListener("close", () => {
  if (elements.updateDialog.returnValue === "confirm" && state.pendingUpdateScope) {
    performUpdate(state.pendingUpdateScope);
  }
  state.pendingUpdateScope = null;
});

renderMetricVisibilityState();
loadDashboard();
