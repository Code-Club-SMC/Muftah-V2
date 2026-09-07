import { format, parseISO, isToday, isYesterday } from "date-fns";
import type { ActivityEvent } from "./activity-event-card";
import type { ActivityFilters } from "./activity-timeline-filters";

export interface PrintActivityTimelineOptions {
  events: ActivityEvent[];
  filters: ActivityFilters;
  printedBy?: string;
}

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPeriodLabel(filters: ActivityFilters): string {
  if (filters.dateFrom && filters.dateTo) {
    const fromDate = new Date(filters.dateFrom);
    const toDate = new Date(filters.dateTo);
    if (isToday(fromDate) && isToday(toDate)) return "Today";
    if (isYesterday(fromDate) && isYesterday(toDate)) return "Yesterday";
    return `${format(fromDate, "dd-MMM-yyyy")} to ${format(toDate, "dd-MMM-yyyy")}`;
  }
  if (filters.dateFrom) {
    return `From ${format(new Date(filters.dateFrom), "dd-MMM-yyyy")}`;
  }
  if (filters.dateTo) {
    return `Up to ${format(new Date(filters.dateTo), "dd-MMM-yyyy")}`;
  }
  return "All Time (Complete History)";
}

function formatFilterCriteria(filters: ActivityFilters): string {
  const parts: string[] = [];
  if (filters.module && filters.module !== "all") {
    parts.push(`Module: ${filters.module.toUpperCase()}`);
  }
  if (filters.severity && filters.severity !== "all") {
    parts.push(`Severity: ${filters.severity.toUpperCase()}`);
  }
  if (filters.action && filters.action !== "all") {
    parts.push(`Action: ${filters.action}`);
  }
  if (filters.search) {
    parts.push(`Search: "${filters.search}"`);
  }
  return parts.length > 0 ? parts.join(" | ") : "All Departments & Activity Levels";
}

function formatSeverityBadge(severity?: string): string {
  const s = (severity || "info").toLowerCase();
  if (s === "critical") {
    return `<span class="badge badge-critical">CRITICAL</span>`;
  }
  if (s === "warning") {
    return `<span class="badge badge-warning">WARNING</span>`;
  }
  return `<span class="badge badge-info">STANDARD</span>`;
}

function formatModuleBadge(module?: string): string {
  const m = (module || "general").toLowerCase();
  return `<span class="badge badge-module">${escapeHtml(m.toUpperCase())}</span>`;
}

