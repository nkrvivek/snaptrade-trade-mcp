/**
 * LIVE dry-run: place BUY 1sh NVDA @ $1 Limit Day trading_session=EXTENDED
 * on a broker account, then cancel immediately.
 *
 * Safety: $1 limit on a stock trading well above that cannot fill. Cancel runs
 * within seconds of placement. Worst case: order sits open until AH close and
 * still won't fill.
 *
 * WARNING: This script places a real order. Real money. Use only for diagnostics.
 *
 * Usage:
 *   SNAPTRADE_ALLOW_LIVE_DIAG=true BROKER_ACCOUNT_ID=<your-account-uuid> tsx examples/diag-ah-place.ts
 */
import { Snaptrade } from "snaptrade-typescript-sdk";

const {
  SNAPTRADE_CLIENT_ID,
  SNAPTRADE_CONSUMER_KEY,
  SNAPTRADE_USER_ID,
  SNAPTRADE_USER_SECRET,
  BROKER_ACCOUNT_ID,
  SNAPTRADE_ALLOW_LIVE_DIAG,
} = process.env;

if (SNAPTRADE_ALLOW_LIVE_DIAG !== "true") {
  console.error(
    "REFUSING TO RUN: this script places a real order against a live brokerage account.\n" +
      "Set SNAPTRADE_ALLOW_LIVE_DIAG=true to acknowledge and proceed.",
  );
  process.exit(1);
}

if (!SNAPTRADE_CLIENT_ID || !SNAPTRADE_CONSUMER_KEY || !SNAPTRADE_USER_ID || !SNAPTRADE_USER_SECRET) {
  console.error("Missing env vars");
  process.exit(1);
}

if (!BROKER_ACCOUNT_ID) {
  console.error("Missing BROKER_ACCOUNT_ID. Set it to the SnapTrade account UUID to test against.");
  process.exit(1);
}

const client = new Snaptrade({ clientId: SNAPTRADE_CLIENT_ID, consumerKey: SNAPTRADE_CONSUMER_KEY });
const accountId = BROKER_ACCOUNT_ID;

function summarizeErr(e: any) {
  return {
    status: (e as any)?.status,
    statusText: (e as any)?.statusText,
    code: (e as any)?.responseBody?.code,
    detail: (e as any)?.responseBody?.detail,
    meta: (e as any)?.responseBody?.meta,
    url: (e as any)?.url,
  };
}

async function main() {
  console.log(`[diag-ah-place] resolving NVDA on account ${accountId} ...`);
  const s = await client.referenceData.symbolSearchUserAccount({
    userId: SNAPTRADE_USER_ID!,
    userSecret: SNAPTRADE_USER_SECRET!,
    accountId,
    substring: "NVDA",
  });
  const usid = (s.data as any[]).find((x: any) => x?.raw_symbol === "NVDA")?.id ?? (s.data as any[])[0]?.id;
  console.log(`  universal_symbol_id: ${usid}`);

  console.log("[diag-ah-place] placing BUY 1sh NVDA @ $1 Limit Day EXTENDED ...");
  let orderId: string | undefined;
  try {
    const r = await client.trading.placeForceOrder({
      userId: SNAPTRADE_USER_ID!,
      userSecret: SNAPTRADE_USER_SECRET!,
      account_id: accountId,
      action: "BUY",
      universal_symbol_id: usid,
      order_type: "Limit",
      time_in_force: "Day",
      units: 1,
      price: 1.0,
      trading_session: "EXTENDED",
    } as any);
    const data = r.data as any;
    orderId = data?.brokerage_order_id;
    console.log("  OK — order record:");
    console.log("    brokerage_order_id:", orderId);
    console.log("    state:", data?.state);
    console.log("    filled:", data?.filled_quantity, "/", data?.total_quantity);
    console.log("    price:", data?.limit_price ?? data?.price);
    console.log("    trading_session:", data?.trading_session);
    console.log("    full:", JSON.stringify(data, null, 2));
  } catch (e: any) {
    console.error("  ERR placing:", JSON.stringify(summarizeErr(e), null, 2));
    process.exit(1);
  }

  if (!orderId) {
    console.error("[diag-ah-place] no brokerage_order_id returned; refusing to leave unconfirmed.");
    process.exit(1);
  }

  console.log(`[diag-ah-place] canceling ${orderId} ...`);
  try {
    const c = await client.trading.cancelUserAccountOrder({
      userId: SNAPTRADE_USER_ID!,
      userSecret: SNAPTRADE_USER_SECRET!,
      accountId: accountId,
      brokerage_order_id: orderId,
    });
    console.log("  cancel resp:", JSON.stringify(c.data, null, 2));
  } catch (e: any) {
    console.error("  ERR canceling:", JSON.stringify(summarizeErr(e), null, 2));
    console.error("  WARNING: ORDER MAY STILL BE OPEN — check your broker UI.");
    // Distinct exit code so ops can page specifically on "order left open".
    process.exit(2);
  }

  console.log("[diag-ah-place] done.");
}

main().catch((e) => {
  console.error("[diag-ah-place] fatal:", e);
  process.exit(1);
});
