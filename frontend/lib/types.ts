/** Response shapes of the FinDost API (amounts are integer paisa). */

export type Kind = "sme" | "student" | "household" | "enterprise";
export type Feature =
  | "ledger" | "receivables" | "payables" | "inventory" | "import" | "forecast" | "alerts"
  | "simulator" | "recovery" | "reports" | "copilot" | "impact";

export interface Business {
  id: string;
  name: string;
  kind: Kind;
  kind_label: string;
  city: string | null;
  currency: string;
  opening_date: string;
  opening_cash_paisa: number;
  opening_bank_paisa: number;
  opening_wallet_paisa: number;
  cash_reserve_paisa: number;
  is_demo: boolean;
  ai_consent: boolean;
  language: "en" | "ur";
  recovery_weights: Record<string, number>;
  features: Feature[];
  is_anonymous: boolean;
  demo_expires_on: string | null;
}

export interface Me {
  user: { id: string; email: string | null; name: string | null; is_anonymous: boolean };
  business: Business | null;
  needs_onboarding: boolean;
  suggested_kind: Kind | null;
  suggested_business_name: string | null;
}

export interface ForecastPoint {
  date: string;
  day: number;
  balance_paisa: number;
  low_paisa: number;
  high_paisa: number;
  inflow_paisa: number;
  outflow_paisa: number;
}

export interface ForecastSummary {
  opening_balance_paisa: number;
  balance_d7_paisa: number;
  balance_d14_paisa: number;
  balance_end_paisa: number;
  min_balance_paisa: number;
  min_balance_date: string;
  shortage_date: string | null;
  days_to_shortage: number | null;
  reserve_paisa: number;
  reserve_breach_date: string | null;
  total_inflow_paisa: number;
  total_outflow_paisa: number;
  shortage_risk: "high" | "medium" | "watch" | "low";
  flows_by_source_paisa: Record<string, number>;
  band_available: boolean;
  runway_days: number | null;
  avg_daily_net_paisa: number;
  runway_extrapolated_days: number | null;
}

export interface ForecastEvent {
  date: string;
  day: number;
  amount_paisa: number;
  kind: string;
  label: string;
  category: string;
  ref_type: string | null;
  ref_id: string | null;
  certainty: "recorded" | "estimated" | "simulated";
  note: string;
}

export interface BacktestModel {
  label: string;
  mae_paisa: number;
  rmse_paisa: number;
  n: number;
}

export interface ForecastModel {
  name: string;
  label: string;
  history_days: number;
  backtest?: Record<string, BacktestModel>;
  baseline?: string;
  improvement_pct?: number;
  mae_paisa?: number;
  wape_pct?: number | null;
  method?: string;
  band?: { method: "backtest_rmse" | "history_std" | "none"; sigma_daily_paisa: number; note: string };
}

export interface Forecast {
  points: ForecastPoint[];
  history: { date: string; balance_paisa: number }[];
  summary: ForecastSummary;
  contributors: ForecastEvent[];
  events: ForecastEvent[];
  model: ForecastModel;
  confidence: { level: "high" | "medium" | "low"; reasons: string[] };
  assumptions: string[];
  warnings: string[];
  excluded: { type: string; id: string; label: string; amount_paisa: number; reason: string }[];
  recurring: { label: string; category: string; direction: string; amount_paisa: number; day_of_month: number; occurrences: number; projected_dates: string[] }[];
  pipeline: { daily_purchase_paisa: number; payment_lag_days: number; basis_purchases: number } | null;
  trend: { recent_4w_net_paisa: number; prior_4w_net_paisa: number; change_paisa: number; direction: string };
  horizon_days: number;
  as_of: string;
  disclaimer: string;
  previous_runs?: { date: string; min_balance_paisa: number; shortage_date: string | null; model: string }[];
}

export interface AlertTx {
  id: string;
  date: string;
  description: string;
  kind: string;
  category: string;
  amount_paisa: number;
}

