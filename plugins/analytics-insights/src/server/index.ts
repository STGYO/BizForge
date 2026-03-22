import type {
  EventEnvelope,
  PluginManifest,
  PluginPermission,
  PluginRegistration,
  PluginHandler
} from "@bizforge/plugin-sdk";
import manifest from "../../plugin.json" assert { type: "json" };

const typedManifest = {
  ...manifest,
  permissions: manifest.permissions as PluginPermission[]
} as PluginManifest;

type MetricKind = "lead" | "message" | "invoice";

interface AnalyticsEvent {
  id: string;
  metric: MetricKind;
  value: number;
  occurredAt: string;
}

interface KpiReport {
  id: string;
  generatedAt: string;
  leads: number;
  conversions: number;
  conversionRate: number;
  messagesSent: number;
  invoicesPaid: number;
  revenue: number;
}

const analyticsEvents: AnalyticsEvent[] = [];
const reports: KpiReport[] = [];

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrganizationId(payload: Record<string, unknown>): string {
  return String(payload.organizationId ?? "org-1");
}

function normalizeMetric(value: unknown): MetricKind {
  const candidate = String(value ?? "lead").toLowerCase();
  if (candidate === "message" || candidate === "invoice") {
    return candidate;
  }

  return "lead";
}

function publishEvent(
  type: string,
  payload: Record<string, unknown>,
  organizationId: string,
  occurredAt: string,
  sourcePlugin: string
): EventEnvelope<Record<string, unknown>> {
  return {
    eventId: makeId("evt"),
    eventType: type,
    occurredAt,
    organizationId,
    sourcePlugin,
    schemaVersion: 1,
    payload
  };
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildReport(): KpiReport {
  const leads = analyticsEvents.filter((entry) => entry.metric === "lead" && entry.value > 0).length;
  const conversions = analyticsEvents.filter(
    (entry) => entry.metric === "lead" && entry.value >= 100
  ).length;
  const conversionRate = leads === 0 ? 0 : roundMetric((conversions / leads) * 100);
  const messagesSent = analyticsEvents
    .filter((entry) => entry.metric === "message")
    .reduce((sum, entry) => sum + entry.value, 0);
  const paidInvoices = analyticsEvents
    .filter((entry) => entry.metric === "invoice")
    .reduce((sum, entry) => sum + 1, 0);
  const revenue = analyticsEvents
    .filter((entry) => entry.metric === "invoice")
    .reduce((sum, entry) => sum + entry.value, 0);

  return {
    id: makeId("rpt"),
    generatedAt: new Date().toISOString(),
    leads,
    conversions,
    conversionRate,
    messagesSent,
    invoicesPaid: paidInvoices,
    revenue: roundMetric(revenue)
  };
}

const listRecords: PluginHandler = async () => {
  return {
    plugin: typedManifest.name,
    reports,
    eventsIngested: analyticsEvents.length
  };
};

const createRecord: PluginHandler = async ({ body }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const event: AnalyticsEvent = {
    id: makeId("ae"),
    metric: normalizeMetric(payload.metric),
    value: Number(payload.value ?? 1),
    occurredAt: String(payload.occurredAt ?? new Date().toISOString())
  };
  analyticsEvents.unshift(event);

  const generated = buildReport();
  reports.unshift(generated);

  const orgId = getOrganizationId(payload);
  await context.eventBus.publish(
    publishEvent(
      "analytics.report.generated",
      {
        reportId: generated.id,
        revenue: generated.revenue,
        conversionRate: generated.conversionRate,
        eventsIngested: analyticsEvents.length
      },
      orgId,
      generated.generatedAt,
      typedManifest.name
    )
  );

  const threshold = Number(payload.revenueThreshold ?? 1000);
  if (generated.revenue >= threshold) {
    await context.eventBus.publish(
      publishEvent(
        "analytics.kpi.threshold_breached",
        {
          reportId: generated.id,
          metric: "revenue",
          value: generated.revenue,
          threshold
        },
        orgId,
        generated.generatedAt,
        typedManifest.name
      )
    );
  }

  return {
    created: true,
    event,
    report: generated
  };
};

const generateReport: PluginHandler = async ({ body, actionInput }, context) => {
  const payload = ((actionInput ?? body) ?? {}) as Record<string, unknown>;
  const generated = buildReport();
  reports.unshift(generated);

  const orgId = getOrganizationId(payload);
  await context.eventBus.publish(
    publishEvent(
      "analytics.report.generated",
      {
        reportId: generated.id,
        revenue: generated.revenue,
        conversionRate: generated.conversionRate,
        eventsIngested: analyticsEvents.length
      },
      orgId,
      generated.generatedAt,
      typedManifest.name
    )
  );

  return {
    ok: true,
    report: generated
  };
};

const pluginAction: PluginHandler = async ({ actionInput }, context) => {
  const payload = (actionInput ?? {}) as Record<string, unknown>;
  const result = (await generateReport(
    {
      body: payload,
      query: {},
      params: {},
      headers: {},
      actionInput: payload
    },
    context
  )) as Record<string, unknown>;

  return {
    ok: true,
    plugin: typedManifest.name,
    action: "generate_kpi_report",
    report: result.report
  };
};

export const pluginRegistration: PluginRegistration = {
  manifest: typedManifest,
  handlers: {
    listRecords,
    createRecord,
    generateReport,
    pluginAction
  },
  routes: [
    {
      method: "GET",
      path: "/records",
      handlerName: "listRecords"
    },
    {
      method: "POST",
      path: "/records",
      handlerName: "createRecord"
    },
    {
      method: "POST",
      path: "/reports/generate",
      handlerName: "generateReport"
    }
  ],
  triggers: [
    {
      key: "analytics_report_generated",
      displayName: "Analytics Insights Updated",
      eventType: "analytics.report.generated"
    },
    {
      key: "analytics_kpi_threshold_breached",
      displayName: "Analytics KPI Threshold Breached",
      eventType: "analytics.kpi.threshold_breached"
    }
  ],
  actions: [
    {
      key: "generate_kpi_report",
      displayName: "Analytics Insights Action",
      handlerName: "pluginAction",
      inputSchema: {
        type: "object",
        properties: {
          revenueThreshold: { type: "number" },
          reportName: { type: "string" }
        },
        required: []
      }
    }
  ]
};




