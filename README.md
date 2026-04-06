# @agenttax/ampersend

Tax compliance layer for Ampersend x402 agent payments. Wraps any `X402Treasurer` to automatically calculate US sales tax on every settled transaction.

Zero dependencies beyond the Ampersend SDK you already have.

## Install

```bash
npm install @agenttax/ampersend
```

Or copy `index.js` directly — it's a single file with no dependencies.

## Quick Start

```javascript
import { createAmpersendTreasurer } from "ampersend-sdk";
import { withTaxCompliance } from "@agenttax/ampersend";

// Your existing Ampersend setup
const treasurer = createAmpersendTreasurer({
  wallet: myWallet,
  apiKey: process.env.AMPERSEND_SESSION_KEY,
});

// Wrap it with tax compliance — one line
const taxTreasurer = withTaxCompliance(treasurer, {
  apiKey: "atx_live_...",          // Free at agenttax.io — 100 calls/mo
  defaultBuyerState: "TX",         // Buyer's US state
  transactionType: "compute",      // compute, saas, api_access, consulting, etc.
});

// Use taxTreasurer exactly like your original treasurer.
// Tax is calculated automatically on every accepted payment.
```

## What It Does

Every time an x402 payment settles through your Ampersend Treasurer:

1. The payment goes through normally (your Treasurer logic is unchanged)
2. On `status: "accepted"`, AgentTax calculates the applicable sales tax
3. The tax result (amount, rate, jurisdiction, statute citation) is logged
4. Your `onTaxCalculated` callback fires if provided

Tax calculation never blocks or delays payments — it runs async after settlement.

## Get Tax Summary

```javascript
// After some transactions...
const summary = taxTreasurer.getTaxSummary();

console.log(summary);
// {
//   transactions: 47,
//   totalAmount: 125.50,
//   totalTax: 6.28,
//   effectiveRate: 0.05,
//   byJurisdiction: { Texas: 4.50, California: 0, "New York": 1.78 }
// }
```

## Per-Transaction Tax Details

```javascript
const taxTreasurer = withTaxCompliance(treasurer, {
  apiKey: "atx_live_...",
  defaultBuyerState: "TX",
  transactionType: "compute",
  onTaxCalculated: (entry) => {
    console.log(`Payment ${entry.authorizationId}: $${entry.amount}`);
    console.log(`  Tax: $${entry.tax.total_tax} (${entry.tax.sales_tax?.jurisdiction})`);
    console.log(`  Rate: ${(entry.tax.sales_tax?.rate * 100).toFixed(2)}%`);
    console.log(`  Note: ${entry.tax.sales_tax?.note}`);
    // → Payment abc123: $5.00
    // →   Tax: $0.25 (Texas)
    // →   Rate: 6.25%
    // →   Note: TX Tax Code §151.351 — 20% statutory exemption
  },
});
```

## Dynamic State Resolution

If your agents transact across multiple states, provide a `resolveState` function:

```javascript
const taxTreasurer = withTaxCompliance(treasurer, {
  apiKey: "atx_live_...",
  defaultBuyerState: "CA",           // Fallback
  transactionType: "saas",
  resolveState: (context, authorization) => {
    // Determine state from payment context metadata
    return context?.metadata?.buyerState || "CA";
  },
});
```

## Standalone Calculator

Don't use Ampersend's Treasurer pattern? Use the standalone calculator:

```javascript
import { createTaxCalculator } from "@agenttax/ampersend";

const tax = createTaxCalculator({
  apiKey: "atx_live_...",
  defaultBuyerState: "NY",
  transactionType: "api_access",
});

// Calculate tax for any transaction
const result = await tax.calculate({ amount: 100.00 });
console.log(result.total_tax);  // 4.00 (NY 4% state rate)

// Batch calculation
for (const payment of ampersendPaymentHistory) {
  await tax.calculate({
    amount: payment.amountUsd,
    buyerState: payment.buyerState,
    counterpartyId: payment.sellerId,
  });
}

console.log(tax.getTaxSummary());
```

## How Tax Works for x402 Payments

When your agent pays for compute/API/storage via x402:

- **45 states + DC** levy sales tax on digital services
- Each state classifies AI agent transactions differently ("data processing" in TX, "prewritten software" in NY, "digital automated service" in WA)
- Texas applies an 80% taxable rule (§151.351) — $1.00 payment = $0.05 tax, not $0.0625
- Connecticut has a separate 1% rate for data processing vs 6.35% for info services
- Iowa exempts B2B digital transactions entirely
- The rate depends on **what** the agent does, **where** the buyer is, and **who** is buying

AgentTax resolves all of this per-transaction. Every response includes the jurisdiction, statute citation, and confidence score.

## API Key

Get a free API key at [agenttax.io](https://agenttax.io) — 100 calls/month, no credit card.

Paid plans: Starter $25/mo (10K calls), Growth $99/mo (100K), Pro $199/mo (1M).

Try it without signing up: [agenttax.io/playground](https://agenttax.io/playground)

## Links

- [AgentTax](https://agenttax.io) — The tax engine for AI agent commerce
- [AgentTax API Docs](https://agenttax.io/api-docs)
- [Python SDK](https://pypi.org/project/agenttax/) — `pip install agenttax`
- [Ampersend](https://ampersend.ai) — The control layer for the agent economy
- [Ampersend SDK](https://github.com/edgeandnode/ampersend-sdk)
- [x402 Protocol](https://x402.org)

## License

MIT
