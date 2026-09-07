import { describe, expect, it } from "vitest";
import { generateActivityTimelinePrintHtml } from "./activity-timeline-print";
import type { ActivityEvent } from "./activity-event-card";

describe("activity timeline print report generator", () => {
  const sampleEvents: ActivityEvent[] = [
    {
      id: "ev-1",
      timestamp: new Date("2026-09-07T09:12:00Z"),
      module: "sales",
      action: "created",
      entityType: "invoice",
      entityId: "INV-104",
      entityLabel: "Al-Madina Traders",
      actorId: "usr-1",
      actorName: "Junaid Khan",
      description: "Generated sales invoice for PKR 145,000",
      metadata: null,
      ipAddress: "192.168.1.55",
      severity: "info",
    },
    {
      id: "ev-2",
      timestamp: new Date("2026-09-07T11:20:00Z"),
      module: "auth",
      action: "failed_login",
      entityType: "user",
      entityId: "usr-admin",
      entityLabel: "bilal@titan",
      actorId: "usr-admin",
      actorName: "Unknown IP",
      description: "5 repeated failed password attempts detected",
      metadata: null,
      ipAddress: "192.168.1.42",
      severity: "warning",
    },
  ];

  it("generates complete HTML document with header, branding, and confidentiality", () => {
    const html = generateActivityTimelinePrintHtml({
      events: sampleEvents,
      filters: {
        module: "sales",
        severity: "all",
      },
      printedBy: "Muhammad Bilal",
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("TITAN ERP");
    expect(html).toContain("Operational Activity Timeline &amp; Audit Log");
    expect(html).toContain("Internal Audit • Confidential");
    expect(html).toContain("Muhammad Bilal");
    expect(html).toContain("@media print");
    expect(html).toContain("size: A4 landscape;");
  });

  it("calculates and displays summary KPI metrics correctly", () => {
    const html = generateActivityTimelinePrintHtml({
      events: sampleEvents,
      filters: {},
      printedBy: "Admin",
    });

    // 2 total events
    expect(html).toContain('<div class="kpi-value">2</div>');
    // 1 standard operation
    expect(html).toContain('<div class="kpi-value">1</div>');
    // 1 warning
    expect(html).toContain("1 Warnings");
    // Active operators count
    expect(html).toContain("2 Operators");
  });

  it("renders table rows with actions, entities, descriptions, and operators", () => {
    const html = generateActivityTimelinePrintHtml({
      events: sampleEvents,
      filters: {},
    });

    expect(html).toContain("Al-Madina Traders");
    expect(html).toContain("INV-104");
    expect(html).toContain("Generated sales invoice for PKR 145,000");
    expect(html).toContain("Junaid Khan");
    expect(html).toContain("192.168.1.55");
    expect(html).toContain("WARNING");
    expect(html).toContain("STANDARD");
  });

  it("handles empty events list with an informative message", () => {
    const html = generateActivityTimelinePrintHtml({
      events: [],
      filters: { search: "non-existent" },
    });

    expect(html).toContain("No activity events recorded matching the selected filter criteria.");
    expect(html).toContain('<div class="kpi-value">0</div>');
  });
});
