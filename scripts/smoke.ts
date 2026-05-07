/**
 * Smoke test — verify SnapTrade auth works end-to-end by listing orders
 * for the Bildof E*TRADE account. Does NOT place any trades.
 *
 * Usage:
 *   BILDOF_ACCOUNT_ID=<uuid> tsx scripts/smoke.ts
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
  !SNAPTRADE_USER_SECRET
) {
  console.error("Missing SnapTrade env vars.");
  process.exit(1);
}

const client = new Snaptrade({
  clientId: SNAPTRADE_CLIENT_ID,
  consumerKey: SNAPTRADE_CONSUMER_KEY,
});

async function main() {
  console.log("[smoke] listing accounts...");
  const accounts = await client.accountInformation.listUserAccounts({
    userId: SNAPTRADE_USER_ID!,
    userSecret: SNAPTRADE_USER_SECRET!,
  });
  for (const a of accounts.data) {
    console.log(`  - ${a.id}  ${a.institution_name}  ${a.name}`);
  }

  const accountId =
    BILDOF_ACCOUNT_ID ?? accounts.data.find((a) => /etrade/i.test(a.institution_name ?? ""))?.id;
  if (!accountId) {
    console.error("[smoke] no E*TRADE account found; set BILDOF_ACCOUNT_ID.");
    process.exit(1);
  }

  console.log(`[smoke] listing orders for ${accountId}...`);
  const orders = await client.accountInformation.getUserAccountOrders({
    userId: SNAPTRADE_USER_ID!,
    userSecret: SNAPTRADE_USER_SECRET!,
    accountId,
    state: "all",
  });
  console.log(`[smoke] got ${orders.data.length} order(s).`);
  console.log(JSON.stringify(orders.data.slice(0, 3), null, 2));
}

main().catch((e: any) => {
  const detail = e?.response?.data ?? e?.message ?? e;
  console.error("[smoke] FAILED:", detail);
  process.exit(1);
});