export interface Alert {
  id: string;
  rule: string;
  entity_key: string;
  score: number;
  level: "critical" | "high" | "medium" | "low";
  title: string;
  explanation: string;
  evidence: string[];
  amounts: Record<string, number>;
  dates: Record<string, string>;
  transactions: AlertTx[];
  items: Record<string, unknown>[];
  records: { type: "transaction" | "receivable" | "payable" | "product"; id: string }[];
  impact_paisa: number | null;
  impact_label: string | null;
  next_step: string;
  limitations: string;
  link: string;
  score_note: string;
  status: "open" | "acknowledged" | "resolved";
  first_detected_on: string;
}

export interface Kpi {
  value_paisa: number;
  type: "actual" | "estimated" | "forecast" | "index";
  [key: string]: unknown;
}

export interface HealthIndex {
  score: number;
  label: string;
  components: { name: string; weight: number; score: number; detail: string }[];
  note: string;
  type: "index";
}

export interface DataQuality {
  score: number;
  history_days: number;
  transactions: number;
  first_date?: string;
  last_date?: string;
  uncategorized?: number;
  days_since_last_entry?: number;
  issues: string[];
}

export interface Dashboard {
  as_of: string;
  period: { from: string; to: string };
  business: { name: string; kind: Kind; is_demo: boolean };
  kpis: {
    cash_balance: Kpi & { accounts: { cash: number; bank: number; wallet: number } };
    revenue: Kpi & { cash_paisa: number; credit_paisa: number };
    expenses: Kpi;
    net_profit: Kpi & { margin_pct: number | null; note: string };
    receivables: Kpi & { overdue_paisa: number; overdue_count: number };
    upcoming_payables: Kpi & { within_days: number; count: number; overdue_paisa: number };
    expected_cash_7d: Kpi & { low_paisa: number; high_paisa: number };
    expected_cash_14d: Kpi & { low_paisa: number; high_paisa: number };
    shortage_risk: { level: string; shortage_date: string | null; days_to_shortage: number | null; min_balance_paisa: number; min_balance_date: string; type: "forecast" };
    health: HealthIndex;
    inventory_value?: Kpi & { note: string };
  };
  forecast: { history: { date: string; balance_paisa: number }[]; points: ForecastPoint[]; summary: ForecastSummary; confidence: Forecast["confidence"] };
  alerts: Alert[];
  alert_counts: Record<string, number>;
  recommended_actions: { id: string; title: string; timing: string; min_balance_change_paisa: number; removes_shortage: boolean }[];
  expense_breakdown: { category: string; amount_paisa: number; share_pct: number }[];
  revenue_breakdown: { category: string; amount_paisa: number }[];
  data_quality: DataQuality;
  recent_transactions: { id: string; occurred_on: string; kind: string; amount_paisa: number; category: string; description: string; account: string | null }[];
}

