import { readFile } from "node:fs/promises";
import { extname } from "node:path";

export const VERSION = "0.1.0";
export const LANGUAGES = ["html", "css", "json", "xml", "accessibility"];
export const MAX_BYTES = 1_000_000;

const BY_EXTENSION = {
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".json": "json",
  ".xml": "xml",
  ".svg": "xml",
};

const ROUTES = {
  html: { path: "/api/validate", field: "html" },
  css: { path: "/api/validate-css", field: "css" },
  json: { path: "/api/validate-json", field: "json" },
  xml: { path: "/api/validate-xml", field: "xml" },
  accessibility: { path: "/api/check-accessibility", field: "html" },
};

function baseUrl() {
  return (process.env.VALIDATEHTML_BASE_URL || "https://validatehtml.com").replace(/\/$/, "");
}

async function post(path, body, client, headers = {}) {
  let res;
  try {
    res = await fetch(baseUrl() + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `validatehtml-${client}/${VERSION}`,
        "X-ValidateHTML-Client": `${client}/${VERSION}`,
        ...headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new Error(`Could not reach ${baseUrl()}: ${error.message}`);
  }
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function failure({ status, data }) {
  const message = data?.error?.message ?? (typeof data?.error === "string" ? data.error : null);
  return new Error(message ?? `The service answered ${status}.`);
}

function normalise(language, target, data) {
  // A JSON document has one verdict and at most one position, not a findings list.
  if (language === "json") {
    const findings = data.valid
      ? []
      : [{
          severity: "error",
          rule: "json-syntax",
          message: data.error,
          line: data.errorPosition?.line ?? null,
          column: data.errorPosition?.column ?? null,
        }];
    return { language, target, status: data.valid ? "passed" : "failed", errors: findings.length, warnings: 0, findings };
  }
  return {
    language,
    target,
    status: data.errors > 0 ? "failed" : "passed",
    errors: data.errors,
    warnings: data.warnings,
    ...(typeof data.score === "number" ? { score: data.score } : {}),
    findings: (data.messages ?? []).map((m) => ({
      severity: m.severity,
      rule: m.ruleId,
      message: m.message,
      line: m.line ?? null,
      column: m.column ?? null,
    })),
  };
}

export function languageOf(path) {
  return BY_EXTENSION[extname(path).toLowerCase()] ?? null;
}

export async function validateCode({ language, code, target = "input", client }) {
  const route = ROUTES[language];
  if (!route) throw new Error(`Unknown language "${language}". Use one of: ${LANGUAGES.join(", ")}.`);
  if (!code) throw new Error("Nothing to validate: the input is empty.");
  if (Buffer.byteLength(code) > MAX_BYTES) throw new Error("The input is over the 1 MB limit.");
  const answer = await post(route.path, { [route.field]: code }, client);
  if (answer.status !== 200 || !answer.data) throw failure(answer);
  return normalise(language, target, answer.data);
}

/** Only known text formats are read, so a confused agent cannot send ~/.ssh/config to a validator. */
export async function validateFile({ path, language, client }) {
  const detected = languageOf(path);
  if (!detected) {
    throw new Error(`Refusing to read "${path}": only ${Object.keys(BY_EXTENSION).join(", ")} files are validated.`);
  }
  const code = await readFile(path, "utf8");
  return validateCode({ language: language ?? detected, code, target: path, client });
}

export function isLoopback(url) {
  const { hostname } = new URL(url);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

/**
 * A dev server is not reachable from our servers, so its page is read here and
 * sent as code. Every other address is fetched server side, through the checks
 * the service applies to any URL.
 */
export async function validateUrl({ url, language = "html", client }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`"${url}" is not an absolute URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https addresses can be validated.");
  }
  if (!["html", "css", "accessibility"].includes(language)) {
    throw new Error(`A URL can be checked as html, css or accessibility, not "${language}".`);
  }

  if (isLoopback(url)) {
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      throw new Error(`Could not read ${url}: ${error.message}`);
    }
    if (!res.ok) throw new Error(`${url} answered ${res.status}.`);
    return validateCode({ language, code: await res.text(), target: url, client });
  }

  const route = ROUTES[language];
  const answer = await post(route.path, { url }, client);
  if (answer.status !== 200 || !answer.data) throw failure(answer);
  return normalise(language, url, answer.data);
}

export const NO_KEY =
  "This check needs a free API key (100 calls a month). Create one at https://validatehtml.com/dashboard and set VALIDATEHTML_API_KEY.";

/** The keyed endpoint: every check off one fetch of a deployed page, and a stable v1 contract. */
export async function auditPage({ url, checks, failOn = "error", client }) {
  const key = process.env.VALIDATEHTML_API_KEY;
  if (!key) throw new Error(NO_KEY);
  const body = { url, fail_on: failOn, ...(checks?.length ? { checks } : {}) };
  const answer = await post("/api/v1/validate", body, client, { Authorization: `Bearer ${key}` });
  if (answer.status !== 200 || !answer.data) throw failure(answer);
  const d = answer.data;
  return {
    target: d.url,
    status: d.status,
    errors: d.totals.errors,
    warnings: d.totals.warnings,
    accessibility_score: d.accessibility_score,
    by_check: d.by_check,
    findings: d.findings,
    findings_truncated: d.findings_truncated,
    usage: d.usage,
  };
}

export function siteScanLink(url, client) {
  // The home page checks this address on arrival, then offers the scan of the whole site.
  const link = new URL("https://validatehtml.com/");
  link.searchParams.set("url", url);
  link.searchParams.set("utm_source", client);
  return link.toString();
}
