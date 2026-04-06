/**
 * Tax calculation result from AgentTax API.
 */
export interface TaxResult {
  success: boolean;
  total_tax: number;
  buyer_state: string;
  sales_tax?: {
    amount: number;
    rate: number;
    jurisdiction: string;
    note?: string;
  };
  confidence?: {
    score: number;
    level: string;
  };
  [key: string]: unknown;
}

export interface TaxLogEntry {
  authorizationId?: string;
  amount: number;
  tax: TaxResult;
  timestamp: string;
}

export interface TaxSummary {
  transactions: number;
  totalAmount: number;
  totalTax: number;
  effectiveRate: number;
  byJurisdiction: Record<string, number>;
}

export interface TaxComplianceConfig {
  /** AgentTax API key (atx_live_...) */
  apiKey: string;
  /** Default US state code for tax jurisdiction */
  defaultBuyerState: string;
  /** Transaction type (default: "compute") */
  transactionType?: string;
  /** Work type for improved classification */
  workType?: string;
  /** Whether transactions are B2B (default: false) */
  isB2B?: boolean;
  /** Your role: "seller" or "buyer" (default: "seller") */
  role?: string;
  /** AgentTax API base URL (default: "https://agenttax.io") */
  baseUrl?: string;
  /** Callback fired after each tax calculation */
  onTaxCalculated?: (entry: TaxLogEntry) => void;
  /** Custom function to determine buyer state from payment context */
  resolveState?: (context: any, authorization: any) => string;
}

export interface X402Treasurer {
  onPaymentRequired(requirements: ReadonlyArray<any>, context?: any): Promise<any>;
  onStatus(status: string, authorization: any, context?: any): Promise<void>;
}

export interface TaxAwareTreasurer extends X402Treasurer {
  taxLog: TaxLogEntry[];
  getTaxSummary(): TaxSummary;
  unwrap(): X402Treasurer;
}

export interface TaxCalculator {
  calculate(tx: {
    amount: number;
    buyerState?: string;
    transactionType?: string;
    workType?: string;
    isB2B?: boolean;
    counterpartyId?: string;
    role?: string;
  }): Promise<TaxResult>;
  taxLog: TaxLogEntry[];
  getTaxSummary(): TaxSummary;
}

/**
 * Wrap an Ampersend X402Treasurer with automatic tax calculation.
 */
export function withTaxCompliance(
  treasurer: X402Treasurer,
  config: TaxComplianceConfig,
): TaxAwareTreasurer;

/**
 * Create a standalone tax calculator for Ampersend transactions.
 */
export function createTaxCalculator(
  config: TaxComplianceConfig,
): TaxCalculator;
