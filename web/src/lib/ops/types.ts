export type OpsSource = {
  status: "fresh" | "stale" | "unavailable" | "partial";
  asOf: string | null;
  detail: string;
};
export type OpsDay = {
  day: string; contributors: number; successfulReceipts: number; records: number;
  rejected: number | null; limited: number | null; storageFailures: number | null; reasons: Record<string, number> | null;
  partial: boolean;
};
export type OpsContributor = {
  id: string; alias: string; excluded: boolean; realms: string[]; kinds: string[];
  successfulReceipts: number; records: number; lastReceivedAt: string; daysActive: string[];
  series: "receipts" | "stored-uploads";
};
export type OpsCpu = {
  cpuMs: number; estimatedUsd: number; monthlyPaceUsd: number; since: string; until: string;
  formula: string; pricingDate: string; includedServices: string[];
};
export type OpsSummary = {
  version: 1; generatedAt: string; exclusionVersion: string; excludedInstalls: number;
  sources: Record<string, OpsSource>;
  activity: { today: number | null; past7Days: number | null;
    returning: { count: number; earlier: number; rate: number | null } | null;
    historySince: string | null };
  daily: OpsDay[]; contributors: OpsContributor[];
  historical: { contributors: number; uploads: number; records: number; since: string } | null;
  health: { snapshot: { status: string; generatedAt?: string | null; dataAsOf?: string | null } | null; attention: string[] };
  costs: { cpu: OpsCpu | null; actualBilled: null };
  usage: { mcp: Record<string, number> | null; browser: null };
};
/** Already pseudonymized at the source boundary; never put raw install IDs in a snapshot. */
export type ActivityRow = {
  day: string; install_key: string; receipts: number; records: number;
  last_received_at: string; realms: string[]; kinds: string[];
};
export type CounterRow = { day: string; metric: string; count: number };
export type OpsContributorHints = { version: 1; generatedAt: string; contributors: { id: string; realms: string[]; kinds: string[] }[] };
