/**
 * Diagnose whether SnapTrade equity impact preview accepts
 * trading_session=EXTENDED outside RTH.
 *
 * Safety: uses 1 share BUY @ $1 Limit — preview only, and even if
 * accidentally placed would never fill. Runs against multiple
 * accounts to see which brokers support AH on impact endpoint.
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

const TEST_ACCOUNTS = [
  { label: "Bildof E-Trade", id: "cb13f4fe-ba68-4d89-b6de-4e110949b129" },
  { label: "Robinhood Individual", id: "0c4f0a03-f0c4-4bc4-a0d1-c7775479aaf6" },
];

function summarizeErr(e: any) {
  return {
    status: (e as any)?.status,
    code: (e as any)?.responseBody?.code,
    detail: (e as any)?.responseBody?.detail,
    meta: (e as any)?.responseBody?.meta,
  };
}

async function resolveNVDA(accountId: string): Promise<string | null> {
  const r = await client.referenceData.symbolSearchUserAccount({
    userId: SNAPTRADE_USER_ID!,
    userSecret: SNAPTRADE_USER_SECRET!,
    accountId,
    substring: "NVDA",
  });
  const match = (r.data as any[]).find((s: any) => s?.symbol?.symbol === "NVDA" || s?.raw_symbol === "NVDA");
  return match?.id ?? (r.data as any[])[0]?.id ?? null;
}

async function testAccount(label: string, accountId: string) {
  console.log(`\n=============== ${label} (${accountId}) ===============`);
  const usid = await resolveNVDA(accountId);
  if (!usid) {
    console.log(`  [skip] could not resolve NVDA for ${label}`);
    return;
  }
  console.log(`  universal_symbol_id: ${usid}`);

  const shared = {
    userId: SNAPTRADE_USER_ID!,
    userSecret: SNAPTRADE_USER_SECRET!,
    account_id: accountId,
    action: "BUY" as const,
    universal_symbol_id: usid,
    order_type: "Limit" as const,
    time_in_force: "Day" as const,
    units: 1,
    price: 1.0,
  };

  console.log(`  -- test A: impact w/o trading_session (default REGULAR) --`);
  try {
    const r = await client.trading.getOrderImpact(shared as any);
    console.log(`    OK: trade_id=${(r.data as any)?.trade?.id ?? "?"}`);
  } catch (e: any) {
    console.log(`    ERR: ${JSON.stringify(summarizeErr(e))}`);
  }

  console.log(`  -- test B: impact w/ trading_session=EXTENDED --`);
  try {
    const r = await client.trading.getOrderImpact({ ...shared, trading_session: "EXTENDED" } as any);
    console.log(`    OK: trade_id=${(r.data as any)?.trade?.id ?? "?"}`);
    const warn = (r.data as any)?.trade?.warnings;
    if (warn) console.log(`    warnings: ${JSON.stringify(warn)}`);
  } catch (e: any) {
    console.log(`    ERR: ${JSON.stringify(summarizeErr(e))}`);
  }
}

async function main() {
  const now = new Date();
  console.log(`[diag-ah] ${now.toISOString()} — testing AH equity impact`);
  for (const acct of TEST_ACCOUNTS) {
    await testAccount(acct.label, acct.id);
  }
}

main().catch((e) => {
  console.error("[diag-ah] fatal:", e);
  process.exit(1);
});
