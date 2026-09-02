import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createWebServer } from "../src/web/server.js";
import { WebServiceError } from "../src/web/service.js";

async function withServer(service, callback) {
  const publicDir = await fs.mkdtemp(path.join(os.tmpdir(), "codal-web-public-"));
  await fs.writeFile(path.join(publicDir, "index.html"), "<!doctype html><title>Codal</title>");
  const server = createWebServer({ service, publicDir, logger: null });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(publicDir, { recursive: true, force: true });
  }
}

function fakeService() {
  const dashboard = {
    metadata: { hasData: true, companyCount: 1 },
    industries: [{ industryName: "فلزات اساسی", companies: [{ symbol: "فولاد" }] }],
  };
  return {
    updates: [],
    getDashboard: () => dashboard,
    getUpdateState: () => ({ running: false, completed: 0, total: 0 }),
    async update(body) {
      this.updates.push(body);
      return dashboard;
    },
    async createExcelExport(symbols) {
      assert.deepEqual(symbols, ["فولاد"]);
      return {
        buffer: Buffer.from([80, 75, 3, 4]),
        filename: "codal-selected-1405-05.xlsx",
      };
    },
  };
}

test("web server serves the dashboard shell, health and persisted dashboard API", async () => {
  await withServer(fakeService(), async (baseUrl) => {
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /^text\/html/);
    assert.match(await page.text(), /Codal/);
    assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);

    const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    assert.equal(health.hasData, true);

    const dashboard = await fetch(`${baseUrl}/api/dashboard`).then((response) => response.json());
    assert.equal(dashboard.industries[0].companies[0].symbol, "فولاد");
  });
});
test("web server forwards update requests and returns refreshed database data", async () => {
  const service = fakeService();
  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "selected", symbols: ["فولاد"] }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).metadata.companyCount, 1);
    assert.deepEqual(service.updates, [{ scope: "selected", symbols: ["فولاد"] }]);
  });
});

test("web server streams selected Excel output with attachment headers", async () => {
  await withServer(fakeService(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: ["فولاد"] }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /spreadsheetml/);
    assert.match(response.headers.get("content-disposition"), /codal-selected-1405-05\.xlsx/);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [80, 75, 3, 4]);
  });
});

test("web server returns structured errors for invalid JSON and service failures", async () => {
  const service = fakeService();
  service.update = async () => {
    throw new WebServiceError("یک بروزرسانی دیگر در حال اجراست.", 409, "UPDATE_IN_PROGRESS");
  };
  await withServer(service, async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/update`, {
      method: "POST",
      body: "{broken",
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, "INVALID_JSON");

    const conflict = await fetch(`${baseUrl}/api/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "all" }),
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, "UPDATE_IN_PROGRESS");

    const missing = await fetch(`${baseUrl}/api/not-found`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, "NOT_FOUND");
  });
});
