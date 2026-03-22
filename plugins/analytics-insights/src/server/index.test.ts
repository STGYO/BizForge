import assert from "node:assert/strict";
import test from "node:test";
import type { EventEnvelope, PluginHandler, PluginRuntimeContext } from "@bizforge/plugin-sdk";
import { pluginRegistration } from "./index";

const handlers = pluginRegistration.handlers;

if (!handlers) {
  throw new Error("Analytics insights handlers are missing");
}

if (!handlers.createRecord || !handlers.generateReport || !handlers.pluginAction) {
  throw new Error("Analytics insights expected handlers are missing");
}

const createRecord = handlers.createRecord as PluginHandler;
const generateReport = handlers.generateReport as PluginHandler;
const pluginAction = handlers.pluginAction as PluginHandler;

function makeContext(events: EventEnvelope[] = []): PluginRuntimeContext {
  return {
    eventBus: {
      publish: async (event) => {
        events.push(event);
      },
      subscribe: () => {
        return () => {
          return undefined;
        };
      }
    }
  };
}

const emptyInput = {
  body: {},
  query: {},
  params: {},
  headers: {}
};

test("createRecord ingests analytics event and emits report", async () => {
  const events: EventEnvelope[] = [];
  const result = (await createRecord(
    {
      ...emptyInput,
      body: {
        metric: "invoice",
        value: 250,
        organizationId: "org-test"
      }
    },
    makeContext(events)
  )) as Record<string, unknown>;

  assert.equal(result.created, true);
  const report = result.report as Record<string, unknown>;
  assert.equal(report.revenue, 250);
  assert.equal(events[0]?.eventType, "analytics.report.generated");
});

test("createRecord emits threshold event when revenue exceeds threshold", async () => {
  const events: EventEnvelope[] = [];
  const context = makeContext(events);

  const result = (await createRecord(
    {
      ...emptyInput,
      body: {
        metric: "invoice",
        value: 1200,
        revenueThreshold: 1000,
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.created, true);
  assert.equal(events[0]?.eventType, "analytics.report.generated");
  assert.equal(events[1]?.eventType, "analytics.kpi.threshold_breached");
});

test("generateReport returns KPI snapshot", async () => {
  const events: EventEnvelope[] = [];
  const context = makeContext(events);

  await createRecord(
    {
      ...emptyInput,
      body: {
        metric: "lead",
        value: 1,
        organizationId: "org-test"
      }
    },
    context
  );

  events.length = 0;
  const result = (await generateReport(
    {
      ...emptyInput,
      body: { organizationId: "org-test" }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.ok, true);
  const report = result.report as Record<string, unknown>;
  assert.equal(typeof report.conversionRate, "number");
  assert.equal(events[0]?.eventType, "analytics.report.generated");
});

test("pluginAction proxies report generation", async () => {
  const events: EventEnvelope[] = [];
  const result = (await pluginAction(
    {
      ...emptyInput,
      actionInput: {
        revenueThreshold: 500,
        organizationId: "org-test"
      }
    },
    makeContext(events)
  )) as Record<string, unknown>;

  assert.equal(result.ok, true);
  assert.equal(events[0]?.eventType, "analytics.report.generated");
});