export function generateActivityTimelinePrintHtml(
  options: PrintActivityTimelineOptions,
): string {
  const { events, filters, printedBy = "System Administrator" } = options;
  const printTimestamp = format(new Date(), "dd-MMM-yyyy hh:mm a");
  const periodLabel = formatPeriodLabel(filters);
  const filterCriteria = formatFilterCriteria(filters);

  // Calculate KPIs
  const totalEvents = events.length;
  let standardCount = 0;
  let warningCount = 0;
  let criticalCount = 0;
  const operatorSet = new Set<string>();
  const moduleCounts: Record<string, number> = {};

  for (const ev of events) {
    const s = (ev.severity || "info").toLowerCase();
    if (s === "critical") criticalCount++;
    else if (s === "warning") warningCount++;
    else standardCount++;

    if (ev.actorName) operatorSet.add(ev.actorName);
    const mod = (ev.module || "other").toLowerCase();
    moduleCounts[mod] = (moduleCounts[mod] || 0) + 1;
  }

  const topModule = Object.entries(moduleCounts).sort((a, b) => b[1] - a[1])[0];
  const topModuleLabel = topModule ? `${topModule[0].toUpperCase()} (${topModule[1]})` : "None";

  // Group events by date (YYYY-MM-DD)
  const groupedEvents: Record<string, ActivityEvent[]> = {};
  for (const ev of events) {
    const d = new Date(ev.timestamp);
    const dateKey = format(d, "yyyy-MM-dd");
    if (!groupedEvents[dateKey]) groupedEvents[dateKey] = [];
    groupedEvents[dateKey].push(ev);
  }

  const dateKeys = Object.keys(groupedEvents);

  const tableRowsHtml =
    events.length === 0
      ? `<tr><td colspan="7" class="empty-state">No activity events recorded matching the selected filter criteria.</td></tr>`
      : dateKeys
          .map((dateKey) => {
            const dayEvents = groupedEvents[dateKey];
            const parsedDate = parseISO(dateKey);
            let dayHeader = format(parsedDate, "EEEE, MMMM d, yyyy");
            if (isToday(parsedDate)) dayHeader = `Today — ${dayHeader}`;
            else if (isYesterday(parsedDate)) dayHeader = `Yesterday — ${dayHeader}`;

            const dateDivider =
              dateKeys.length > 1
                ? `<tr class="date-group-row">
                    <td colspan="7">
                      <div class="date-group-content">
                        <strong>${escapeHtml(dayHeader)}</strong> &nbsp;
                        <span class="date-count">(${dayEvents.length} event${dayEvents.length !== 1 ? "s" : ""})</span>
                      </div>
                    </td>
                   </tr>`
                : "";

            const rows = dayEvents
              .map((e) => {
                const timeStr = format(new Date(e.timestamp), "hh:mm a");
                const entityText = [e.entityType, e.entityLabel]
                  .filter(Boolean)
                  .join(": ");

                return `
                <tr>
                  <td class="col-time">${escapeHtml(timeStr)}</td>
                  <td class="col-module">${formatModuleBadge(e.module)}</td>
                  <td class="col-action"><strong>${escapeHtml(e.action || "Event")}</strong></td>
                  <td class="col-entity">
                    <span class="entity-title">${escapeHtml(entityText || "—")}</span>
                    ${e.entityId ? `<span class="entity-id">ID: ${escapeHtml(e.entityId)}</span>` : ""}
                  </td>
                  <td class="col-desc">
                    ${escapeHtml(e.description || "")}
                  </td>
                  <td class="col-operator">
                    <span class="operator-name">${escapeHtml(e.actorName || "Automated System")}</span>
                    ${e.ipAddress ? `<span class="operator-ip">${escapeHtml(e.ipAddress)}</span>` : ""}
                  </td>
                  <td class="col-severity">${formatSeverityBadge(e.severity)}</td>
                </tr>`;
              })
              .join("");

            return dateDivider + rows;
          })
          .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Activity Timeline Audit Report — ${escapeHtml(periodLabel)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 11px;
      color: #1e293b;
      background: #ffffff;
      padding: 16px;
      line-height: 1.4;
    }
    
    @media print {
      @page {
        size: A4 landscape;
        margin: 8mm;
      }
      body {
        padding: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .no-print {
        display: none !important;
      }
    }

    .report-header {
      border-bottom: 2px solid #0f172a;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }

    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 6px;
    }

    .brand-title {
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.02em;
    }

    .brand-subtitle {
      font-size: 11px;
      font-weight: 600;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .confidential-tag {
      font-size: 10px;
      font-weight: 800;
      color: #b91c1c;
      border: 1px solid #f87171;
      background: #fef2f2;
      padding: 3px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 10.5px;
    }

    .meta-item strong {
      color: #334155;
      font-weight: 700;
      margin-right: 4px;
    }

    .kpi-strip {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }

    .kpi-card {
      border: 1px solid #cbd5e1;
      background: #ffffff;
      padding: 8px 10px;
      border-radius: 6px;
    }

    .kpi-label {
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      color: #64748b;
      letter-spacing: 0.04em;
    }

    .kpi-value {
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
      margin-top: 2px;
    }

    .kpi-sub {
      font-size: 9.5px;
      color: #64748b;
      margin-top: 2px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      page-break-inside: auto;
    }

    tr {
      page-break-inside: avoid;
      page-break-after: auto;
    }

    thead {
      display: table-header-group;
    }

    th {
      background: #f1f5f9;
      color: #0f172a;
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      font-size: 9.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      text-align: left;
    }

    td {
      border: 1px solid #e2e8f0;
      padding: 6px 8px;
      font-size: 10px;
      vertical-align: top;
    }

    tr:nth-child(even) td {
      background: #fafbfc;
    }

    .col-time { width: 75px; font-weight: 700; color: #334155; white-space: nowrap; }
    .col-module { width: 95px; }
    .col-action { width: 95px; text-transform: capitalize; }
    .col-entity { width: 180px; }
    .col-desc { }
    .col-operator { width: 140px; }
    .col-severity { width: 85px; text-align: center; }

    .entity-title {
      display: block;
      font-weight: 600;
      color: #0f172a;
    }

    .entity-id {
      display: block;
      font-size: 9px;
      color: #64748b;
    }

    .operator-name {
      display: block;
      font-weight: 600;
      color: #0f172a;
    }

    .operator-ip {
      display: block;
      font-size: 9px;
      color: #64748b;
      font-family: monospace;
    }

    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .badge-module {
      background: #e2e8f0;
      color: #1e293b;
      border: 1px solid #cbd5e1;
    }

    .badge-info {
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #cbd5e1;
    }

    .badge-warning {
      background: #fffbeb;
      color: #b45309;
      border: 1px solid #fde68a;
    }

    .badge-critical {
      background: #fef2f2;
      color: #b91c1c;
      border: 1px solid #fca5a5;
    }

    .date-group-row td {
      background: #e2e8f0 !important;
      padding: 5px 8px;
      border: 1px solid #cbd5e1;
    }

    .date-group-content {
      display: flex;
      align-items: center;
      font-size: 10px;
      color: #0f172a;
    }

    .date-count {
      color: #64748b;
      font-weight: normal;
    }

    .empty-state {
      text-align: center;
      padding: 24px;
      color: #64748b;
      font-size: 11px;
    }

    .report-footer {
      margin-top: 14px;
      padding-top: 8px;
      border-top: 1px solid #cbd5e1;
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="report-header">
    <div class="header-top">
      <div>
        <h1 class="brand-title">TITAN ERP</h1>
        <div class="brand-subtitle">Operational Activity Timeline &amp; Audit Log</div>
      </div>
      <div class="confidential-tag">Internal Audit • Confidential</div>
    </div>

    <div class="meta-grid">
      <div class="meta-item">
        <strong>Report Period:</strong> ${escapeHtml(periodLabel)}
      </div>
      <div class="meta-item">
        <strong>Printed By:</strong> ${escapeHtml(printedBy)}
      </div>
      <div class="meta-item">
        <strong>Print Time:</strong> ${escapeHtml(printTimestamp)}
      </div>
      <div class="meta-item">
        <strong>Filter:</strong> ${escapeHtml(filterCriteria)}
      </div>
    </div>
  </div>

  <div class="kpi-strip">
    <div class="kpi-card">
      <div class="kpi-label">Total Events Recorded</div>
      <div class="kpi-value">${totalEvents.toLocaleString()}</div>
      <div class="kpi-sub">Across active criteria</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Standard Operations</div>
      <div class="kpi-value">${standardCount.toLocaleString()}</div>
      <div class="kpi-sub">Routine system events</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Warnings & Critical</div>
      <div class="kpi-value">${(warningCount + criticalCount).toLocaleString()}</div>
      <div class="kpi-sub">${criticalCount} Critical | ${warningCount} Warnings</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Active Operators / Top Dept</div>
      <div class="kpi-value">${operatorSet.size} Operator${operatorSet.size !== 1 ? "s" : ""}</div>
      <div class="kpi-sub">Top: ${escapeHtml(topModuleLabel)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="col-time">Time</th>
        <th class="col-module">Department</th>
        <th class="col-action">Action</th>
        <th class="col-entity">Target Entity</th>
        <th class="col-desc">Description & Audit Detail</th>
        <th class="col-operator">Operator / User</th>
        <th class="col-severity">Severity</th>
      </tr>
    </thead>
    <tbody>
      ${tableRowsHtml}
    </tbody>
  </table>

  <div class="report-footer">
    <div>TITAN ERP — Automated System Audit Trail</div>
    <div>Generated from live database logs • Page 1 of 1</div>
  </div>
</body>
</html>`;
}

export function printActivityTimeline(
  options: PrintActivityTimelineOptions,
): boolean {
  try {
    const html = generateActivityTimelinePrintHtml(options);
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      // Fallback if popup blocker intervenes: create an invisible iframe
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow?.document;
      if (!doc) return false;
      doc.open();
      doc.write(html);
      doc.close();

      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => document.body.removeChild(iframe), 2000);
      }, 300);
      return true;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 400);

    return true;
  } catch (err) {
    console.error("Failed to print activity timeline:", err);
    return false;
  }
}
