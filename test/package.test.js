// Drives the real binary and the real MCP protocol against VALIDATEHTML_BASE_URL
// (production by default). Few calls on purpose: run it once, never in a loop.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "validatehtml.js");
const VALID = '<!doctype html><html lang="en"><head><title>t</title></head><body><img srcset="a.jpg 1x" alt="x"></body></html>';
const BROKEN = "<div><span>x</div>";

let dir;
let dev;
let devUrl;
let mcp;

function cli(args, input) {
  return spawnSync(process.execPath, [BIN, ...args], { input, encoding: "utf8", env: { ...process.env, VALIDATEHTML_API_KEY: "" } });
}

async function call(name, args) {
  const r = await mcp.callTool({ name, arguments: args });
  return { isError: r.isError ?? false, text: r.content[0].text };
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "validatehtml-"));
  writeFileSync(join(dir, "ok.html"), VALID);
  writeFileSync(join(dir, "bad.html"), BROKEN);
  writeFileSync(join(dir, "bad.json"), '{"a":1,}');
  writeFileSync(join(dir, "secret.env"), "TOKEN=x");
  dev = createServer((_, res) => res.end(BROKEN));
  await new Promise((resolve) => dev.listen(0, "127.0.0.1", resolve));
  devUrl = `http://127.0.0.1:${dev.address().port}/`;
  mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [BIN, "mcp"], env: { ...process.env, VALIDATEHTML_API_KEY: "" } }));
});

after(async () => {
  await mcp?.close();
  dev?.close();
  rmSync(dir, { recursive: true, force: true });
});

test("cli: a valid file passes, exit 0", () => {
  const r = cli([join(dir, "ok.html")]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /^PASSED/m);
});

test("cli: a broken file fails with a located error, exit 1", () => {
  const r = cli([join(dir, "bad.html")]);
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.match(r.stdout, /^1:\d+\s+error/m);
});

test("cli: stdin as JSON output", () => {
  const r = cli(["-", "--format", "json"], BROKEN);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.status, "failed");
  assert.ok(parsed.errors > 0);
  assert.equal(parsed.findings.length, parsed.errors + parsed.warnings);
});

test("cli: invalid JSON is an error with a position", () => {
  const r = cli([join(dir, "bad.json")]);
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.match(r.stdout, /^1:\d+\s+error/m);
});

test("cli: other file types are refused and never sent, exit 2", () => {
  const r = cli([join(dir, "secret.env")]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Refusing to read/);
});

test("cli: --audit without a key says how to get one, exit 2", () => {
  const r = cli(["https://example.com/", "--audit"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /VALIDATEHTML_API_KEY/);
});

test("mcp: lists its tools", async () => {
  const { tools } = await mcp.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["audit_page", "site_scan_link", "validate_code", "validate_file", "validate_url"]);
});

test("mcp: valid and broken code in both directions", async () => {
  const good = JSON.parse((await call("validate_code", { language: "html", code: VALID })).text);
  assert.equal(good.status, "passed");
  assert.equal(good.errors, 0);
  const bad = JSON.parse((await call("validate_code", { language: "html", code: BROKEN })).text);
  assert.equal(bad.status, "failed");
  assert.ok(bad.findings.length > 0);
});

test("mcp: css, xml and accessibility report real problems", async () => {
  for (const [language, code] of [["css", "a{colr:red}"], ["xml", "<a><b></a>"], ["accessibility", '<img src="a.png">']]) {
    const r = JSON.parse((await call("validate_code", { language, code })).text);
    assert.equal(r.status, "failed", language);
    assert.ok(r.findings[0].rule, language);
  }
});

test("mcp: validate_file reads the file and refuses other types", async () => {
  assert.equal(JSON.parse((await call("validate_file", { path: join(dir, "bad.html") })).text).status, "failed");
  const refused = await call("validate_file", { path: join(dir, "secret.env") });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /Refusing to read/);
});

test("mcp: validate_url reads a loopback dev server locally", async () => {
  const r = JSON.parse((await call("validate_url", { url: devUrl })).text);
  assert.equal(r.status, "failed");
  assert.equal(r.target, devUrl);
});

test("mcp: validate_url checks a public page server side", async () => {
  const r = JSON.parse((await call("validate_url", { url: "https://example.com/" })).text);
  assert.equal(r.status, "passed");
});

test("mcp: audit_page without a key is a tool error, not a crash", async () => {
  const r = await call("audit_page", { url: "https://example.com/" });
  assert.equal(r.isError, true);
  assert.match(r.text, /VALIDATEHTML_API_KEY/);
});

test("mcp: site_scan_link points at a page that runs the deep link", async () => {
  const r = await call("site_scan_link", { url: "https://example.com/a?b=1" });
  const link = new URL(r.text);
  assert.equal(link.origin + link.pathname, "https://validatehtml.com/");
  assert.equal(link.searchParams.get("url"), "https://example.com/a?b=1");
  assert.equal(link.searchParams.get("utm_source"), "mcp");
});
