import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const persianText = /[\u0600-\u06FF]/u;

function runCli(...args) {
  return spawnSync(process.execPath, ["src/cli.js", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

test("CLI help is English and safe for terminals without Persian text support", () => {
  const result = runCli("--help");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Codal Monthly Manufacturing Report/);
  assert.match(result.stdout, /Default pilot symbols: FOOLAD, FMLI, SHEPNA/);
  assert.match(result.stdout, /--all-symbols/);
  assert.doesNotMatch(result.stdout, persianText);
  assert.equal(result.stderr, "");
});

test("CLI validation errors are English", () => {
  const result = runCli("--symbols=");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Error: --symbols cannot be empty\./);
  assert.doesNotMatch(result.stderr, persianText);
});
