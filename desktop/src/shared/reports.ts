export type ReportPeriod = 7 | 14 | 30 | 90 | "all";
export type ReportMetric = "profit" | "sales" | "purchases" | "expenses";
export interface ReportQuery { period?: ReportPeriod; metric?: ReportMetric; account?: string; character?: string; item?: string; cumulative?: boolean }
export interface ReportRow { item: string; units: number | null; total: number; average: number | null; previous: number; change: number | null }
export interface ReportInfo {
  hasLedger: boolean;
  unreadable: number;
  accounts: { id: string; characters: { key: string; name: string }[] }[];
  items: string[];
  from: string;
  to: string;
  previousComplete: boolean;
  total: number;
  days: { date: string; total: number }[];
  rows: ReportRow[];
  categories: { category: string; total: number }[];
}
