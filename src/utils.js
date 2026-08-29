export const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function toEnglishDigits(value) {
  return String(value ?? "")
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
}

export function normalizePersianText(value) {
  return toEnglishDigits(value)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\u200f\u202a-\u202e]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCodalNumber(value) {
  const text = toEnglishDigits(value)
    .replace(/[٬,،\s]/g, "")
    .replace(/[−–—]/g, "-")
    .trim();
  if (!text || text === "-") return null;
  const parenthesized = /^\((.*)\)$/.exec(text);
  const numericText = parenthesized ? `-${parenthesized[1]}` : text;
  const parsed = Number(numericText);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class StartIntervalGate {
  constructor(intervalMs = 0) {
    this.intervalMs = Math.max(0, Number(intervalMs) || 0);
    this.nextStart = 0;
    this.tail = Promise.resolve();
  }

  async wait() {
    let release;
    const previous = this.tail;
    this.tail = new Promise((resolve) => { release = resolve; });
    await previous;
    const delay = Math.max(0, this.nextStart - Date.now());
    if (delay) await sleep(delay);
    this.nextStart = Date.now() + this.intervalMs;
    release();
  }
}

export function safeDivide(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
    ? numerator / denominator
    : null;
}

export function sanitizeFileName(value) {
  return normalizePersianText(value).replace(/[<>:"/\\|?*]/g, "-").trim();
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
