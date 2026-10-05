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
  { key: "dominantProduction", label: "مجموع تولید", unit: "واحد محصول" },
  { key: "dominantSales", label: "مجموع فروش", unit: "واحد محصول" },
  { key: "dominantRevenue", label: "مجموع مبلغ فروش", unit: "میلیون ریال" },
  { key: "dominantRate", label: "نرخ فروش کل", unit: "ریال / واحد" },
]);

const JALALI_MONTHS = Object.freeze([
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
]);

const ALL_INDUSTRIES_KEY = "__all__";
const BROCHURE_CANVAS_WIDTH = 2160;
const BROCHURE_MIN_CANVAS_HEIGHT = 1800;
const BROCHURE_ROW_HEIGHT = 57;
const BROCHURE_LOGO_URL = "/Logo.png";

let brochureLogoImage = null;
let brochureLogoPromise = null;

const state = {
  dashboard: null,
  activeIndustryId: null,
  selectedSymbols: new Set(),
  expandedSymbols: new Set(),
  searchQuery: "",
  sortMetric: "dominantRevenue",
  sortColumn: null,
  sortDirection: null,
  sortByUpdatedAt: false,
  visibleMetricKeys: new Set(METRICS.map((metric) => metric.key)),
  tableView: false,
  latestMonthOnly: false,
  busyAction: null,
  pendingUpdateScope: null,
  toastTimer: null,
  updatePollTimer: null,
  brochureIndustryId: null,
  brochureIndustrySearch: "",
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
  sortLatestUpdateButton: document.querySelector("#sortLatestUpdateButton"),
  tableViewToggle: document.querySelector("#tableViewToggle"),
  latestMonthOnlyToggle: document.querySelector("#latestMonthOnlyToggle"),
  latestMonthOnlyLabel: document.querySelector("#latestMonthOnlyLabel"),
  dashboardContent: document.querySelector("#dashboardContent"),
  dashboardActionsForm: document.querySelector("#dashboardActionsForm"),
  incompleteButton: document.querySelector("#incompleteButton"),
  incompleteButtonCount: document.querySelector("#incompleteButtonCount"),
  incompleteDialog: document.querySelector("#incompleteDialog"),
  incompleteDialogDescription: document.querySelector("#incompleteDialogDescription"),
  incompleteList: document.querySelector("#incompleteList"),
  brochureButton: document.querySelector("#brochureButton"),
  brochureDialog: document.querySelector("#brochureDialog"),
  brochureCloseButton: document.querySelector("#brochureCloseButton"),
  brochureCancelButton: document.querySelector("#brochureCancelButton"),
  brochureIndustrySearch: document.querySelector("#brochureIndustrySearch"),
  brochureIndustryList: document.querySelector("#brochureIndustryList"),
  brochureSelectionTitle: document.querySelector("#brochureSelectionTitle"),
  brochureSelectionMeta: document.querySelector("#brochureSelectionMeta"),
  brochureDownloadButton: document.querySelector("#brochureDownloadButton"),
  brochureDownloadLabel: document.querySelector("#brochureDownloadLabel"),
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
elements.brochureButton.onclick = () => openBrochureDialog();
elements.brochureCloseButton.onclick = () => elements.brochureDialog.close();
elements.brochureCancelButton.onclick = () => elements.brochureDialog.close();
elements.brochureDownloadButton.onclick = () => downloadBrochureImage();
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
const faBrochureNumber = new Intl.NumberFormat("fa-IR", {
  minimumFractionDigits: 0,
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

function codalSymbolLink(symbol) {
  if (!symbol) return "";
  const href = `https://www.codal.ir/ReportList.aspx?search&Symbol=${encodeURIComponent(symbol)}`;
  return `
    <a
      class="codal-symbol-link"
      data-codal-symbol-link
      href="${escapeHtml(href)}"
      target="_blank"
      rel="noopener noreferrer"
      title="نمایش اطلاعیه‌های ${escapeHtml(symbol)} در کدال"
      aria-label="بازکردن صفحه کدال نماد ${escapeHtml(symbol)}"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M14 5h5v5M19 5l-8 8"></path>
        <path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path>
      </svg>
    </a>
  `;
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
  renderLatestMonthFilterState();
  renderActiveIndustry();
  renderSelectionState();
  elements.appShell.setAttribute("aria-busy", "false");
}

function validJalaliMonth(value) {
  const year = Number(value?.year);
  const month = Number(value?.month);
  return Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12
    ? { year, month }
    : null;
}

function previousJalaliMonth(value) {
  const month = validJalaliMonth(value);
  if (!month) return null;
  return month.month === 1
    ? { year: month.year - 1, month: 12 }
    : { year: month.year, month: month.month - 1 };
}

function expectedLatestReportMonth() {
  const metadata = state.dashboard?.metadata ?? {};
  const scheduled = validJalaliMonth(metadata.scheduledTargetMonth);
  if (scheduled) return scheduled;

  const asOfMatch = String(metadata.asOf ?? "").match(/^(\d{4})[/-](\d{1,2})/);
  if (asOfMatch) {
    return previousJalaliMonth({ year: Number(asOfMatch[1]), month: Number(asOfMatch[2]) });
  }

  const execution = validJalaliMonth(metadata.executionMonth);
  return previousJalaliMonth(execution) ?? validJalaliMonth(metadata.targetMonth);
}

function companyHasReportForMonth(company, targetMonth) {
  if (!targetMonth) return false;
  const reportMonths = (company?.monthlyReports ?? [])
    .map((report) => validJalaliMonth(report))
    .filter(Boolean)
    .sort((left, right) => right.year - left.year || right.month - left.month);
  const latest = reportMonths[0]
    ?? validJalaliMonth(company?.effectiveTargetMonth)
    ?? validJalaliMonth(company?.definitions?.targetMonth);
  return latest?.year === targetMonth.year && latest?.month === targetMonth.month;
}

function renderLatestMonthFilterState() {
  const targetMonth = expectedLatestReportMonth();
  elements.latestMonthOnlyToggle.checked = state.latestMonthOnly;
  elements.latestMonthOnlyLabel.textContent = targetMonth
    ? `فقط دارای گزارش ${formatJalaliMonth(targetMonth)}`
    : "فقط دارای گزارش آخرین ماه";
}

function renderMetadata() {
  const metadata = state.dashboard?.metadata ?? {};
  const industries = getIndustries();
  const companies = industries.flatMap((industry) => industry.companies ?? []);
  const complete = companies.filter((company) => statusTone(company.status) === "complete").length;
  const incomplete = companies.filter((company) => (
    missingDisplayedValueCount(company) > 0 || hasUnitMismatch(company)
  )).length;

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

function hasUnitMismatch(company) {
  if (company?.unitMismatch === true) return true;
  return PERIOD_COLUMNS.some((column) => {
    const period = company?.periods?.[column.key];
    return period?.unitMismatch === true
      || (period?.unitsCompatible === false && (finiteNumber(period?.reportCount) ?? 0) > 0);
  });
}

function incompleteCompanies() {
  return getIndustries()
    .flatMap((industry) => (industry.companies ?? []).map((company) => {
      const unitMismatch = hasUnitMismatch(company);
      return {
        company,
        industryName: industry.industryName || "صنعت نامشخص",
        missingCount: unitMismatch ? 0 : missingDisplayedValueCount(company),
        unitMismatch,
      };
    }))
    .filter((item) => item.missingCount > 0 || item.unitMismatch)
    .sort((left, right) => companySymbol(left.company).localeCompare(companySymbol(right.company), "fa"));
}

function openIncompleteDialog() {
  const companies = incompleteCompanies();
  const unitMismatchCount = companies.filter((item) => item.unitMismatch).length;
  const missingCellCompanyCount = companies.filter((item) => item.missingCount > 0).length;
  const missingCellCount = companies.reduce((sum, item) => sum + item.missingCount, 0);
  elements.incompleteDialogDescription.textContent = companies.length
    ? `از مجموع ${faInteger.format(companies.length)} نماد نیازمند بررسی، ${faInteger.format(unitMismatchCount)} نماد عدم تطابق واحد و ${faInteger.format(missingCellCompanyCount)} نماد سلول ناقص دارند؛ در مجموع ${faInteger.format(missingCellCount)} سلول خالی در گروه دوم ثبت شده است.`
    : "هیچ نماد ناقصی در جدول تحلیلی پیدا نشد.";
  elements.incompleteList.innerHTML = companies.length
    ? companies.map(({ company, industryName, missingCount, unitMismatch }) => `
        <div class="incomplete-item">
          <strong class="incomplete-symbol">${escapeHtml(companySymbol(company) || "—")}</strong>
          <span class="incomplete-name" title="${escapeHtml(company.name || industryName)}">${escapeHtml(company.name || industryName)}</span>
          <span class="incomplete-reasons">
            ${missingCount ? `<span class="incomplete-reason-tag incomplete-missing-count">${faInteger.format(missingCount)} سلول ناقص</span>` : ""}
            ${unitMismatch ? '<span class="incomplete-reason-tag">عدم تطابق واحد</span>' : ""}
          </span>
        </div>
      `).join("")
    : '<div class="incomplete-empty">اطلاعات همه نمادهای موجود کامل است.</div>';
  if (typeof elements.incompleteDialog.showModal === "function") {
    elements.incompleteDialog.showModal();
  } else {
    elements.incompleteDialog.setAttribute("open", "");
  }
}

function activeBrochureIndustry() {
  return getIndustries().find((industry, index) => (
    industryKey(industry, index) === state.brochureIndustryId
  )) ?? null;
}

function brochureMetric(company, path, metricKey = "dominantRevenue") {
  const source = path === "period"
    ? company?.periods?.target?.metrics
    : path === "currentYtd"
      ? company?.periods?.currentYtd?.metrics
      : company?.growth?.[path];
  return finiteNumber(source?.[metricKey]);
}

function jalaliMonthIndex(value) {
  const month = validJalaliMonth(value);
  return month ? month.year * 12 + month.month - 1 : null;
}

function latestCompanyReportMonth(company) {
  const reports = (company?.monthlyReports ?? [])
    .map((report) => validJalaliMonth(report))
    .filter(Boolean)
    .sort((left, right) => jalaliMonthIndex(right) - jalaliMonthIndex(left));
  return reports[0]
    ?? validJalaliMonth(company?.effectiveTargetMonth)
    ?? validJalaliMonth(company?.definitions?.targetMonth)
    ?? null;
}

function brochureReportState(company, expectedMonth) {
  const latest = latestCompanyReportMonth(company);
  const expectedIndex = jalaliMonthIndex(expectedMonth);
  const latestIndex = jalaliMonthIndex(latest);
  if (latestIndex === null) return { tone: "older", label: "بدون گزارش", month: null };
  if (expectedIndex === null || latestIndex >= expectedIndex) {
    return { tone: "latest", label: "گزارش به‌روز", month: latest };
  }
  const distance = expectedIndex - latestIndex;
  return {
    tone: distance === 1 ? "previous" : "older",
    label: `گزارش ${JALALI_MONTHS[latest.month - 1]}`,
    month: latest,
  };
}

function brochureModel(industry = activeBrochureIndustry()) {
  const expectedMonth = expectedLatestReportMonth()
    ?? validJalaliMonth(state.dashboard?.metadata?.targetMonth);
  const allCompanies = Array.isArray(industry?.companies) ? industry.companies : [];
  const companies = [...allCompanies].sort((left, right) => {
    const leftRevenue = brochureMetric(left, "period");
    const rightRevenue = brochureMetric(right, "period");
    if (leftRevenue === null && rightRevenue !== null) return 1;
    if (leftRevenue !== null && rightRevenue === null) return -1;
    if (leftRevenue !== rightRevenue) return (rightRevenue ?? 0) - (leftRevenue ?? 0);
    return companySymbol(left).localeCompare(companySymbol(right), "fa");
  });
  const totalRevenue = companies.reduce((sum, company) => (
    sum + (brochureMetric(company, "period") ?? 0)
  ), 0);
  const rows = companies.map((company, index) => {
    const revenue = brochureMetric(company, "period");
    return {
      rank: index + 1,
      symbol: companySymbol(company) || "—",
      report: brochureReportState(company, expectedMonth),
      revenue,
      share: revenue !== null && totalRevenue > 0 ? revenue / totalRevenue : null,
      monthlyGrowth: brochureMetric(company, "targetMoM"),
      annualGrowth: brochureMetric(company, "targetYoY"),
      salesGrowth: brochureMetric(company, "targetYoY", "dominantSales"),
      rateGrowth: brochureMetric(company, "targetYoY", "dominantRate"),
      ytdAverage: brochureMetric(company, "currentYtd"),
      ytdGrowth: brochureMetric(company, "ytdYoY"),
    };
  });
  return {
    industryName: industry?.industryName || "صنعت انتخاب‌نشده",
    expectedMonth,
    rows,
    currentCount: rows.filter((row) => row.report.tone === "latest").length,
    totalCompanyCount: allCompanies.length,
  };
}

function renderBrochureIndustryList() {
  const query = normalizeText(state.brochureIndustrySearch);
  const industries = getIndustries().map((industry, index) => ({
    industry,
    key: industryKey(industry, index),
  })).filter(({ industry }) => (
    !query || normalizeText(industry.industryName).includes(query)
  ));
  elements.brochureIndustryList.innerHTML = industries.length
    ? industries.map(({ industry, key }) => {
      const companies = industry.companies ?? [];
      const selected = key === state.brochureIndustryId;
      const expected = expectedLatestReportMonth();
      const latestCount = companies.filter((company) => companyHasReportForMonth(company, expected)).length;
      return `
        <button
          class="brochure-industry-option${selected ? " selected" : ""}"
          type="button"
          role="option"
          aria-selected="${selected}"
          data-brochure-industry="${escapeHtml(key)}"
        >
          <span class="brochure-industry-check" aria-hidden="true">${selected ? "✓" : "›"}</span>
          <span>
            <strong>${escapeHtml(industry.industryName || "صنعت بدون نام")}</strong>
            <small>${faInteger.format(companies.length)} نماد • ${faInteger.format(latestCount)} گزارش به‌روز</small>
          </span>
        </button>
      `;
    }).join("")
    : '<p class="brochure-picker-empty">صنعتی با این عبارت پیدا نشد.</p>';
}

function brochureRoundRect(context, x, y, width, height, radius) {
  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
}

function brochureFont(weight, size) {
  return `${weight} ${size}px "Sahel", Tahoma, Arial, sans-serif`;
}

function fitBrochureText(context, value, maxWidth) {
  const text = String(value ?? "");
  if (context.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

function drawBrochureText(context, value, x, y, {
  color = "#f6f8fb",
  font = brochureFont(500, 25),
  align = "right",
  maxWidth,
} = {}) {
  context.save();
  context.direction = "rtl";
  context.textAlign = align;
  context.textBaseline = "middle";
  context.fillStyle = color;
  context.font = font;
  const text = maxWidth ? fitBrochureText(context, value, maxWidth) : String(value ?? "");
  context.fillText(text, x, y);
  context.restore();
}

function drawBrochureLines(context, lines, x, centerY, options = {}) {
  const lineHeight = options.lineHeight ?? 32;
  const startY = centerY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => drawBrochureText(context, line, x, startY + index * lineHeight, options));
}

function formatBrochureAmount(value) {
  const number = finiteNumber(value);
  return number === null ? "—" : faBrochureNumber.format(number / 10_000);
}

function formatBrochureGrowth(value) {
  const number = finiteNumber(value);
  if (number === null) return { text: "—", color: "#8fa1b8" };
  if (number === 0) return { text: "۰٪", color: "#aab8c9" };
  return {
    text: `${number > 0 ? "▲" : "▼"} ${faPercent.format(Math.abs(number))}`,
    color: number > 0 ? "#42d990" : "#ff7785",
  };
}

function loadBrochureLogo() {
  if (brochureLogoImage?.complete && brochureLogoImage.naturalWidth) {
    return Promise.resolve(brochureLogoImage);
  }
  if (brochureLogoPromise) return brochureLogoPromise;
  brochureLogoPromise = new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      brochureLogoImage = image;
      resolve(image);
    };
    image.onerror = () => resolve(null);
    image.src = BROCHURE_LOGO_URL;
  });
  return brochureLogoPromise;
}

function drawBrochureLogo(context) {
  const panel = { x: 1966, y: 20, width: 126, height: 160 };
  context.save();
  context.shadowColor = "rgba(85, 203, 232, 0.2)";
  context.shadowBlur = 26;
  brochureRoundRect(context, panel.x, panel.y, panel.width, panel.height, 26);
  const panelGradient = context.createLinearGradient(panel.x, panel.y, panel.x, panel.y + panel.height);
  panelGradient.addColorStop(0, "#f4fcff");
  panelGradient.addColorStop(1, "#d9f2f9");
  context.fillStyle = panelGradient;
  context.fill();
  context.shadowColor = "transparent";
  context.strokeStyle = "rgba(126, 205, 226, 0.82)";
  context.lineWidth = 2;
  context.stroke();

  if (brochureLogoImage?.complete && brochureLogoImage.naturalWidth) {
    const availableWidth = panel.width - 20;
    const availableHeight = panel.height - 18;
    const scale = Math.min(
      availableWidth / brochureLogoImage.naturalWidth,
      availableHeight / brochureLogoImage.naturalHeight,
    );
    const width = brochureLogoImage.naturalWidth * scale;
    const height = brochureLogoImage.naturalHeight * scale;
    context.drawImage(
      brochureLogoImage,
      panel.x + (panel.width - width) / 2,
      panel.y + (panel.height - height) / 2,
      width,
      height,
    );
  } else {
    context.fillStyle = "#313b78";
    context.beginPath();
    context.arc(panel.x + panel.width / 2, panel.y + panel.height / 2, 34, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawBrochureStatus(context, row, column, centerY) {
  if (row.report.tone === "latest") {
    context.beginPath();
    context.arc(column.left + 22, centerY, 7, 0, Math.PI * 2);
    context.fillStyle = "#42d990";
    context.fill();
    return;
  }
  const fill = row.report.tone === "previous" ? "#39280c" : "#3b1820";
  const stroke = row.report.tone === "previous" ? "#b77a10" : "#c94a5b";
  const color = row.report.tone === "previous" ? "#ffc044" : "#ff8390";
  brochureRoundRect(context, column.left + 12, centerY - 19, 120, 38, 10);
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = 1.5;
  context.stroke();
  drawBrochureText(context, row.report.label, column.left + 72, centerY, {
    align: "center",
    color,
    font: brochureFont(700, 18),
    maxWidth: 106,
  });
}

function brochureCanvasHeight(rowCount) {
  return Math.max(BROCHURE_MIN_CANVAS_HEIGHT, 774 + Math.max(rowCount, 1) * BROCHURE_ROW_HEIGHT);
}

function drawBrochureImage(canvas, model) {
  canvas.width = BROCHURE_CANVAS_WIDTH;
  canvas.height = brochureCanvasHeight(model.rows.length);
  const context = canvas.getContext("2d");
  context.direction = "rtl";
  context.fillStyle = "#0a1426";
  context.fillRect(0, 0, canvas.width, canvas.height);

  drawBrochureLogo(context);
  drawBrochureText(context, `گروه ${model.industryName}`, 1940, 82, {
    font: brochureFont(900, 56),
    color: "#f7f8fb",
    maxWidth: 1400,
  });
  const monthLabel = formatJalaliMonth(model.expectedMonth);
  const freshness = model.rows.length
    ? `${faInteger.format(model.currentCount)} از ${faInteger.format(model.rows.length)} نماد گزارش ${monthLabel} را منتشر کرده‌اند`
    : `هنوز گزارشی برای ${monthLabel} ثبت نشده است`;
  drawBrochureText(context, freshness, 1940, 139, {
    font: brochureFont(700, 27),
    color: model.currentCount === model.rows.length ? "#42d990" : "#f4bd62",
    maxWidth: 1450,
  });
  drawBrochureText(context, monthLabel, 76, 79, {
    align: "left",
    font: brochureFont(900, 42),
    color: "#ffbd24",
  });
  drawBrochureText(context, `${faInteger.format(model.rows.length)} نماد`, 76, 132, {
    align: "left",
    font: brochureFont(600, 22),
    color: "#9fb0c5",
  });
  const separator = context.createLinearGradient(0, 0, canvas.width, 0);
  separator.addColorStop(0, "#398cf4");
  separator.addColorStop(0.52, "#9f7cc9");
  separator.addColorStop(1, "#f06331");
  context.fillStyle = separator;
  context.fillRect(0, 196, canvas.width, 7);

  brochureRoundRect(context, 68, 236, 2024, canvas.height - 405, 28);
  context.fillStyle = "#101d31";
  context.fill();
  context.strokeStyle = "#293b55";
  context.lineWidth = 2;
  context.stroke();
  drawBrochureText(context, "همه نمادهای گروه به ترتیب مبلغ فروش آخرین گزارش", 2038, 287, {
    font: brochureFont(800, 32),
  });
  drawBrochureText(context, "مبالغ به میلیارد تومان", 2038, 329, {
    font: brochureFont(500, 21),
    color: "#9fb0c5",
  });

  const columnWidths = [80, 250, 190, 200, 200, 200, 200, 200, 230, 200];
  const columnLabels = [
    ["رتبه"], ["نماد"], ["مبلغ فروش", "میلیارد تومان"], ["سهم از صنعت", "از مبالغ نمایش‌داده‌شده"],
    ["رشد ماهانه مبلغ", "نسبت به ماه قبل"], ["رشد سالانه مبلغ", "نسبت به ماه مشابه"],
    ["رشد مقدار فروش", "نسبت به ماه مشابه"], ["رشد نرخ فروش", "نسبت به ماه مشابه"],
    ["میانگین مبلغ فروش", "سال مالی تا ماه گزارش"], ["رشد دوره مالی", "نسبت به دوره مشابه"],
  ];
  let right = 2040;
  const columns = columnWidths.map((width, index) => {
    const column = { index, width, right, left: right - width, center: right - width / 2 };
    right -= width;
    return column;
  });
  const groupY = 368;
  const groupHeight = 58;
  const headerY = groupY + groupHeight;
  const headerHeight = 126;
  const headerBottom = headerY + headerHeight;
  const mergedHeaderHeight = groupHeight + headerHeight;
  context.fillStyle = "#23334f";
  context.fillRect(columns[7].left, groupY, columns[2].right - columns[7].left, groupHeight);
  context.fillStyle = "#1c2b45";
  context.fillRect(columns[9].left, groupY, columns[8].right - columns[9].left, groupHeight);
  drawBrochureText(context, `عملکرد فروش ${monthLabel}`, (columns[2].right + columns[7].left) / 2, groupY + groupHeight / 2, {
    align: "center", font: brochureFont(800, 28),
  });
  drawBrochureText(context, `میانگین سال مالی تا ${monthLabel}`, (columns[8].right + columns[9].left) / 2, groupY + groupHeight / 2, {
    align: "center", font: brochureFont(800, 25),
  });
  context.fillStyle = "#1e304a";
  context.fillRect(columns[0].left, groupY, columns[0].width, mergedHeaderHeight);
  context.fillStyle = "#192942";
  context.fillRect(columns[1].left, groupY, columns[1].width, mergedHeaderHeight);
  [0, 1].forEach((index) => {
    const column = columns[index];
    drawBrochureLines(context, columnLabels[index], column.center, groupY + mergedHeaderHeight / 2, {
      align: "center",
      color: "#f1f5fa",
      font: brochureFont(700, 22),
      lineHeight: 32,
      maxWidth: column.width - 18,
    });
  });

  context.fillStyle = "#1a2941";
  context.fillRect(columns[9].left, headerY, columns[2].right - columns[9].left, headerHeight);
  columns.slice(2).forEach((column, offset) => {
    const index = offset + 2;
    if (index % 2 === 1) {
      context.fillStyle = "rgba(83, 119, 164, 0.08)";
      context.fillRect(column.left, headerY, column.width, headerHeight);
    }
    drawBrochureLines(context, columnLabels[index], column.center, headerY + headerHeight / 2, {
      align: "center",
      color: index < 2 ? "#f1f5fa" : "#d5dfeb",
      font: brochureFont(700, index === 3 ? 19 : 22),
      lineHeight: 32,
      maxWidth: column.width - 18,
    });
  });

  context.strokeStyle = "#344966";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(columns[9].left, headerY);
  context.lineTo(columns[2].right, headerY);
  context.stroke();

  columns.slice(2).forEach((column, offset) => {
    const index = offset + 2;
    if (index === 7 || index === 9) return;
    context.strokeStyle = "#344966";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(column.left, headerY);
    context.lineTo(column.left, headerBottom);
    context.stroke();
  });
  [
    { x: columns[0].right, width: 2, color: "#3d526f" },
    { x: columns[0].left, width: 2, color: "#344966" },
    { x: columns[1].left, width: 4, color: "#58708f" },
    { x: columns[7].left, width: 4, color: "#58708f" },
    { x: columns[9].left, width: 2, color: "#3d526f" },
  ].forEach((separatorLine) => {
    context.strokeStyle = separatorLine.color;
    context.lineWidth = separatorLine.width;
    context.beginPath();
    context.moveTo(separatorLine.x, groupY);
    context.lineTo(separatorLine.x, headerBottom);
    context.stroke();
  });

  const imageRows = model.rows;
  const rowHeight = BROCHURE_ROW_HEIGHT;
  const rowStart = headerY + headerHeight;
  imageRows.forEach((row, rowIndex) => {
    const y = rowStart + rowIndex * rowHeight;
    const centerY = y + rowHeight / 2;
    context.fillStyle = rowIndex % 2 === 0 ? "#111f34" : "#14243a";
    context.fillRect(columns[9].left, y, columns[0].right - columns[9].left, rowHeight);
    columns.forEach((column, columnIndex) => {
      if (columnIndex % 2 === 1) {
        context.fillStyle = "rgba(80, 117, 163, 0.055)";
        context.fillRect(column.left, y, column.width, rowHeight);
      }
      const isSectionBoundary = columnIndex === 1 || columnIndex === 7;
      context.strokeStyle = isSectionBoundary ? "#4d6686" : "#2e425d";
      context.lineWidth = isSectionBoundary ? 4 : 2;
      context.beginPath();
      context.moveTo(column.left, y);
      context.lineTo(column.left, y + rowHeight);
      context.stroke();
    });
    context.strokeStyle = "#26364e";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(columns[9].left, y + rowHeight);
    context.lineTo(columns[0].right, y + rowHeight);
    context.stroke();

    drawBrochureText(context, faInteger.format(row.rank), columns[0].center, centerY, {
      align: "center", font: brochureFont(700, 24),
    });
    drawBrochureText(context, row.symbol, columns[1].right - 14, centerY, {
      font: brochureFont(900, 25), maxWidth: 102,
    });
    drawBrochureStatus(context, row, columns[1], centerY);
    drawBrochureText(context, formatBrochureAmount(row.revenue), columns[2].center, centerY, {
      align: "center", font: brochureFont(700, 24),
    });
    const shareText = row.share === null ? "—" : faPercent.format(row.share);
    drawBrochureText(context, shareText, columns[3].right - 14, centerY, {
      font: brochureFont(700, 21), maxWidth: 66,
    });
    if (row.share !== null) {
      const barX = columns[3].left + 14;
      const barWidth = 104;
      brochureRoundRect(context, barX, centerY - 7, barWidth, 14, 7);
      context.fillStyle = "#243b5d";
      context.fill();
      brochureRoundRect(context, barX, centerY - 7, Math.max(4, barWidth * row.share), 14, 7);
      context.fillStyle = "#3f7ac1";
      context.fill();
    }
    [row.monthlyGrowth, row.annualGrowth, row.salesGrowth, row.rateGrowth].forEach((value, valueIndex) => {
      const display = formatBrochureGrowth(value);
      drawBrochureText(context, display.text, columns[4 + valueIndex].center, centerY, {
        align: "center", color: display.color, font: brochureFont(700, 23),
      });
    });
    drawBrochureText(context, formatBrochureAmount(row.ytdAverage), columns[8].center, centerY, {
      align: "center", font: brochureFont(700, 24),
    });
    const ytdDisplay = formatBrochureGrowth(row.ytdGrowth);
    drawBrochureText(context, ytdDisplay.text, columns[9].center, centerY, {
      align: "center", color: ytdDisplay.color, font: brochureFont(700, 23),
    });
  });

  const tableBottom = rowStart + Math.max(imageRows.length, 1) * rowHeight;
  [
    { x: columns[0].right, width: 2, color: "#3d526f" },
    { x: columns[1].left, width: 4, color: "#58708f" },
    { x: columns[7].left, width: 4, color: "#58708f" },
    { x: columns[9].left, width: 2, color: "#3d526f" },
  ].forEach((separatorLine) => {
    context.strokeStyle = separatorLine.color;
    context.lineWidth = separatorLine.width;
    context.beginPath();
    context.moveTo(separatorLine.x, groupY);
    context.lineTo(separatorLine.x, tableBottom);
    context.stroke();
  });

  if (!imageRows.length) {
    drawBrochureText(context, "داده‌ای برای نمایش در این صنعت وجود ندارد", canvas.width / 2, 960, {
      align: "center", color: "#8fa1b8", font: brochureFont(700, 34),
    });
  }
  const footerY = canvas.height - 75;
  drawBrochureText(context, `منبع: سامانه کدال — گزارش‌های فعالیت ماهانه ${monthLabel}`, 2080, footerY, {
    font: brochureFont(600, 24), color: "#a7b6c8",
  });
  drawBrochureText(context, "دیده‌بان کدال", 72, footerY, {
    align: "left", font: brochureFont(800, 26), color: "#40d9c8",
  });
  return canvas;
}

function renderBrochureSelection() {
  const industry = activeBrochureIndustry();
  const model = brochureModel(industry);
  elements.brochureSelectionTitle.textContent = model.industryName;
  elements.brochureSelectionMeta.textContent = `${faInteger.format(model.rows.length)} نماد در یک تصویر • ${faInteger.format(model.currentCount)} گزارش ${formatJalaliMonth(model.expectedMonth)}`;
  elements.brochureDownloadButton.disabled = model.rows.length === 0;
  elements.brochureDownloadLabel.textContent = "دانلود تصویر کامل";
}

function brochureAssetsReady() {
  const fontReady = document.fonts?.load
    ? Promise.race([
      Promise.allSettled([
        document.fonts.load('700 24px "Sahel"'),
        document.fonts.load('900 42px "Sahel"'),
      ]),
      new Promise((resolve) => window.setTimeout(resolve, 1_500)),
    ])
    : Promise.resolve();
  return Promise.all([fontReady, loadBrochureLogo()]);
}

function openBrochureDialog() {
  const industries = getIndustries();
  if (!industries.length) {
    showToast("هنوز صنعتی برای ساخت بروشور در پایگاه داده وجود ندارد.", "error");
    return;
  }
  const activeExists = state.activeIndustryId !== ALL_INDUSTRIES_KEY
    && industries.some((industry, index) => industryKey(industry, index) === state.activeIndustryId);
  if (!state.brochureIndustryId) {
    state.brochureIndustryId = activeExists ? state.activeIndustryId : industryKey(industries[0], 0);
  }
  state.brochureIndustrySearch = "";
  elements.brochureIndustrySearch.value = "";
  renderBrochureIndustryList();
  renderBrochureSelection();
  void brochureAssetsReady();
  if (typeof elements.brochureDialog.showModal === "function") {
    elements.brochureDialog.showModal();
  } else {
    elements.brochureDialog.setAttribute("open", "");
  }
}

function safeBrochureFilename(value) {
  return String(value ?? "brochure").replace(/[\\/:*?"<>|]/g, "-").trim() || "brochure";
}

async function downloadBrochureImage() {
  const model = brochureModel();
  if (!model.rows.length) return;
  elements.brochureDownloadButton.disabled = true;
  elements.brochureDownloadLabel.textContent = "در حال ساخت تصویر…";
  try {
    await brochureAssetsReady();
    const month = formatJalaliMonth(model.expectedMonth).replaceAll(" ", "-");
    const industry = safeBrochureFilename(model.industryName);
    const canvas = document.createElement("canvas");
    drawBrochureImage(canvas, model);
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${industry}-${month}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    showToast(`تصویر کامل بروشور با ${faInteger.format(model.rows.length)} نماد دانلود شد.`, "success");
  } catch (error) {
    showToast(error?.message || "ساخت تصویر بروشور ناموفق بود.", "error");
  } finally {
    renderBrochureSelection();
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
  const targetMonth = expectedLatestReportMonth();
  const latestMonthCompanies = state.latestMonthOnly
    ? filteredCompanies.filter((company) => companyHasReportForMonth(company, targetMonth))
    : filteredCompanies;
  const visibleCompanies = sortCompanies(latestMonthCompanies);

  elements.activeIndustryTitle.textContent = query
    ? "نتایج جست‌وجو در همه صنایع"
    : showingAll ? "همه نمادها" : industry?.industryName || "صنعت بدون نام";
  elements.activeIndustryCompanyCount.textContent = query || state.latestMonthOnly
    ? `${faInteger.format(visibleCompanies.length)} نتیجه`
    : `${faInteger.format(industryCompanies.length)} شرکت`;

  if (!visibleCompanies.length) {
    elements.dashboardContent.innerHTML = `
      <div class="empty-state">
        <strong>${state.latestMonthOnly ? `نمادی با گزارش ${escapeHtml(formatJalaliMonth(targetMonth))} پیدا نشد` : query ? "شرکتی با این عبارت پیدا نشد" : "این صنعت هنوز شرکتی ندارد"}</strong>
        <p>${state.latestMonthOnly ? "با انتشار و بروزرسانی گزارش ماهانه، نمادها در این فهرست نمایش داده می‌شوند." : query ? "نام شرکت یا نماد را با عبارت دیگری جست‌وجو کنید." : "پس از بروزرسانی داده‌ها، شرکت‌های این صنعت نمایش داده می‌شوند."}</p>
      </div>
    `;
    return;
  }

  elements.dashboardContent.innerHTML = state.tableView
    ? renderUnifiedTable(visibleCompanies)
    : visibleCompanies.map(renderCompanyCard).join("");
}

function sortCompanies(companies) {
  if (state.sortByUpdatedAt) {
    return [...companies].sort((left, right) => {
      const leftTimestamp = Date.parse(left?.updatedAt ?? "");
      const rightTimestamp = Date.parse(right?.updatedAt ?? "");
      const comparison = globalThis.CodalDashboardSorting.compareNullableNumbers(
        Number.isFinite(leftTimestamp) ? leftTimestamp : null,
        Number.isFinite(rightTimestamp) ? rightTimestamp : null,
        "desc",
      );
      return comparison || companySymbol(left).localeCompare(companySymbol(right), "fa");
    });
  }
  if (!state.sortColumn || !state.sortDirection) return [...companies];
  return [...companies].sort((left, right) => {
    const periodColumn = PERIOD_COLUMNS.some((column) => column.key === state.sortColumn);
    const leftValue = finiteNumber(
      periodColumn
        ? left.periods?.[state.sortColumn]?.metrics?.[state.sortMetric]
        : left.growth?.[state.sortColumn]?.[state.sortMetric],
    );
    const rightValue = finiteNumber(
      periodColumn
        ? right.periods?.[state.sortColumn]?.metrics?.[state.sortMetric]
        : right.growth?.[state.sortColumn]?.[state.sortMetric],
    );
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

function sortableColumnHeader(column, label, { growthStart = false } = {}) {
  const active = !state.sortByUpdatedAt
    && state.sortColumn === column.key
    && Boolean(state.sortDirection);
  const ariaSort = active
    ? state.sortDirection === "asc" ? "ascending" : "descending"
    : "none";
  const indicator = active
    ? state.sortDirection === "asc" ? "↑" : "↓"
    : "↕";
  const metricLabel = METRICS.find((metric) => metric.key === state.sortMetric)?.label ?? "ردیف انتخاب‌شده";
  return `
    <th
      scope="col"
      class="sortable-column-header${growthStart ? " growth-start" : ""}${active ? " sort-active" : ""}"
      aria-sort="${ariaSort}"
    >
      <button
        class="sort-column-button"
        type="button"
        data-sort-column="${escapeHtml(column.key)}"
        title="مرتب‌سازی ${escapeHtml(metricLabel)} براساس ${escapeHtml(label)}"
      >
        <span>${escapeHtml(label)}</span>
        <span class="sort-column-indicator" aria-hidden="true">${indicator}</span>
      </button>
    </th>
  `;
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
  if (hasUnitMismatch(company)) {
    return metric.key === "dominantRate" ? "نرخ محاسبه‌شده با واحدهای مختلف" : "واحدهای مختلف";
  }
  const unit = target?.unit || target?.units?.[0] || null;
  if (metric.key === "dominantRate") {
    return unit ? `ریال / ${unit}` : metric.unit;
  }
  return unit || metric.unit;
}

function visibleMetrics() {
  return METRICS.filter((metric) => state.visibleMetricKeys.has(metric.key));
}

function renderUnifiedTable(companies) {
  const displayedMetrics = visibleMetrics();
  const sample = companies[0];
  const headers = [
    ...PERIOD_COLUMNS.map((column) => ({ column, label: definitionLabel(sample, column) })),
    ...GROWTH_COLUMNS.map((column) => ({ column, label: definitionLabel(sample, column, true) })),
  ];
  const body = companies.map((company) => {
    const symbol = companySymbol(company);
    const selected = state.selectedSymbols.has(symbol);
    const status = companyStatusLabel(company);
    const tone = statusTone(status);
    const unitMismatch = hasUnitMismatch(company);
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
                <span class="unified-company-main">
                  <span class="unified-symbol-line">
                    <strong>${escapeHtml(symbol || "—")}</strong>
                    ${codalSymbolLink(symbol)}
                  </span>
                  <small title="${escapeHtml(company.name || "")}">${escapeHtml(company.name || "نام شرکت ثبت نشده")}</small>
                  <span class="unified-fiscal-year">${escapeHtml(fiscalEndLabel(company.fiscalYearEndMonth))}</span>
                </span>
                ${unitMismatch ? "" : `<span class="badge status-${tone}">${escapeHtml(status)}</span>`}
                ${unitMismatch ? '<span class="badge badge-unit-mismatch">عدم تطابق واحد</span>' : ""}
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
            ${headers.map(({ column, label }, index) => sortableColumnHeader(column, label, {
              growthStart: index === PERIOD_COLUMNS.length,
            })).join("")}
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
  const unitMismatch = hasUnitMismatch(company);

  const headers = [
    ...PERIOD_COLUMNS.map((column) => ({ column, label: definitionLabel(company, column) })),
    ...GROWTH_COLUMNS.map((column) => ({ column, label: definitionLabel(company, column, true) })),
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
          <span class="company-symbol-group">
            <span class="company-symbol">${escapeHtml(symbol || "—")}</span>
            ${codalSymbolLink(symbol)}
          </span>
          <span class="company-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        </div>
        <div class="company-badges">
          ${unitMismatch ? "" : `<span class="badge status-${tone}">${escapeHtml(status)}</span>`}
          <span class="badge">${escapeHtml(fiscalEndLabel(company.fiscalYearEndMonth))}</span>
          ${unitMismatch ? '<span class="badge badge-unit-mismatch">عدم تطابق واحد</span>' : ""}
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
                  ${headers.map(({ column, label }, index) => sortableColumnHeader(column, label, {
                    growthStart: index === PERIOD_COLUMNS.length,
                  })).join("")}
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
  if (key === ALL_INDUSTRIES_KEY && checked) {
    state.activeIndustryId = ALL_INDUSTRIES_KEY;
    state.searchQuery = "";
    elements.companySearch.value = "";
  }
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
      ? `${count ? `گزارش‌های ${faInteger.format(count)} شرکت تولیدی` : "گزارش‌های تمام شرکت‌های تولیدی فعال"} ${initialLoad ? "برای بار نخست" : "به‌دلیل تغییر منطق محاسبه مجموع کل، در این مرحله"} به‌طور کامل از کدال دریافت می‌شوند. میان پایان هر نماد و شروع نماد بعدی ۱۰ ثانیه فاصله خواهد بود.`
      : `فهرست اطلاعیه‌های ${count ? faInteger.format(count) : "تمام"} شرکت بررسی می‌شود و فقط گزارش‌های تازه یا اصلاحیه‌ها استخراج و ذخیره می‌شوند. نمادهای بدون تغییر دوباره دانلود نمی‌شوند.`
    : forceFullRefresh
      ? `تمام گزارش‌های موردنیاز ${faInteger.format(count)} نماد انتخاب‌شده دوباره از کدال دریافت، پردازش و در پایگاه داده ذخیره می‌شوند.`
      : `اطلاعیه‌های ${faInteger.format(count)} نماد انتخاب‌شده بررسی می‌شوند و فقط گزارش تازه یا اصلاحیه در پایگاه داده جایگزین خواهد شد.`;
  if (scope === "selected") {
    elements.dialogDescription.textContent = `در حالت آزمایشی، تمام گزارش‌های موردنیاز ${faInteger.format(count)} نماد انتخاب‌شده بدون توجه به داده‌های قبلی دوباره از کدال دریافت، پردازش و ذخیره می‌شوند.`;
  }
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
  const sortColumnButton = event.target.closest("[data-sort-column]");
  if (sortColumnButton) {
    toggleColumnSort(sortColumnButton.dataset.sortColumn);
    return;
  }
  const checkbox = event.target.closest("[data-company-checkbox]");
  if (checkbox) {
    toggleCompany(checkbox.dataset.companyCheckbox, checkbox.checked);
    return;
  }
  if (event.target.closest("[data-codal-symbol-link]")) return;
  const toggle = event.target.closest("[data-company-toggle]");
  if (toggle) toggleCompanyDetails(toggle.dataset.companyToggle);
});

elements.dashboardContent.addEventListener("keydown", (event) => {
  if (event.target.closest(".company-check, [data-codal-symbol-link]")) return;
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
  setSortByUpdatedAt(false);
  state.sortColumn = null;
  state.sortDirection = null;
  renderActiveIndustry();
});

function setSortByUpdatedAt(active) {
  state.sortByUpdatedAt = active;
  if (active) {
    state.sortColumn = null;
    state.sortDirection = null;
  }
  elements.sortLatestUpdateButton.classList.toggle("active", state.sortByUpdatedAt);
  elements.sortLatestUpdateButton.setAttribute("aria-pressed", String(state.sortByUpdatedAt));
}

function toggleColumnSort(columnKey) {
  const validColumn = [...PERIOD_COLUMNS, ...GROWTH_COLUMNS]
    .some((column) => column.key === columnKey);
  if (!validColumn) return;

  setSortByUpdatedAt(false);
  if (state.sortColumn !== columnKey || !state.sortDirection) {
    state.sortColumn = columnKey;
    state.sortDirection = "asc";
  } else if (state.sortDirection === "asc") {
    state.sortDirection = "desc";
  } else {
    state.sortColumn = null;
    state.sortDirection = null;
  }
  renderActiveIndustry();
}

elements.sortLatestUpdateButton.addEventListener("click", () => {
  setSortByUpdatedAt(!state.sortByUpdatedAt);
  renderActiveIndustry();
});

elements.tableViewToggle.addEventListener("change", () => {
  state.tableView = elements.tableViewToggle.checked;
  renderActiveIndustry();
});

elements.latestMonthOnlyToggle.addEventListener("change", () => {
  state.latestMonthOnly = elements.latestMonthOnlyToggle.checked;
  renderActiveIndustry();
});

elements.brochureIndustrySearch.addEventListener("input", () => {
  state.brochureIndustrySearch = elements.brochureIndustrySearch.value;
  renderBrochureIndustryList();
});

elements.brochureIndustryList.addEventListener("click", (event) => {
  const option = event.target.closest("[data-brochure-industry]");
  if (!option) return;
  state.brochureIndustryId = option.dataset.brochureIndustry;
  renderBrochureIndustryList();
  renderBrochureSelection();
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
