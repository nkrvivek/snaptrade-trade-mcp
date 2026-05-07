# Contributing to snaptrade-trade-mcp

## Development setup

```bash
git clone https://github.com/nkrvivek/snaptrade-trade-mcp.git
cd snaptrade-trade-mcp
npm install
cp .env.example .env   # fill in real SnapTrade credentials — needed for any smoke/diag runs
npm run build          # compile TypeScript to dist/
```

Run the server directly (dev mode, no build step):

```bash
npm run dev            # uses tsx to run src/index.ts
```

Smoke test against a live account:

```bash
npm run smoke          # runs scripts/smoke.ts — reads accounts, does not place orders
```

## Project layout

```
src/index.ts           — entire server: tool schemas, handlers, MCP wiring
examples/              — diagnostic scripts (may place live orders — read carefully)
scripts/               — smoke.ts and other utility scripts
.env.example           — required env vars with descriptions
```

The server is intentionally a single file. If it grows beyond ~500 lines, split into `src/tools/` modules.

## Making changes

- Keep tool schemas in sync with the SnapTrade API. The upstream SDK is `snaptrade-typescript-sdk`.
- All destructive tools (`*_confirm`, `*_force_place`, `*_place`, `cancel_order`) must include a clear `[DESTRUCTIVE]` marker in their MCP tool description so LLM hosts can surface this to users.
- Do not log credentials. Do not return raw SnapTrade error bodies to the LLM without sanitizing credential fields.
- TypeScript strict mode is on. Run `npm run build` before opening a PR — the CI check is just `tsc`.

## Branch and PR expectations

- Branch off `main`. Use a descriptive branch name: `fix/cancel-order-schema`, `feat/dry-run-flag`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`.
- Open a PR against `main`. Describe what changed and why. If the change affects any tool's input schema or output shape, call that out explicitly — LLM prompt authors depend on these contracts.
- One logical change per PR.

## Filing issues

Use GitHub Issues. Before opening:

1. Check existing issues for duplicates.
2. Check [Known Limitations](README.md#known-limitations) in README — some behaviors are intentional SnapTrade platform constraints, not bugs.

For bugs, include:
- Node version (`node --version`)
- The exact tool call (parameters, minus credentials)
- The full error message or unexpected output
- Whether the error is a SnapTrade API error code (e.g. 1019, 1063) or a server-side panic

For feature requests, describe the use case first, then the proposed solution.

## Security vulnerabilities

Do not file security issues publicly. Use [GitHub Security Advisories](https://github.com/nkrvivek/snaptrade-trade-mcp/security/advisories).

## Using Claude Code

```bash
claude    # reads CLAUDE.md automatically, has full project context
```