export interface Tx {
  id: string;
  occurred_on: string;
  kind: string;
  amount_paisa: number;
  account: string | null;
  to_account: string | null;
  category: string;
  description: string;
  customer_id: string | null;
  customer_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  receivable_id: string | null;
  payable_id: string | null;
  source: string;
  is_demo: boolean;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface Receivable {
  id: string;
  customer_id: string;
  customer_name: string;
  reference: string | null;
  description: string | null;
  issued_on: string;
  due_on: string;
  expected_on: string | null;
  amount_paisa: number;
  paid_paisa: number;
  outstanding_paisa: number;
  days_overdue: number;
  aging_bucket: string;
  status: "open" | "overdue" | "settled";
  payments: { date: string; amount_paisa: number }[];
}

export interface Payable {
  id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  label: string;
  reference: string | null;
  description: string | null;
  category: string;
  issued_on: string;
  due_on: string;
  amount_paisa: number;
  paid_paisa: number;
  outstanding_paisa: number;
  days_to_due: number;
  is_essential: boolean;
  status: "open" | "overdue" | "paid";
  payments: { date: string; amount_paisa: number }[];
}

export interface Comparison {
  min_balance_change_paisa: number;
  end_balance_change_paisa: number;
  balance_d14_change_paisa: number;
  baseline_shortage_date: string | null;
  scenario_shortage_date: string | null;
  shortage_shift_days: number | null;
  baseline_max_shortfall_paisa: number;
  scenario_max_shortfall_paisa: number;
  baseline_days_negative: number;
  scenario_days_negative: number;
  max_gap_paisa: number;
  creates_shortage: boolean;
  removes_shortage: boolean;
  additional_pressure_paisa: number;
}

export interface SimResult {
  baseline: { points: ForecastPoint[]; summary: ForecastSummary; events: ForecastEvent[] };
  scenario: { points: ForecastPoint[]; summary: ForecastSummary; events: ForecastEvent[] };
  notes: string[];
  comparison: Comparison;
  disclaimer: string;
}

export type Adjustment = { type: string; [key: string]: unknown };

export interface Scenario {
  id: string;
  name: string;
  description: string | null;
  kind: "shock" | "what_if";
  adjustments: Adjustment[];
  actions: { id: string; action_type: string; label: string; params: Adjustment }[];
  is_demo: boolean;
  last_result: { summary: ForecastSummary; comparison: Comparison } | null;
}

export interface Strategy {
  id: string;
  action_type: string;
  title: string;
  problem: string;
  action: string;
  adjustments: Adjustment[];
  timing: string;
  feasibility: number;
  feasibility_reason: string;
  cost_paisa: number;
  risk: number;
  tradeoffs: string;
  assumptions: string[];
  evidence_quality: "high" | "medium" | "low";
  evidence: string[];
  result: ForecastSummary;
  comparison: Comparison;
  points: { date: string; balance_paisa: number }[];
  score: number;
  score_parts: Record<string, number>;
  numerical_reasoning: string;
}

export interface Recovery {
  weights: Record<string, number>;
  baseline: { summary: ForecastSummary; points: { date: string; balance_paisa: number }[] };
  scenario: { summary: ForecastSummary; points: { date: string; balance_paisa: number }[]; adjustments: Adjustment[] };
  strategies: Strategy[];
  combined_plan: { action_ids: string[]; result: ForecastSummary; comparison: Comparison; points: { date: string; balance_paisa: number }[] } | null;
  information_only: { id: string; title: string; detail: string; quantified: boolean }[];
  disclaimer: string;
}

export interface CopilotAnswer {
  intent: string;
  language: "en" | "ur";
  answer: string;
  answer_en: string;
  answer_ur: string;
  evidence: string[];
  data: Record<string, unknown>;
  links: string[];
  grounded: boolean;
  used_llm: boolean;
  ai_provider: "groq" | "gemini" | null;
  llm_available: boolean;
  llm_consent: boolean;
  disclaimer: string;
  /** Clickable follow-up questions (clarifications, unsupported questions). */
  suggestions?: string[];
  needs_clarification?: boolean;
  /** Echoed back with the next question so follow-ups ("what if it drops another 10%?") keep context. */
  context?: CopilotContext | null;
  followup?: boolean;
  interpreted_by?: "rules" | "context" | "groq" | "gemini";
  /** Why the answer uses FinDost's own wording instead of AI: AI turned off, not configured, today's limit used up, or a failed AI reply. */
  ai_fallback?: "disabled" | "unavailable" | "quota" | "ai_error" | null;
  /** Engine tools the AI agent ran for this answer (multi-step questions, inventory, alerts). */
  tools?: string[];
}

export type CopilotStage = "understanding" | "calculating" | "writing";

export interface CopilotTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AccountSettings {
  ai_assistance_enabled: boolean;
  language: "en" | "ur";
}

export interface CopilotContext {
  intent: string | null;
  params: { percent?: number; delay_days?: number; amount_paisa?: number; day?: number };
  pending: boolean;
}
