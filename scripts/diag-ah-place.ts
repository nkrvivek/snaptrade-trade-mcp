/**
 * LIVE dry-run: place BUY 1sh NVDA @ $1 Limit Day trading_session=EXTENDED
 * on Bildof E-Trade, then cancel immediately.
 *
 * Safety: $1 limit on a ~$185 stock cannot fill. Cancel runs within seconds
 * of placement. Worst case: order sits open until 8pm ET AH close, still won't fill.
 */
import { Snaptrade } from "snaptrade-typescript-sdk";

const {
  SNAPTRADE_CLIENT_ID,
  SNAPTRADE_CONSUMER_KEY,
  SNAPTRADE_USER_ID,
  SNAPTRADE_USER_SECRET,
} = process.env;

if (!SNAPTRADE_CLIENT_ID || !SNAPTRADE_CONSUMER_KEY || !SNAPTRADE_USER_ID || !SNAPTRADE_USER_SECRET) {
  console.error("Missing env vars");
  process.exit(1);
}

const client = new Snaptrade({ clientId: SNAPTRADE_CLIENT_ID, consumerKey: SNAPTRADE_CONSUMER_KEY });
const BILDOF = "cb13f4fe-ba68-4d89-b6de-4e110949b129";

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
  console.log("[diag-ah-place] resolving NVDA on Bildof ...");
  const s = await client.referenceData.symbolSearchUserAccount({
    userId: SNAPTRADE_USER_ID!,
    userSecret: SNAPTRADE_USER_SECRET!,
    accountId: BILDOF,
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
      account_id: BILDOF,
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
      accountId: BILDOF,
      brokerage_order_id: orderId,
    });
    console.log("  cancel resp:", JSON.stringify(c.data, null, 2));
  } catch (e: any) {
    console.error("  ERR canceling:", JSON.stringify(summarizeErr(e), null, 2));
    console.error("  ⚠️  ORDER MAY STILL BE OPEN — check E-Trade UI.");
    process.exit(1);
  }

  console.log("[diag-ah-place] done ✓");
}

main().catch((e) => {
  console.error("[diag-ah-place] fatal:", e);
  process.exit(1);
});
