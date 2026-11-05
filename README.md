# validatehtml

Validate HTML, CSS, JSON, XML and accessibility from your terminal or your AI
coding agent. Errors are spec violations, warnings are best practices, and modern
valid code stays clean.

```bash
npx validatehtml index.html
npx validatehtml https://example.com
npx validatehtml http://localhost:3000 --type accessibility
```

No account and no key. Exit code 0 when it passes, 1 when it fails, 2 when it
could not run, so it fits in a script or a build.

## For AI coding agents (MCP)

Claude Code:

```bash
claude mcp add validatehtml -- npx -y validatehtml mcp
```

Cursor, Windsurf, VS Code and any other MCP client:

```json
{
  "mcpServers": {
    "validatehtml": { "command": "npx", "args": ["-y", "validatehtml", "mcp"] }
  }
}
```

| Tool | What it does | Key |
| --- | --- | --- |
| `validate_code` | Checks HTML, CSS, JSON, XML, or HTML for WCAG issues | No |
| `validate_file` | The same on a local file, without reading it into the conversation | No |
| `validate_url` | Checks a live page, including a dev server on localhost | No |
| `audit_page` | Every check on one deployed page: HTML, accessibility, meta tags, Open Graph, page weight | Yes |
| `site_scan_link` | A link for you to scan a whole site in your browser | No |

## Command line

```
validatehtml <file|url|->  [--type html|css|json|xml|accessibility]
                           [--audit] [--fail-on error|warning] [--format text|json]
validatehtml mcp
```

`-` reads standard input. `--audit` needs a key.

## Key

`--audit` and `audit_page` use `VALIDATEHTML_API_KEY`. Create one at
<https://validatehtml.com/dashboard>. A free account includes 100 calls a month;
larger allowances are on the [pricing page](https://validatehtml.com/pricing).

## What leaves your machine

The code or file you ask to check is sent to validatehtml.com, checked in memory
and not stored. A page on `localhost` is read on your machine and sent the same
way. Only `.html`, `.htm`, `.css`, `.json`, `.xml` and `.svg` files can be read,
up to 1 MB. Each call also counts the tool used and the package version, never
the content.

## Licence

MIT for this client. The licence does not cover the ValidateHTML name.
