/**
 * Core domain types shared by the demo store, the domain calculators and the UI.
 * Money is always carried as integer paisa in a string so BigInt math stays exact.
 */

export interface Money {
  currency: "PKR";
  amountPaisa: string;
}

export type WorkspaceKind = "sme" | "student" | "household" | "enterprise";

export type WorkspaceFeature =
  | "cash_flow"
  | "upload_review"
  | "udhaar_ledger"
  | "simulator"
  | "reports"
  | "credit_readiness"
  | "tax_preview";

export interface Workspace {
  id: string;
  kind: WorkspaceKind;
  name: string;
  displayName: string;
  description: string;
  currency: "PKR";
  timezone: string;
  features: WorkspaceFeature[];
}

export type TransactionDirection = "inflow" | "outflow";
export type ReviewStatus = "confirmed" | "needs_review" | "rejected";

export interface Transaction {
  id: string;
  workspaceId: string;
  occurredAt: string;
  merchant: string;
  amount: Money;
  direction: TransactionDirection;
  category: string;
  confidence: number;
  reviewStatus: ReviewStatus;
  sourceRef?: string;
  isEdited?: boolean;
  originalMerchant?: string;
  originalCategory?: string;
  originalAmount?: Money;
  correctionNote?: string;
}

export type UdhaarStatus = "current" | "overdue" | "settled";
export type AgeBucket = "30d" | "60d" | "90d+";

export interface UdhaarRecord {
  id: string;
  workspaceId: string;
  customerName: string;
  phone?: string;
  issuedAt: string;
  dueAt: string;
  outstanding: Money;
  status: UdhaarStatus;
  ageBucket: AgeBucket;
  sourceRef?: string;
  notes?: string;
}

export type AnomalyKind = "spike" | "supplier_price" | "overdue_udhaar" | "duplicate" | "other";
export type AnomalySeverity = "info" | "warning" | "critical";

export interface Anomaly {
  id: string;
  workspaceId: string;
  kind: AnomalyKind;
  severity: AnomalySeverity;
  title: string;
  explanation: string;
  amount: Money;
  period: string;
  transactionIds: string[];
  sourceRefs: string[];
  detectedAt: string;
}

export interface ForecastPoint {
  date: string;
  baseline: Money;
  p10: Money;
  p50: Money;
  p90: Money;
}

export interface Forecast {
  workspaceId: string;
  generatedAt: string;
  horizonDays: number;
  points: ForecastPoint[];
  assumptions: string[];
  source: "demo" | "api";
}

export type ShockKind = "price_rise" | "delayed_receivables" | "utility_spike" | "custom";

export interface ScenarioShock {
  id: string;
  kind: ShockKind;
  label: string;
  description: string;
  percent?: number;
  amount?: Money;
  delayDays?: number;
  active: boolean;
}

export interface RecoveryAction {
  id: string;
  label: string;
  description: string;
  estimatedImpact: Money;
  active: boolean;
}

export interface Scenario {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  shocks: ScenarioShock[];
  recoveryActions: RecoveryAction[];
  assumptions: string[];
}

export type RecommendationCategory = "collections" | "supplier" | "cash_flow" | "tax";

export interface Recommendation {
  id: string;
  workspaceId: string;
  title: string;
  plainReason: string;
  estimatedImpact: Money;
  timeHorizon: string;
  evidenceTransactionIds: string[];
  evidenceSourceRefs: string[];
  assumptions: string[];
  category: RecommendationCategory;
}

export type FactorStatus = "good" | "moderate" | "attention";

export interface CreditFactor {
  name: string;
  score: number;
  weight: number;
  status: FactorStatus;
  details: string;
}

export interface CreditReadiness {
  workspaceId: string;
  overallScore: number;
  factors: CreditFactor[];
  isShariahCompliantWording: boolean;
  disclaimer: string;
}

export interface DeductibleCategory {
  category: string;
  spent: Money;
  deductiblePercentage: number;
  deductibleAmount: Money;
  note: string;
}

export interface TaxPreview {
  workspaceId: string;
  taxYear: string;
  estimatedGrossInflow: Money;
  totalExpenses: Money;
  deductibleExpenses: Money;
  estimatedTaxableIncome: Money;
  illustrativeEstimatedTax: Money;
  deductibleCategories: DeductibleCategory[];
  disclaimer: string;
}
