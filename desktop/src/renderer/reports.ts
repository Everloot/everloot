import type { ReportInfo, ReportQuery } from "../shared/reports";
import { categoryLabel } from "../shared/ledger";
import { esc, gold } from "./format";
import { emptyState } from "./parts";

const money = (n: number | null) => n === null ? "—" : `${n < 0 ? "−" : ""}${gold(Math.abs(n))}`;
const option = (value: string, label: string, selected: string) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`;

export function reportsView(info: ReportInfo | undefined, q: ReportQuery, rowPage = 0): string {
  const head = '<div class="page reports"><div class="head"><h1>Reports</h1></div><p class="muted">Your local ledger in Everloot Desktop App. Nothing from this report is uploaded.</p>';
  if (!info) return `${head}<p role="status">Reading the local ledger…</p></div>`;
  const warning = info.unreadable ? '<p role="status">Some account save files could not be read. Open Upload to inspect them.</p>' : "";
  if (!info.hasLedger) return `${head}${warning}${emptyState({ cause: "No local ledger yet", step: "Play with the addon 0.3.22+; it records locally. Log out or /reload to write the save file.", action: { label: "Open Addon", page: "addon" } }, "")}</div>`;
  const scope = JSON.stringify([q.account ?? "", q.character ?? ""]);
  const scopes = option(JSON.stringify(["", ""]), "All accounts", scope) + info.accounts.map(a => option(JSON.stringify([a.id, ""]), `Account: ${a.id}`, scope) + a.characters.map(c => option(JSON.stringify([a.id, c.key]), `${a.id} / ${c.name}`, scope)).join("")).join("");
  const controls = `<div class="report-controls">
    <label>Period<select id="reportPeriod">${[7, 14, 30, 90, "all"].map(p => option(String(p), p === "all" ? "Full ledger window" : `${p} days`, String(q.period ?? 30))).join("")}</select></label>
    <label>Metric<select id="reportMetric">${[["profit", "Profit"], ["sales", "Sales"], ["purchases", "Purchases"], ["expenses", "Expenses by category"]].map(([v, l]) => option(v, l, q.metric ?? "profit")).join("")}</select></label>
    <label>Scope<select id="reportScope">${scopes}</select></label>
    <label>Item<select id="reportItem">${option("", "All items", q.item ?? "")}${info.items.map(i => option(i, i, q.item ?? "")).join("")}</select></label>
    <label class="switch"><input type="checkbox" id="reportCumulative" ${q.cumulative ? "checked" : ""}>Cumulative</label>
  </div>`;
  const notes = `<p class="muted small">${esc(info.from)} – ${esc(info.to)} · UTC days · Own-alt transfers excluded when multiple characters are selected. Sales are paid auctions; purchases are auction and vendor purchases. Profit is recorded income minus spending.</p>
    <p class="muted small">Change compares the preceding ${info.days.length} UTC days.${info.previousComplete ? "" : " The retained ledger does not cover the whole previous period; comparisons use only available records."} A dash means no previous total, or no recorded units. Units for profit count both incoming and outgoing items.</p>`;
  if (!info.rows.length) return `${head}${warning}${controls}${notes}${emptyState({ cause: "No activity matches these filters", step: "Try the full ledger window or another metric.", action: { label: "Reset filters", page: "reports-reset" } }, "")}</div>`;
  const values = info.days.map(d => d.total);
  const low = Math.min(0, ...values), high = Math.max(0, ...values), range = high - low || 1;
  const y = (n: number) => 170 - (n - low) / range * 150;
  const x = (i: number) => 70 + i / Math.max(1, values.length - 1) * 640;
  const chart = `<figure class="report-chart"><figcaption>${q.cumulative ? "Cumulative" : "Daily"} ${esc(q.metric ?? "profit")} · ${money(info.total)} total</figcaption>
    <svg viewBox="0 0 740 210" role="img" aria-label="${q.cumulative ? "Cumulative" : "Daily"} totals in copper, UTC days">
    <text x="0" y="18">${esc(money(high))}</text><text x="0" y="185">${esc(money(low))}</text>
    <line x1="70" x2="710" y1="${y(0)}" y2="${y(0)}" class="report-zero"/>
    <polyline points="${values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/>
    ${info.days.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.total)}" r="3"><title>${d.date}: ${esc(money(d.total))}</title></circle>`).join("")}
    <text x="70" y="205">${info.from}</text><text x="710" y="205" text-anchor="end">${info.to}</text></svg>
    <details><summary>Daily values</summary><table><thead><tr><th>UTC day</th><th>Total</th></tr></thead><tbody>${info.days.map(d => `<tr><td>${d.date}</td><td>${money(d.total)}</td></tr>`).join("")}</tbody></table></details></figure>`;
  const categories = q.metric === "expenses" ? `<h2>Expenses by category</h2><table><thead><tr><th>Category</th><th>Total</th></tr></thead><tbody>${info.categories.map(c => `<tr><td>${esc(categoryLabel(c.category))}</td><td>${money(c.total)}</td></tr>`).join("")}</tbody></table>` : "";
  const offset = Math.min(rowPage, Math.floor((info.rows.length - 1) / 100)) * 100;
  const rows = info.rows.slice(offset, offset + 100).map(r => `<tr><td>${esc(r.item || "No item recorded")}</td><td>${r.units ?? "—"}</td><td>${money(r.total)}</td><td>${money(r.average)}</td><td>${money(r.previous)}</td><td>${r.change === null ? "—" : `${r.change > 0 ? "+" : ""}${r.change.toFixed(1)}%`}</td></tr>`).join("");
  return `${head}${warning}${controls}${notes}${chart}${categories}<h2>By item</h2><div class="report-table"><table><thead><tr><th>Item</th><th>Units</th><th>Total</th><th>Average per unit</th><th>Previous total</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="report-paging"><button class="btn" id="reportPrevious" ${offset === 0 ? "disabled" : ""}>Previous</button><span>${offset + 1}–${Math.min(offset + 100, info.rows.length)} of ${info.rows.length} items</span><button class="btn" id="reportNext" ${offset + 100 >= info.rows.length ? "disabled" : ""}>Next</button></div></div>`;
}
