import assert from "node:assert/strict";
import test from "node:test";
import type { EventEnvelope, PluginHandler, PluginRuntimeContext } from "@bizforge/plugin-sdk";
import { pluginRegistration } from "./index";

const handlers = pluginRegistration.handlers;

if (!handlers) {
  throw new Error("Automation engine handlers are missing");
}

if (!handlers.createRecord || !handlers.runWorkflow || !handlers.getExecution || !handlers.pluginAction) {
  throw new Error("Automation engine expected handlers are missing");
}

const createRecord = handlers.createRecord as PluginHandler;
const runWorkflow = handlers.runWorkflow as PluginHandler;
const getExecution = handlers.getExecution as PluginHandler;
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

test("createRecord registers workflow and emits rule.created", async () => {
  const events: EventEnvelope[] = [];
  const result = (await createRecord(
    {
      ...emptyInput,
      body: {
        name: "Retry invoices",
        triggerEvent: "invoice.created",
        organizationId: "org-test"
      }
    },
    makeContext(events)
  )) as Record<string, unknown>;

  assert.equal(result.created, true);
  const workflow = result.workflow as Record<string, unknown>;
  assert.equal(workflow.triggerEvent, "invoice.created");
  assert.equal(events[0]?.eventType, "automation.rule.created");
});

test("runWorkflow succeeds and emits started/completed events", async () => {
  const events: EventEnvelope[] = [];
  const context = makeContext(events);

  const created = (await createRecord(
    {
      ...emptyInput,
      body: {
        name: "Follow-up",
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  const workflow = created.workflow as Record<string, unknown>;
  const workflowId = String(workflow.id);
  events.length = 0;

  const run = (await runWorkflow(
    {
      ...emptyInput,
      params: { id: workflowId },
      body: { organizationId: "org-test" }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(run.ok, true);
  assert.equal(events[0]?.eventType, "automation.execution.started");
  assert.equal(events[1]?.eventType, "automation.execution.completed");
});

test("runWorkflow failure emits failed event and getExecution returns record", async () => {
  const events: EventEnvelope[] = [];
  const context = makeContext(events);

  const created = (await createRecord(
    {
      ...emptyInput,
      body: {
        name: "Flaky workflow",
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  const workflow = created.workflow as Record<string, unknown>;
  const workflowId = String(workflow.id);
  events.length = 0;

  const run = (await runWorkflow(
    {
      ...emptyInput,
      params: { id: workflowId },
      body: {
        organizationId: "org-test",
        simulateFailure: true,
        failureReason: "network timeout"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(run.ok, false);
  const execution = run.execution as Record<string, unknown>;
  assert.equal(execution.status, "failed");
  assert.equal(events[1]?.eventType, "automation.execution.failed");

  const lookup = (await getExecution(
    {
      ...emptyInput,
      params: { id: String(execution.id) }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(lookup.found, true);
});

test("pluginAction retries failed execution", async () => {
  const events: EventEnvelope[] = [];
  const context = makeContext(events);

  const created = (await createRecord(
    {
      ...emptyInput,
      body: {
        name: "Retry me",
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  const workflow = created.workflow as Record<string, unknown>;
  const workflowId = String(workflow.id);

  await runWorkflow(
    {
      ...emptyInput,
      params: { id: workflowId },
      body: {
        organizationId: "org-test",
        simulateFailure: true
      }
    },
    context
  );

  events.length = 0;

  const retried = (await pluginAction(
    {
      ...emptyInput,
      actionInput: {
        entityId: workflowId,
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(retried.ok, true);
  const execution = retried.execution as Record<string, unknown>;
  assert.equal(execution.status, "succeeded");
});
