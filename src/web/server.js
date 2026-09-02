import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ReportDatabase } from "./database.js";
import { DashboardService, WebServiceError } from "./service.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIR = path.join(MODULE_DIR, "public");
const MAX_JSON_BODY_BYTES = 1_000_000;

const MIME_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
});

function applySecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net data:; img-src 'self' data:; script-src 'self'; connect-src 'self'",
  );
}

function sendJson(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", body.length);
  response.setHeader("Cache-Control", "no-store");
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw new WebServiceError("حجم درخواست بیش از حد مجاز است.", 413, "BODY_TOO_LARGE");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new WebServiceError("بدنه JSON درخواست معتبر نیست.", 400, "INVALID_JSON");
  }
}

function resolveStaticPath(publicDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (!relative || relative.split("/").some((segment) => segment === ".." || segment.startsWith("."))) {
    return null;
  }
  const root = path.resolve(publicDir);
  const resolved = path.resolve(root, relative);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

async function sendStaticFile(request, response, publicDir, pathname) {
  const filePath = resolveStaticPath(publicDir, pathname);
  if (!filePath) return false;
  try {
    const data = await fs.readFile(filePath);
    response.statusCode = 200;
    response.setHeader(
      "Content-Type",
      MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
    );
    response.setHeader("Content-Length", data.length);
    response.setHeader(
      "Cache-Control",
      path.basename(filePath) === "index.html" ? "no-cache" : "public, max-age=3600",
    );
    response.end(request.method === "HEAD" ? undefined : data);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") return false;
    throw error;
  }
}

function normalizeError(error) {
  if (error instanceof WebServiceError) {
    return {
      statusCode: error.statusCode,
      payload: { error: error.message, code: error.code },
    };
  }
  return {
    statusCode: 500,
    payload: { error: "خطای داخلی سرور رخ داد.", code: "INTERNAL_ERROR" },
  };
}

export function createWebServer({
  service,
  publicDir = DEFAULT_PUBLIC_DIR,
  logger = console,
} = {}) {
  if (!service) throw new TypeError("service is required.");

  return http.createServer(async (request, response) => {
    applySecurityHeaders(response);
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const pathname = requestUrl.pathname;
    try {
      if (request.method === "GET" && pathname === "/api/health") {
        sendJson(response, 200, {
          ok: true,
          hasData: Boolean(service.getDashboard().metadata.hasData),
          update: service.getUpdateState(),
        });
        return;
      }
      if (request.method === "GET" && pathname === "/api/dashboard") {
        sendJson(response, 200, service.getDashboard());
        return;
      }
      if (request.method === "GET" && pathname === "/api/update/status") {
        sendJson(response, 200, service.getUpdateState());
        return;
      }
      if (request.method === "POST" && pathname === "/api/update") {
        const body = await readJsonBody(request);
        const dashboard = await service.update(body);
        sendJson(response, 200, dashboard);
        return;
      }
      if (request.method === "POST" && pathname === "/api/export") {
        const body = await readJsonBody(request);
        const exported = await service.createExcelExport(body.symbols);
        response.statusCode = 200;
        response.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="${exported.filename.replace(/[^A-Za-z0-9._-]/g, "-")}"`,
        );
        response.setHeader("Content-Length", exported.buffer.length);
        response.setHeader("Cache-Control", "no-store");
        response.end(exported.buffer);
        return;
      }
      if ((request.method === "GET" || request.method === "HEAD") && !pathname.startsWith("/api/")) {
        if (await sendStaticFile(request, response, publicDir, pathname)) return;
      }
      sendJson(response, 404, { error: "مسیر درخواستی پیدا نشد.", code: "NOT_FOUND" });
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized.statusCode >= 500) logger?.error?.(error);
      if (!response.headersSent) sendJson(response, normalized.statusCode, normalized.payload);
      else response.destroy(error);
    }
  });
}

function numberFromEnvironment(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export async function startWebServer(options = {}) {
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const port = numberFromEnvironment(options.port ?? process.env.PORT, 4173);
  const database = options.database ?? new ReportDatabase(
    options.databasePath ?? process.env.CODAL_DB_PATH ?? path.resolve("data/monthly-reports.sqlite"),
  );
  const service = options.service ?? new DashboardService({
    database,
    cacheDir: options.cacheDir ?? process.env.CODAL_CACHE_DIR ?? path.resolve(".cache/codal"),
    concurrency: numberFromEnvironment(options.concurrency ?? process.env.CODAL_CONCURRENCY, 1),
    requestDelayMs: numberFromEnvironment(options.requestDelayMs ?? process.env.CODAL_DELAY_MS, 1_000),
    companyDelayMs: numberFromEnvironment(
      options.companyDelayMs ?? process.env.CODAL_COMPANY_DELAY_MS,
      10_000,
    ),
    requestRetries: numberFromEnvironment(options.requestRetries ?? process.env.CODAL_RETRIES, 4),
  });
  const server = createWebServer({ service, publicDir: options.publicDir, logger: options.logger });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return { server, service, database, host, port };
}

async function runMain() {
  const running = await startWebServer();
  console.log(`Codal dashboard is running at http://${running.host}:${running.port}`);
  console.log("Data is read from SQLite. Use the update buttons to fetch fresh Codal reports.");

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    running.server.close(() => {
      running.database.close();
      process.exitCode = 0;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  runMain().catch((error) => {
    console.error(`Web server failed: ${error.message}`);
    process.exitCode = 1;
  });
}
