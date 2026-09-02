import http from "node:http";
import https from "node:https";

const RETRYABLE_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TLS_CHAIN_ERRORS = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
]);

export class HttpError extends Error {
  constructor(message, { status = null, url = null, body = null } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}
function isCodalHost(hostname) {
  return hostname === "codal.ir" || hostname.endsWith(".codal.ir");
}

function retryAfterMilliseconds(value) {
  if (value == null || value === "") return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(String(value));
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function requestOnce(url, { headers, timeoutMs, rejectUnauthorized, redirectsLeft }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "http:" ? http : https;
    const request = transport.request(
      parsed,
      {
        method: "GET",
        headers,
        rejectUnauthorized,
      },
      (response) => {
        const location = response.headers.location;
        if (location && [301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          if (redirectsLeft <= 0) {
            reject(new HttpError("The HTTP redirect limit was exceeded.", { url }));
            return;
          }
          const redirected = new URL(location, parsed).toString();
          requestOnce(redirected, {
            headers,
            timeoutMs,
            rejectUnauthorized,
            redirectsLeft: redirectsLeft - 1,
          }).then(resolve, reject);
          return;
        }

        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body,
            url: parsed.toString(),
          });
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`HTTP timeout after ${timeoutMs}ms`));
    });
    request.on("error", reject);
    request.end();
  });
}

export async function requestBuffer(
  url,
  {
    headers = {},
    timeoutMs = 60_000,
    insecureCodalFallback = true,
    redirects = 5,
    retries = 2,
    retryDelayMs = 1_000,
    onRetry = null,
  } = {},
) {
  const parsed = new URL(url);
  const requestHeaders = {
    accept: "*/*",
    "accept-language": "fa-IR,fa;q=0.9,en;q=0.7",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CodalMonthlyReport/1.0",
    ...headers,
  };

  let rejectUnauthorized = true;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let nextDelayMs = retryDelayMs * (2 ** attempt);
    try {
      const response = await requestOnce(parsed, {
        headers: requestHeaders,
        timeoutMs,
        rejectUnauthorized,
        redirectsLeft: redirects,
      });
      if (response.status >= 200 && response.status < 300) return response;

      const preview = response.body.toString("utf8", 0, Math.min(1_000, response.body.length));
      const error = new HttpError(`HTTP ${response.status} from ${parsed.hostname}`, {
        status: response.status,
        url: response.url,
        body: preview,
      });
      if (!RETRYABLE_CODES.has(response.status) || attempt === retries) throw error;
      lastError = error;
      nextDelayMs = Math.max(
        nextDelayMs,
        retryAfterMilliseconds(response.headers["retry-after"]),
        response.status === 429 ? 60_000 : 0,
      );
      if (typeof onRetry === "function") {
        onRetry({ status: response.status, delayMs: nextDelayMs, url: response.url });
      }
    } catch (error) {
      if (
        rejectUnauthorized &&
        insecureCodalFallback &&
        isCodalHost(parsed.hostname) &&
        TLS_CHAIN_ERRORS.has(error.code)
      ) {
        rejectUnauthorized = false;
        attempt -= 1;
        continue;
      }
      if (error instanceof HttpError && !RETRYABLE_CODES.has(error.status)) throw error;
      lastError = error;
      if (attempt === retries) throw error;
      if (typeof onRetry === "function") {
        onRetry({ status: error?.status ?? null, delayMs: nextDelayMs, url: parsed.toString() });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, nextDelayMs));
  }
  throw lastError;
}

export async function requestText(url, options) {
  const response = await requestBuffer(url, options);
  return response.body.toString("utf8");
}

export async function requestJson(url, options) {
  const text = await requestText(url, {
    ...options,
    headers: { accept: "application/json", ...(options?.headers ?? {}) },
  });
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new HttpError("The Codal JSON response could not be parsed.", {
      url,
      body: text.slice(0, 1_000),
    });
  }
}
