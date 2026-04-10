/**
 * @agenttax/ampersend -- Tax compliance layer for Ampersend x402 payments.
 *
 * Wraps any Ampersend X402Treasurer to automatically calculate sales tax
 * on every accepted payment. Tax results are attached to payment events
 * and accumulated for reporting.
 *
 * Usage:
 *   import { createAmpersendTreasurer } from "ampersend-sdk";
 *   import { withTaxCompliance } from "@agenttax/ampersend";
 *
 *   const treasurer = createAmpersendTreasurer({ ... });
 *   const taxTreasurer = withTaxCompliance(treasurer, {
 *     apiKey: "atx_live_...",
 *     defaultBuyerState: "TX",
 *     transactionType: "compute",
 *   });
 */

const AGENTTAX_BASE = "https://agenttax.io";

/**
 * Calculate tax for a transaction via AgentTax API.
 * @param {object} opts
 * @returns {Promise<object>} Tax calculation result
 */
async function calculateTax({ baseUrl, apiKey, amount, buyerState, transactionType, workType, isB2B, counterpartyId, role, timeoutMs = 30000 }) {
  const body = {
    role: role || "seller",
    amount,
    buyer_state: buyerState,
    transaction_type: transactionType || "compute",
    counterparty_id: counterpartyId || "ampersend_agent",
  };
  if (workType) body.work_type = workType;
  if (isB2B !== undefined) body.is_b2b = isB2B;

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${baseUrl}/api/v1/calculate`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    const err = new Error(`AgentTax ${res.status}: non-JSON response`);
    err.status = res.status;
    err.body = text.slice(0, 500);
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`AgentTax ${res.status}: ${parsed?.error || parsed?.message || "request failed"}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  if (parsed?.success === false) {
    const err = new Error(`AgentTax returned success=false: ${parsed?.error || "unknown"}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

/**
 * Parse USDC amount from x402 payment requirements.
 * x402 amounts are in base units (6 decimals for USDC).
 * @param {string|number} amount - Amount in base units
 * @returns {number} Amount in USD
 */
function parseUsdcAmount(amount) {
  return Number(amount) / 1_000_000;
}

/**
 * Wrap an Ampersend X402Treasurer with automatic tax calculation.
 *
 * Every time a payment is accepted, AgentTax calculates the applicable
 * sales/use tax and attaches it to the transaction log. Tax results
 * accumulate in `taxTreasurer.taxLog` for reporting.
 *
 * @param {import("ampersend-sdk").X402Treasurer} treasurer - Base treasurer to wrap
 * @param {object} config - Tax configuration
 * @param {string} config.apiKey - AgentTax API key (atx_live_...)
 * @param {string} config.defaultBuyerState - Default US state code for tax jurisdiction
 * @param {string} [config.transactionType="compute"] - Transaction type (compute, saas, api_access, etc.)
 * @param {string} [config.workType] - Work type (compute, research, content, consulting, trading)
 * @param {boolean} [config.isB2B=false] - Whether transactions are B2B
 * @param {string} [config.role="seller"] - Your role (seller or buyer)
 * @param {string} [config.baseUrl="https://agenttax.io"] - AgentTax API base URL
 * @param {function} [config.onTaxCalculated] - Callback fired after each tax calculation
 * @param {function} [config.resolveState] - Custom function to determine buyer state from payment context
 * @returns {object} Tax-aware treasurer with same interface + taxLog array
 */
export function withTaxCompliance(treasurer, config) {
  const {
    apiKey,
    defaultBuyerState,
    transactionType = "compute",
    workType,
    isB2B = false,
    role = "seller",
    baseUrl = AGENTTAX_BASE,
    onTaxCalculated,
    resolveState,
  } = config;

  /** @type {Array<{authorizationId: string, amount: number, tax: object, timestamp: string}>} */
  const taxLog = [];

  return {
    // Delegate payment decisions to the wrapped treasurer unchanged
    onPaymentRequired: (requirements, context) =>
      treasurer.onPaymentRequired(requirements, context),

    // Intercept status updates to calculate tax on accepted payments
    async onStatus(status, authorization, context) {
      // Always forward to the wrapped treasurer first
      await treasurer.onStatus(status, authorization, context);

      // Only calculate tax on accepted (settled) payments
      if (status !== "accepted") return;

      // Extract amount from the payment payload (x402 uses both .payment and .payload)
      const rawAmount = authorization.payment?.amount || authorization.payload?.amount || 0;
      const amount = rawAmount ? parseUsdcAmount(rawAmount) : 0;

      if (amount <= 0) return;

      // Determine buyer state -- custom resolver or default
      const buyerState = resolveState
        ? resolveState(context, authorization)
        : defaultBuyerState;

      if (!buyerState) return;

      // Derive counterparty from payment context
      const counterpartyId =
        context?.metadata?.counterpartyId ||
        context?.metadata?.sellerId ||
        authorization.payment?.payTo ||
        "ampersend_agent";

      let taxResult = null;
      let taxError = null;
      try {
        taxResult = await calculateTax({
          baseUrl,
          apiKey,
          amount,
          buyerState,
          transactionType,
          workType,
          isB2B,
          counterpartyId: String(counterpartyId),
          role,
        });
      } catch (err) {
        // Tax calculation failure should never block payments (payment is already settled)
        // but it MUST be visible to the caller so compliance gaps can be reconciled.
        taxError = { message: err.message, status: err.status, body: err.body };
        console.error("[agenttax/ampersend] Tax calculation failed:", err.message);
      }

      const entry = {
        authorizationId: authorization.authorizationId,
        amount,
        buyerState,
        tax: taxResult,
        taxError,
        timestamp: new Date().toISOString(),
      };

      taxLog.push(entry);

      if (onTaxCalculated) {
        try {
          onTaxCalculated(entry);
        } catch (cbErr) {
          console.error("[agenttax/ampersend] onTaxCalculated callback failed:", cbErr.message);
        }
      }
    },

    /** Accumulated tax calculations for all accepted payments this session */
    taxLog,

    /** Get total tax owed across all logged transactions */
    getTaxSummary() {
      let totalAmount = 0;
      let totalTax = 0;
      let failed = 0;
      const byJurisdiction = {};

      for (const entry of taxLog) {
        totalAmount += entry.amount;
        if (entry.taxError || !entry.tax) {
          failed++;
          continue;
        }
        const tax = entry.tax?.total_tax || 0;
        totalTax += tax;
        const jurisdiction = entry.tax?.sales_tax?.jurisdiction || entry.tax?.buyer_state || "unknown";
        byJurisdiction[jurisdiction] = (byJurisdiction[jurisdiction] || 0) + tax;
      }

      return {
        transactions: taxLog.length,
        failed,
        totalAmount: Math.round(totalAmount * 100) / 100,
        totalTax: Math.round(totalTax * 100) / 100,
        effectiveRate: totalAmount > 0 ? Math.round((totalTax / totalAmount) * 10000) / 10000 : 0,
        byJurisdiction,
      };
    },

    /** Access the wrapped treasurer if needed */
    unwrap: () => treasurer,
  };
}

/**
 * Create a standalone tax calculator for Ampersend transactions
 * (without wrapping a Treasurer). Useful for batch/retroactive tax calculation.
 *
 * @param {object} config - Same config as withTaxCompliance
 * @returns {object} Calculator with calculate() and getTaxSummary()
 */
export function createTaxCalculator(config) {
  const {
    apiKey,
    defaultBuyerState,
    transactionType = "compute",
    workType,
    isB2B = false,
    role = "seller",
    baseUrl = AGENTTAX_BASE,
  } = config;

  const taxLog = [];

  return {
    /**
     * Calculate tax for a single transaction.
     * @param {object} tx
     * @param {number} tx.amount - Amount in USD
     * @param {string} [tx.buyerState] - Override default state
     * @param {string} [tx.transactionType] - Override default type
     * @param {string} [tx.counterpartyId] - Counterparty identifier
     * @returns {Promise<object>} Tax calculation result
     */
    async calculate(tx) {
      const result = await calculateTax({
        baseUrl,
        apiKey,
        amount: tx.amount,
        buyerState: tx.buyerState || defaultBuyerState,
        transactionType: tx.transactionType || transactionType,
        workType: tx.workType || workType,
        isB2B: tx.isB2B !== undefined ? tx.isB2B : isB2B,
        counterpartyId: tx.counterpartyId || "ampersend_agent",
        role: tx.role || role,
      });

      taxLog.push({
        amount: tx.amount,
        tax: result,
        timestamp: new Date().toISOString(),
      });

      return result;
    },

    taxLog,

    getTaxSummary() {
      let totalAmount = 0;
      let totalTax = 0;
      let failed = 0;
      const byJurisdiction = {};

      for (const entry of taxLog) {
        totalAmount += entry.amount;
        if (entry.taxError || !entry.tax) {
          failed++;
          continue;
        }
        const tax = entry.tax?.total_tax || 0;
        totalTax += tax;
        const jurisdiction = entry.tax?.sales_tax?.jurisdiction || entry.tax?.buyer_state || "unknown";
        byJurisdiction[jurisdiction] = (byJurisdiction[jurisdiction] || 0) + tax;
      }

      return {
        transactions: taxLog.length,
        failed,
        totalAmount: Math.round(totalAmount * 100) / 100,
        totalTax: Math.round(totalTax * 100) / 100,
        effectiveRate: totalAmount > 0 ? Math.round((totalTax / totalAmount) * 10000) / 10000 : 0,
        byJurisdiction,
      };
    },
  };
}
