/**
 * Diagnose Bildof 403 on equity_impact — dump full error body/headers.
 *
 * Usage:
 *   BILDOF_ACCOUNT_ID=cb13f4fe-ba68-4d89-b6de-4e110949b129 tsx scripts/diag-403.ts
 */
import { Snaptrade } from "snaptrade-typescript-sdk";

const {
  SNAPTRADE_CLIENT_ID,
  SNAPTRADE_CONSUMER_KEY,
  SNAPTRADE_USER_ID,
  SNAPTRADE_USER_SECRET,
  BILDOF_ACCOUNT_ID,
} = process.env;

if (
  !SNAPTRADE_CLIENT_ID ||
  !SNAPTRADE_CONSUMER_KEY ||
  !SNAPTRADE_USER_ID ||
  !SNAPTRADE_USER_SECRET ||
  !BILDOF_ACCOUNT_ID
) {
  console.error("Missing env. Need SNAPTRADE_* + BILDOF_ACCOUNT_ID.");
  process.exit(1);
}

const client = new Snaptrade({
  clientId: SNAPTRADE_CLIENT_ID,
  consumerKey: SNAPTRADE_CONSUMER_KEY,
});

function dumpErr(tag: string, e: any) {
  console.error(`\n=== ${tag} FAILED ===`);
  console.error("message:", e?.message);
  console.error("code:", e?.code);
  console.error("status:", e?.response?.status, e?.response?.statusText);
  console.error("url:", e?.config?.url ?? e?.request?.path);
  console.error("method:", e?.config?.method);
  console.error("req-headers:", JSON.stringify(e?.config?.headers ?? {}, null, 2));
  console.error("req-body:", e?.config?.data);
  console.error("res-headers:", JSON.stringify(e?.response?.headers ?? {}, null, 2));
  const data = e?.response?.data;
  if (data && typeof data === "object" && data.constructor?.name === "Buffer") {
    console.error("res-body (buf):", Buffer.from(data).toString("utf8"));
  } else {
    console.error("res-body:", typeof data === "string" ? data : JSON.stringify(data, null, 2));
  }
  // SnaptradeError wraps axios & exposes responseBody field
  console.error("responseBody (wrapper):", (e as any)?.responseBody);
  console.error("name:", e?.name);
  console.error("snaptrade-status:", (e as any)?.status, (e as any)?.statusText);
  console.error("snaptrade-url:", (e as any)?.url, "method:", (e as any)?.method);
}

async function main() {
  const accountId = BILDOF_ACCOUNT_ID!;

  // 1) resolve NVDA on this account
  console.log("[diag] symbolSearchUserAccount NVDA ...");
  let usid: string | undefined;
  try {
    const r = await client.referenceData.symbolSearchUserAccount({
      userId: SNAPTRADE_USER_ID!,
      userSecret: SNAPTRADE_USER_SECRET!,
      accountId,
      substring: "NVDA",
    });
    const match = (r.data as any[]).find((s: any) => s?.symbol?.symbol === "NVDA" || s?.raw_symbol === "NVDA");
    usid = match?.id ?? (r.data as any[])[0]?.id;
    console.log("  universal_symbol_id:", usid, "raw:", match?.raw_symbol ?? (r.data as any[])[0]?.raw_symbol);
  } catch (e: any) {
    dumpErr("symbolSearch", e);
    process.exit(1);
  }
  if (!usid) {
    console.error("[diag] no universal_symbol_id for NVDA");
    process.exit(1);
  }

  // 2) try equity_impact — BUY 1 NVDA @ market
  console.log("[diag] getOrderImpact BUY 1 NVDA Market Day ...");
  try {
    const r = await client.trading.getOrderImpact({
      userId: SNAPTRADE_USER_ID!,
      userSecret: SNAPTRADE_USER_SECRET!,
      account_id: accountId,
      action: "BUY",
      universal_symbol_id: usid,
      order_type: "Market",
      time_in_force: "Day",
      units: 1,
    } as any);
    console.log("[diag] UNEXPECTED SUCCESS:", JSON.stringify(r.data, null, 2));
  } catch (e: any) {
    dumpErr("getOrderImpact", e);
  }
}

main().catch((e) => {
  console.error("[diag] fatal:", e);
  process.exit(1);
});
