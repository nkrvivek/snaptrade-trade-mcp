#!/usr/bin/env node
/**
 * snaptrade-trade-mcp — unified MCP server for SnapTrade reads + trading.
 *
 * Read tools:
 *   - check_status            : SnapTrade API health check
 *   - list_accounts           : list all brokerage accounts for the user
 *   - list_brokerages         : list all SnapTrade-supported brokerages
 *   - get_balance             : account balances (cash + buying power)
 *   - get_positions           : account positions (equity + options)
 *   - get_holdings            : combined balance + positions + orders per account
 *   - get_activities          : transaction + activity history
 *   - list_orders             : open/executed orders (renamed from get_orders)
 *   - search_symbol           : ticker → universal_symbol_id (account-scoped)
 *
 * Trade tools (DESTRUCTIVE — gate behind user confirm):
 *   - equity_impact           : preview equity order
 *   - equity_confirm          : execute previously previewed trade_id
 *   - equity_force_place      : place equity w/o impact preview
 *   - mleg_impact             : preview multi-leg option order
 *   - mleg_place              : place multi-leg option order
 *   - cancel_order            : cancel pending order by brokerage_order_id
 *
 * Auth: SNAPTRADE_CLIENT_ID, SNAPTRADE_CONSUMER_KEY, SNAPTRADE_USER_ID, SNAPTRADE_USER_SECRET.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Snaptrade } from "snaptrade-typescript-sdk";
import { z } from "zod";

const CLIENT_ID = process.env.SNAPTRADE_CLIENT_ID;
const CONSUMER_KEY = process.env.SNAPTRADE_CONSUMER_KEY;
const USER_ID = process.env.SNAPTRADE_USER_ID;
const USER_SECRET = process.env.SNAPTRADE_USER_SECRET;

if (!CLIENT_ID || !CONSUMER_KEY || !USER_ID || !USER_SECRET) {
  console.error(
    "[snaptrade-trade-mcp] Missing env: SNAPTRADE_CLIENT_ID, SNAPTRADE_CONSUMER_KEY, SNAPTRADE_USER_ID, SNAPTRADE_USER_SECRET all required.",
  );
  process.exit(1);
}

const client = new Snaptrade({
  clientId: CLIENT_ID,
  consumerKey: CONSUMER_KEY,
});

// ---------- Schemas ----------

const SearchSymbolInput = z.object({
  account_id: z.string().describe("SnapTrade account UUID"),
  ticker: z.string().describe("Ticker symbol e.g. SLV, NVDA"),
});

const EquityImpactInput = z.object({
  account_id: z.string(),
  action: z.enum(["BUY", "SELL"]),
  universal_symbol_id: z.string().describe("Resolve via search_symbol first"),
  order_type: z.enum(["Market", "Limit", "Stop", "StopLimit"]),
  time_in_force: z.enum(["Day", "GTC", "FOK", "IOC"]).default("Day"),
  units: z.number().positive(),
  price: z.number().positive().optional().describe("Required for Limit / StopLimit"),
  stop: z.number().positive().optional().describe("Required for Stop / StopLimit"),
  trading_session: z
    .enum(["REGULAR", "EXTENDED"])
    .optional()
    .describe(
      "Market session: REGULAR (default) or EXTENDED (pre-market + after-hours). Broker-dependent. NOTE: getOrderImpact enforces RTH regardless — EXTENDED only usable via equity_force_place.",
    ),
});

const EquityConfirmInput = z.object({
  trade_id: z.string().describe("Returned by equity_impact"),
  wait_to_confirm: z
    .boolean()
    .optional()
    .describe("If true, wait for broker fill confirmation"),
});

const EquityForcePlaceInput = EquityImpactInput;

const MlegLegSchema = z.object({
  // SnapTrade expects MlegTradingInstrument = { symbol, instrument_type }.
  // Symbol: 21-char OCC for options (e.g. `AAPL  251114C00240000`) or plain ticker for equity.
  instrument_symbol: z
    .string()
    .describe(
      "21-char OCC for options (e.g. `NVDA  260515P00180000`) or plain ticker for equity",
    ),
  instrument_type: z
    .enum(["OPTION", "EQUITY"])
    .default("OPTION")
    .describe("Leg instrument type; defaults to OPTION"),
  action: z.enum([
    "BUY_TO_OPEN",
    "BUY_TO_CLOSE",
    "SELL_TO_OPEN",
    "SELL_TO_CLOSE",
  ]),
  units: z.number().int().positive().describe("Number of contracts"),
});

const MlegInput = z.object({
  account_id: z.string(),
  order_type: z
    .enum(["MARKET", "LIMIT", "STOP_LOSS_MARKET", "STOP_LOSS_LIMIT"])
    .default("LIMIT"),
  time_in_force: z.enum(["Day", "GTC", "FOK", "IOC"]).default("Day"),
  limit_price: z.string().optional().describe("Net debit/credit as string e.g. '0.57'"),
  stop_price: z.string().optional(),
  price_effect: z
    .enum(["DEBIT", "CREDIT"])
    .optional()
    .describe("DEBIT for net pay, CREDIT for net receive"),
  legs: z.array(MlegLegSchema).min(1).max(4),
});

const CancelInput = z.object({
  account_id: z.string(),
  brokerage_order_id: z.string(),
});

const ListOrdersInput = z.object({
  account_id: z.string(),
  state: z.enum(["all", "open", "executed"]).default("all"),
  days: z.number().int().positive().max(90).optional(),
});

// Read-only schemas
const NoArgs = z.object({});
const AccountIdInput = z.object({ account_id: z.string() });
const ActivitiesInput = z.object({
  start_date: z.string().optional().describe("ISO YYYY-MM-DD"),
  end_date: z.string().optional().describe("ISO YYYY-MM-DD"),
  accounts: z.string().optional().describe("Comma-separated account UUIDs"),
  type: z
    .string()
    .optional()
    .describe("e.g. DIVIDEND, BUY, SELL, FEE — comma-separated for multiple"),
});

// ---------- Tool registry ----------

const TOOLS = [
  // ----- Read tools -----
  {
    name: "check_status",
    description: "SnapTrade API health check. No args. Returns version + online status.",
    inputSchema: zodToInputSchema(NoArgs),
  },
  {
    name: "list_accounts",
    description:
      "List all brokerage accounts connected to the SnapTrade user. No args. Returns Account[] with UUIDs, names, brokerage info.",
    inputSchema: zodToInputSchema(NoArgs),
  },
  {
    name: "list_brokerages",
    description:
      "List all SnapTrade-supported brokerages (reference data, not user-specific). No args.",
    inputSchema: zodToInputSchema(NoArgs),
  },
  {
    name: "get_balance",
    description: "Get cash + buying power balances for a specific account.",
    inputSchema: zodToInputSchema(AccountIdInput),
  },
  {
    name: "get_positions",
    description: "Get equity + option positions for a specific account.",
    inputSchema: zodToInputSchema(AccountIdInput),
  },
  {
    name: "get_holdings",
    description:
      "Get combined balance + positions + orders for an account in one call (SnapTrade getUserHoldings). Preferred for portfolio snapshots.",
    inputSchema: zodToInputSchema(AccountIdInput),
  },
  {
    name: "get_activities",
    description:
      "Get transaction / activity history. Filters: start_date, end_date, accounts (comma-separated UUIDs), type (DIVIDEND/BUY/SELL/FEE/etc).",
    inputSchema: zodToInputSchema(ActivitiesInput),
  },
  // ----- Trading tools -----
  {
    name: "search_symbol",
    description:
      "Resolve a ticker to a SnapTrade universal_symbol_id, scoped to an account (returns broker-compatible symbols). Use BEFORE equity_impact/equity_force_place.",
    inputSchema: zodToInputSchema(SearchSymbolInput),
  },
  {
    name: "equity_impact",
    description:
      "PREVIEW (does not place) an equity order. Returns trade_id + estimated commissions, cash effect, warnings. Always run before equity_confirm. Idempotent — safe to retry.",
    inputSchema: zodToInputSchema(EquityImpactInput),
  },
  {
    name: "equity_confirm",
    description:
      "DESTRUCTIVE — submits an order to the broker via a trade_id from equity_impact. Real money. Confirm with user before calling.",
    inputSchema: zodToInputSchema(EquityConfirmInput),
  },
  {
    name: "equity_force_place",
    description:
      "DESTRUCTIVE — places equity order WITHOUT impact preview. Use when (a) broker doesn't support impact or (b) you need extended-hours (trading_session=EXTENDED) since impact enforces RTH. Real money. Confirm with user before calling.",
    inputSchema: zodToInputSchema(EquityForcePlaceInput),
  },
  {
    name: "mleg_impact",
    description:
      "PREVIEW (does not place) a multi-leg option order (spreads, condors, etc.). Returns estimated effect.",
    inputSchema: zodToInputSchema(MlegInput),
  },
  {
    name: "mleg_place",
    description:
      "DESTRUCTIVE — places multi-leg option order (spreads, condors, etc.). Real money. Confirm with user before calling.",
    inputSchema: zodToInputSchema(MlegInput),
  },
  {
    name: "cancel_order",
    description:
      "Cancel a pending order by brokerage_order_id. Idempotent if already filled/cancelled (broker will return error).",
    inputSchema: zodToInputSchema(CancelInput),
  },
  {
    name: "list_orders",
    description:
      "List account orders. State: all | open | executed. Optional days limit (default broker-determined).",
    inputSchema: zodToInputSchema(ListOrdersInput),
  },
];

// ---------- Server ----------

const server = new Server(
  {
    name: "snaptrade-trade-mcp",
    version: "0.1.0",
  },
  {
    capabilities: { tools: {} },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    switch (name) {
      // Reads
      case "check_status":
        return await handleCheckStatus();
      case "list_accounts":
        return await handleListAccounts();
      case "list_brokerages":
        return await handleListBrokerages();
      case "get_balance":
        return await handleGetBalance(AccountIdInput.parse(args));
      case "get_positions":
        return await handleGetPositions(AccountIdInput.parse(args));
      case "get_holdings":
        return await handleGetHoldings(AccountIdInput.parse(args));
      case "get_activities":
        return await handleGetActivities(ActivitiesInput.parse(args));
      // Trades
      case "search_symbol":
        return await handleSearchSymbol(SearchSymbolInput.parse(args));
      case "equity_impact":
        return await handleEquityImpact(EquityImpactInput.parse(args));
      case "equity_confirm":
        return await handleEquityConfirm(EquityConfirmInput.parse(args));
      case "equity_force_place":
        return await handleEquityForcePlace(EquityForcePlaceInput.parse(args));
      case "mleg_impact":
        return await handleMlegImpact(MlegInput.parse(args));
      case "mleg_place":
        return await handleMlegPlace(MlegInput.parse(args));
      case "cancel_order":
        return await handleCancel(CancelInput.parse(args));
      case "list_orders":
        return await handleListOrders(ListOrdersInput.parse(args));
      default:
        return errResp(`Unknown tool: ${name}`);
    }
  } catch (e: any) {
    // SnaptradeError exposes parsed body on e.responseBody (NOT e.response.data).
    const status = e?.status ?? e?.response?.status;
    const statusText = e?.statusText ?? e?.response?.statusText;
    const rb = e?.responseBody ?? e?.response?.data ?? e?.message ?? String(e ?? "unknown error");
    const body = typeof rb === "string" ? rb : JSON.stringify(rb);
    return errResp(
      `[${name}] failed: status=${status ?? "?"} ${statusText ?? ""} body=${body}`,
    );
  }
});

// ---------- Handlers ----------

async function handleCheckStatus() {
  const r = await client.apiStatus.check();
  return okResp(r.data);
}

async function handleListAccounts() {
  const r = await client.accountInformation.listUserAccounts({
    userId: USER_ID!,
    userSecret: USER_SECRET!,
  });
  return okResp(r.data);
}

async function handleListBrokerages() {
  const r = await client.referenceData.listAllBrokerages();
  return okResp(r.data);
}

async function handleGetBalance(args: z.infer<typeof AccountIdInput>) {
  const r = await client.accountInformation.getUserAccountBalance({
    userId: USER_ID!,
    userSecret: USER_SECRET!,
    accountId: args.account_id,
  });
  return okResp(r.data);
}

async function handleGetPositions(args: z.infer<typeof AccountIdInput>) {
  const r = await client.accountInformation.getUserAccountPositions({
    userId: USER_ID!,
    userSecret: USER_SECRET!,
    accountId: args.account_id,
  });
  return okResp(r.data);
}

async function handleGetHoldings(args: z.infer<typeof AccountIdInput>) {
  const r = await client.accountInformation.getUserHoldings({
    userId: USER_ID!,
    userSecret: USER_SECRET!,
    accountId: args.account_id,
  });
  return okResp(r.data);
}

async function handleGetActivities(args: z.infer<typeof ActivitiesInput>) {
  const r = await client.transactionsAndReporting.getActivities({
    userId: USER_ID!,
    userSecret: USER_SECRET!,
    startDate: args.start_date,
    endDate: args.end_date,
    accounts: args.accounts,
    type: args.type,
  });
  return okResp(r.data);
}

async function handleSearchSymbol(args: z.infer<typeof SearchSymbolInput>) {
  const r = await client.referenceData.symbolSearchUserAccount({
    userId: USER_ID!,
    userSecret: USER_SECRET!,
    accountId: args.account_id,
    substring: args.ticker,
  });
  return okResp(r.data);
}

async function handleEquityImpact(args: z.infer<typeof EquityImpactInput>) {
  // NOTE: trading_session not supported by getOrderImpact (ManualTradeForm lacks it).
  // We pass it through anyway in case SnapTrade adds support; currently the backend
  // enforces RTH via code 1019 regardless.
  const r = await client.trading.getOrderImpact({
    userId: USER_ID!,
    userSecret: USER_SECRET!,
    account_id: args.account_id,
    action: args.action,
    universal_symbol_id: args.universal_symbol_id,
    order_type: args.order_type,
    time_in_force: args.time_in_force,
    units: args.units,
    price: args.price ?? null,
    stop: args.stop ?? null,
    ...(args.trading_session ? { trading_session: args.trading_session } : {}),
  } as any);
  return okResp(r.data);
}

async function handleEquityConfirm(args: z.infer<typeof EquityConfirmInput>) {
  const r = await client.trading.placeOrder({
    userId: USER_ID!,
    userSecret: USER_SECRET!,
    tradeId: args.trade_id,
    validatedTradeBody: args.wait_to_confirm
      ? { wait_to_confirm: args.wait_to_confirm }
      : undefined,
  } as any);
  return okResp(r.data);
}

async function handleEquityForcePlace(
  args: z.infer<typeof EquityForcePlaceInput>,
) {
  const r = await client.trading.placeForceOrder({
    userId: USER_ID!,
    userSecret: USER_SECRET!,
    account_id: args.account_id,
    action: args.action,
    universal_symbol_id: args.universal_symbol_id,
    order_type: args.order_type,
    time_in_force: args.time_in_force,
    units: args.units,
    price: args.price ?? null,
    stop: args.stop ?? null,
    ...(args.trading_session ? { trading_session: args.trading_session } : {}),
  } as any);
  return okResp(r.data);
}

async function handleMlegImpact(args: z.infer<typeof MlegInput>) {
  const r = await client.trading.getOptionImpact({
    userId: USER_ID!,
    userSecret: USER_SECRET!,
    accountId: args.account_id,
    ...buildMlegBody(args),
  });
  return okResp(r.data);
}

async function handleMlegPlace(args: z.infer<typeof MlegInput>) {
  const r = await client.trading.placeMlegOrder({
    userId: USER_ID!,
    userSecret: USER_SECRET!,
    accountId: args.account_id,
    ...buildMlegBody(args),
  });
  return okResp(r.data);
}

async function handleCancel(args: z.infer<typeof CancelInput>) {
  const r = await client.trading.cancelUserAccountOrder({
    userId: USER_ID!,
    userSecret: USER_SECRET!,
    accountId: args.account_id,
    brokerage_order_id: args.brokerage_order_id,
  });
  return okResp(r.data);
}

async function handleListOrders(args: z.infer<typeof ListOrdersInput>) {
  const r = await client.accountInformation.getUserAccountOrders({
    userId: USER_ID!,
    userSecret: USER_SECRET!,
    accountId: args.account_id,
    state: args.state,
    days: args.days,
  });
  return okResp(r.data);
}

// ---------- Helpers ----------

function buildMlegBody(args: z.infer<typeof MlegInput>) {
  return {
    order_type: args.order_type,
    time_in_force: args.time_in_force,
    limit_price: args.limit_price ?? null,
    stop_price: args.stop_price ?? null,
    price_effect: args.price_effect ?? null,
    legs: args.legs.map((l) => ({
      // MlegTradingInstrument requires BOTH symbol AND instrument_type.
      // Omitting instrument_type → 500 "Encountered an unexpected exception" (code 1000).
      instrument: {
        symbol: l.instrument_symbol,
        instrument_type: l.instrument_type,
      } as any,
      action: l.action,
      units: l.units,
    })),
  } as any;
}

function okResp(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errResp(msg: string) {
  return {
    content: [{ type: "text" as const, text: `ERROR: ${msg}` }],
    isError: true,
  };
}

function zodToInputSchema(schema: z.ZodType): Record<string, unknown> {
  const s = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  // MCP wants a top-level object schema; strip $schema metadata.
  delete s.$schema;
  return s;
}

// ---------- Run ----------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[snaptrade-trade-mcp] ready on stdio");
}

main().catch((e) => {
  console.error("[snaptrade-trade-mcp] fatal:", e);
  process.exit(1);
});
