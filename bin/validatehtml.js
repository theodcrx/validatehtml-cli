#!/usr/bin/env node
import { parseArgs } from "node:util";
import { LANGUAGES, MAX_BYTES, VERSION, auditPage, validateCode, validateFile, validateUrl } from "../src/core.js";

const CLIENT = "cli";

const HELP = `validatehtml ${VERSION}

Usage
  validatehtml <file>            Validate a local .html, .css, .json, .xml or .svg file
  validatehtml <url>             Validate a live page, localhost included
  validatehtml -                 Validate standard input (HTML unless --type says otherwise)
  validatehtml mcp               Start the MCP server for AI coding agents

Options
  --type <t>        ${LANGUAGES.join(", ")}
  --audit           Every check on a deployed page (needs VALIDATEHTML_API_KEY)
  --fail-on <l>     error (default) or warning
  --format <f>      text (default) or json
  -h, --help        This help
  -v, --version     The version

Exit codes
  0 passed, 1 failed, 2 could not run

The code is sent to validatehtml.com and not stored. https://validatehtml.com
`;

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error("The input is over the 1 MB limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function printText(result) {
  for (const f of result.findings) {
    const place = f.line ? `${f.line}:${f.column ?? 0}` : "-";
    console.log(`${place.padEnd(9)} ${String(f.severity).padEnd(8)} ${f.message}  ${f.rule ?? ""}`.trimEnd());
  }
  if (result.findings.length) console.log("");
  console.log(`${result.status === "passed" ? "PASSED" : "FAILED"}  ${result.target}: ${result.errors} error(s), ${result.warnings} warning(s)`);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      type: { type: "string" },
      audit: { type: "boolean", default: false },
      "fail-on": { type: "string", default: "error" },
      format: { type: "string", default: "text" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (values.version) return void console.log(VERSION);
  if (values.help || positionals.length === 0) {
    console.log(HELP);
    process.exitCode = values.help ? 0 : 2;
    return;
  }

  const [target] = positionals;
  if (target === "mcp") {
    const { startMcpServer } = await import("../src/mcp.js");
    return startMcpServer();
  }

  const failOn = values["fail-on"];
  if (failOn !== "error" && failOn !== "warning") throw new Error("--fail-on must be error or warning.");
  if (values.format !== "text" && values.format !== "json") throw new Error("--format must be text or json.");

  const isUrl = /^https?:\/\//i.test(target);
  let result;
  if (values.audit) {
    if (!isUrl) throw new Error("--audit needs the URL of a deployed page.");
    result = await auditPage({ url: target, failOn, client: CLIENT });
  } else if (target === "-") {
    result = await validateCode({ language: values.type ?? "html", code: await readStdin(), target: "stdin", client: CLIENT });
  } else if (isUrl) {
    result = await validateUrl({ url: target, language: values.type ?? "html", client: CLIENT });
  } else {
    result = await validateFile({ path: target, language: values.type, client: CLIENT });
  }

  const failed = result.errors > 0 || (failOn === "warning" && result.warnings > 0);
  result.status = failed ? "failed" : "passed";

  if (values.format === "json") console.log(JSON.stringify(result, null, 2));
  else printText(result);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(`validatehtml: ${error.message}`);
  process.exitCode = 2;
});
