# snaptrade-trade-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node ≥18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![npm](https://img.shields.io/badge/npm-not%20yet%20published-lightgrey)]()

MCP server wrapping SnapTrade's write-side trading API. Exposes 8 tools covering equity orders and multi-leg options. Designed to complement the existing read-only [snaptrade-mcp-ts](https://github.com/passiv/snaptrade-mcp-ts) server.

**This server places real brokerage orders. Read the security notes and limitations before connecting it to any LLM.**

---

## What it does

- Resolve tickers to SnapTrade universal symbol IDs
- Preview and confirm equity orders (buy/sell with full impact preview)
- Place equity orders without impact preview for after-hours and broker-incompatible flows
- Preview and place multi-leg option orders (spreads, condors, etc.)
- Cancel pending orders
- List account orders with state filtering

---

## Prerequisites

- Node.js >= 18
- A SnapTrade developer account with Client ID and Consumer Key — [developer dashboard](https://app.snaptrade.com/snapTrade/developer)
- A registered SnapTrade user (User ID + User Secret)
- At least one brokerage connected via SnapTrade (see broker compatibility below)

---

## Install

```bash
git clone https://github.com/nkrvivek/snaptrade-trade-mcp.git
cd snaptrade-trade-mcp
./setup.sh
```

Or manually:

```bash
npm install
cp .env.example .env   # fill in your SnapTrade credentials
npm run build
```

---

## Register with Claude Code

Add to your Claude Code MCP config (typically `~/.claude/settings.json` or `.claude/settings.json` in your project):

```json
{
  "mcpServers": {
    "snaptrade-trade": {
      "command": "node",
      "args": ["/absolute/path/to/snaptrade-trade-mcp/dist/index.js"],
      "env": {
        "SNAPTRADE_CLIENT_ID": "...",
        "SNAPTRADE_CONSUMER_KEY": "...",
        "SNAPTRADE_USER_ID": "...",
        "SNAPTRADE_USER_SECRET": "..."
      }
    }
  }
}
```

The server communicates over stdio. No port is opened.

---

## Environment variables

All four `SNAPTRADE_*` variables are required. The server exits at startup if any are missing.

| Variable | Required | Description |
|---|---|---|
| `SNAPTRADE_CLIENT_ID` | Yes | Your SnapTrade integration client ID |
| `SNAPTRADE_CONSUMER_KEY` | Yes | HMAC signing key — treat as a secret |
| `SNAPTRADE_USER_ID` | Yes | The SnapTrade user ID you registered |
| `SNAPTRADE_USER_SECRET` | Yes | The user secret returned at registration |
| `BROKER_ACCOUNT_ID` | No | Default account UUID for scripts/examples |
| `BROKER_ACCOUNT_IDS` | No | Comma-separated `Label:uuid` pairs for multi-account diag scripts |
| `SNAPTRADE_ALLOW_LIVE_DIAG` | No | Set to `true` to enable `diag-ah-place.ts` (places live orders) |

---

## Tool reference

All tools accept and return JSON. Account UUIDs are obtained from the companion read-only server (`snaptrade_list_accounts`) or from the SnapTrade dashboard.

### `search_symbol`

Resolve a ticker to a SnapTrade `universal_symbol_id` scoped to an account.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `account_id` | UUID string | Yes | SnapTrade account UUID |
| `ticker` | string | Yes | Ticker symbol, e.g. `SLV`, `NVDA` |

Returns: `universal_symbol_id` and symbol metadata.

---

### `equity_impact`

Preview an equity order. Returns estimated cost, buying power impact, and a `trade_id` required by `equity_confirm`. SnapTrade enforces regular trading hours for this endpoint (error 1019 outside market hours). Use `equity_force_place` for after-hours.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `account_id` | UUID | Yes | |
| `action` | `BUY` \| `SELL` | Yes | |
| `universal_symbol_id` | UUID | Yes | From `search_symbol` |
| `order_type` | `Market` \| `Limit` \| `Stop` \| `StopLimit` | Yes | |
| `time_in_force` | `Day` \| `GTC` \| `FOK` \| `IOC` | No | Default: `Day` |
| `units` | number | Yes | Share quantity |
| `price` | number | No | Required for `Limit` / `StopLimit` |
| `stop` | number | No | Required for `Stop` / `StopLimit` |

---

### `equity_confirm`

Execute a previously previewed equity order using the `trade_id` from `equity_impact`. This is a destructive operation.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `trade_id` | UUID | Yes | From `equity_impact` response |

---

### `equity_force_place`

Place an equity order without an impact preview. Required for after-hours trading or when the broker does not support the impact endpoint. This is a destructive operation that skips the preview step.

Accepts all parameters from `equity_impact` plus:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `trading_session` | `REGULAR` \| `EXTENDED` | No | Default: `REGULAR` |

---

### `mleg_impact`

Preview a multi-leg option order (spreads, condors, straddles, etc.). Returns estimated impact and a `legs` structure. Always call this before `mleg_place`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `account_id` | UUID | Yes | |
| `time_in_force` | `DAY` \| `GTC` | Yes | |
| `price` | number | Yes | Net debit/credit for the spread |
| `legs` | array | Yes | Array of leg objects (see below) |

Each leg:

| Field | Type | Description |
|---|---|---|
| `action` | `BUY_TO_OPEN` \| `SELL_TO_OPEN` \| `BUY_TO_CLOSE` \| `SELL_TO_CLOSE` | |
| `option_symbol_id` | string | SnapTrade option symbol ID |
| `quantity` | number | Number of contracts |

---

### `mleg_place`

Place a multi-leg option order. This is a destructive operation. No server-side guard enforces that `mleg_impact` was called first — see Known Limitations.

Accepts the same parameters as `mleg_impact`.

---

### `cancel_order`

Cancel a pending order by its brokerage order ID. This is a destructive operation.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `account_id` | UUID | Yes | |
| `brokerage_order_id` | UUID | Yes | From `list_orders` response |

---

### `list_orders`

List orders for an account with optional state filtering.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `account_id` | UUID | Yes | |
| `state` | `all` \| `open` \| `executed` | No | Default: `all` |

---

## Broker compatibility

| Broker | Status | Notes |
|---|---|---|
| E*TRADE | Verified | Including LLC partnership accounts |
| IBKR | Verified | Individual and entity (LLC) connections |
| Fidelity | Partial | Read path verified; trading scope depends on brokerage approval by SnapTrade |
| Robinhood | Not supported | Error 1063: SnapTrade reports Robinhood does not support trading via their API |
| TradeStation | Not supported | Use TradeStation's direct API |

---

## Known limitations

**After-hours / market hours (error 1019)**
SnapTrade's impact endpoint (`equity_impact`) enforces regular trading hours. If called outside market hours, SnapTrade returns error code 1019. Use `equity_force_place` with `trading_session=EXTENDED` to bypass the impact preview for after-hours trades. You lose the impact preview in exchange.

**Robinhood is read-only (error 1063)**
SnapTrade returns error code 1063 for any trading attempt against Robinhood-connected accounts. This is a SnapTrade platform restriction, not a bug in this server.

**`mleg_place` has no server-side impact-preview gate**
Unlike the equity flow (`equity_impact` → `equity_confirm`), there is no server-side enforcement that `mleg_impact` was called before `mleg_place`. LLM prompts must always call `mleg_impact` first. A `SNAPTRADE_REQUIRE_MLEG_IMPACT` environment flag is planned for v0.2.

**No dry-run mode**
There is no `SNAPTRADE_DRY_RUN` kill switch. All destructive tools (`equity_confirm`, `equity_force_place`, `mleg_place`, `cancel_order`) fire against the live SnapTrade API. If you need simulation, gate it at the MCP-host level. Dry-run support is planned for v0.2.

**Diagnostic scripts place live orders**
`examples/diag-ah-place.ts` places a real order. It requires `SNAPTRADE_ALLOW_LIVE_DIAG=true` to be set explicitly. Do not run diag scripts in production without understanding what they do.

---

## Security notes

- All SnapTrade credentials are read from environment variables and are never logged or returned in tool output.
- Error responses from SnapTrade are sanitized before being returned to the LLM — credentials are not echoed back.
- The tools `equity_confirm`, `equity_force_place`, `mleg_place`, and `cancel_order` are destructive. Their MCP descriptions flag this, but human confirmation before execution is strongly recommended. Do not configure the MCP host to auto-approve these without review.
- `equity_force_place` and `mleg_place` bypass the impact preview step. An LLM calling these without showing the user a preview first is operating without a safety net.
- Report vulnerabilities via [GitHub Security Advisories](https://github.com/nkrvivek/snaptrade-trade-mcp/security/advisories) rather than public issues.

---

## Roadmap

**v0.2**
- `SNAPTRADE_DRY_RUN` — log what would be sent without hitting SnapTrade
- `SNAPTRADE_REQUIRE_MLEG_IMPACT` — server-side gate enforcing impact preview before `mleg_place`
- Session-keyed impact-preview token: carry the `trade_id` / impact state in server memory per session

**Future / separate repos**
- Unusual Whales options-flow signals as a companion MCP — not bundled here. This repo stays focused on the SnapTrade write surface.

---

## Using with Claude Code

This project includes a `CLAUDE.md` with full context for Claude Code sessions.

```bash
claude    # starts Claude Code, reads CLAUDE.md automatically
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 nkrvivek.
