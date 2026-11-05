import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION, auditPage, siteScanLink, validateCode, validateFile, validateUrl } from "./core.js";

const CLIENT = "mcp";
const MAX_FINDINGS = 50;

const SEVERITY =
  "status is 'failed' only on errors, which are spec violations. Warnings are best practices on valid code: mention them, do not treat them as failures.";

/** An agent pays for every token it reads, so a page with 900 findings is cut, and says so. */
function reply(result) {
  const findings = result.findings ?? [];
  const body =
    findings.length > MAX_FINDINGS
      ? { ...result, findings: findings.slice(0, MAX_FINDINGS), findings_truncated: true, findings_total: findings.length }
      : result;
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}

async function run(work) {
  try {
    return reply(await work());
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error.message }] };
  }
}

export async function startMcpServer() {
  const server = new McpServer({ name: "validatehtml", version: VERSION });

  server.tool(
    "validate_code",
    `Validate HTML, CSS, JSON or XML you just wrote, or check HTML for accessibility (WCAG). Use after generating or editing markup. No key needed. The code is sent to validatehtml.com and not stored. ${SEVERITY}`,
    {
      language: z.enum(["html", "css", "json", "xml", "accessibility"]),
      code: z.string().describe("The code itself, up to 1 MB. A fragment is accepted."),
    },
    { readOnlyHint: true },
    ({ language, code }) => run(() => validateCode({ language, code, client: CLIENT }))
  );

  server.tool(
    "validate_file",
    `Validate a local .html, .htm, .css, .json, .xml or .svg file by path, without reading it into the conversation. No key needed. The file is sent to validatehtml.com and not stored. ${SEVERITY}`,
    {
      path: z.string(),
      language: z.enum(["html", "css", "json", "xml", "accessibility"]).optional().describe("Defaults to the file extension. Use 'accessibility' to check an HTML file for WCAG issues."),
    },
    { readOnlyHint: true },
    ({ path, language }) => run(() => validateFile({ path, language, client: CLIENT }))
  );

  server.tool(
    "validate_url",
    `Validate a live page, including a dev server on localhost, which is read locally. No key needed. ${SEVERITY}`,
    {
      url: z.string(),
      language: z.enum(["html", "css", "accessibility"]).optional().describe("What to check. Defaults to html."),
    },
    { readOnlyHint: true },
    ({ url, language }) => run(() => validateUrl({ url, language, client: CLIENT }))
  );

  server.tool(
    "audit_page",
    `Run every check on one deployed page in a single call: HTML, accessibility, meta tags, Open Graph and page weight. Needs VALIDATEHTML_API_KEY. ${SEVERITY}`,
    {
      url: z.string(),
      checks: z.array(z.string()).optional(),
      fail_on: z.enum(["error", "warning"]).optional(),
    },
    { readOnlyHint: true },
    ({ url, checks, fail_on }) => run(() => auditPage({ url, checks, failOn: fail_on, client: CLIENT }))
  );

  server.tool(
    "site_scan_link",
    "Get a link for the user to scan a whole website rather than one page. It opens in their browser, shows the result for this page and offers the site scan: the summary is free, the full report is paid. Calling this tool starts nothing.",
    { url: z.string() },
    { readOnlyHint: true },
    ({ url }) => ({ content: [{ type: "text", text: siteScanLink(url, CLIENT) }] })
  );

  await server.connect(new StdioServerTransport());
}
