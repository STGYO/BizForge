import assert from "node:assert/strict";
import test from "node:test";
import type { EventEnvelope, PluginHandler, PluginRuntimeContext } from "@bizforge/plugin-sdk";
import { pluginRegistration } from "./index";

const handlers = pluginRegistration.handlers;

if (!handlers) {
  throw new Error("Plugin manager handlers are missing");
}

if (!handlers.createRecord || !handlers.updatePluginState || !handlers.pluginAction || !handlers.listRecords) {
  throw new Error("Plugin manager expected handlers are missing");
}

const createRecord = handlers.createRecord as PluginHandler;
const updatePluginState = handlers.updatePluginState as PluginHandler;
const pluginAction = handlers.pluginAction as PluginHandler;
const listRecords = handlers.listRecords as PluginHandler;

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

test("createRecord registers plugin and emits lifecycle event", async () => {
  const events: EventEnvelope[] = [];
  const result = (await createRecord(
    {
      ...emptyInput,
      body: {
        pluginId: "analytics-insights",
        name: "Analytics Insights",
        organizationId: "org-test"
      }
    },
    makeContext(events)
  )) as Record<string, unknown>;

  assert.equal(result.created, true);
  const pluginRecord = result.pluginRecord as Record<string, unknown>;
  assert.equal(pluginRecord.id, "analytics-insights");
  assert.equal(events[0]?.eventType, "plugin.lifecycle.changed");
});

test("updatePluginState blocks disable with active dependents", async () => {
  const events: EventEnvelope[] = [];
  const context = makeContext(events);

  await createRecord(
    {
      ...emptyInput,
      body: {
        pluginId: "automation-engine",
        name: "Automation Engine",
        organizationId: "org-test"
      }
    },
    context
  );

  await createRecord(
    {
      ...emptyInput,
      body: {
        pluginId: "plugin-manager",
        name: "Plugin Manager",
        dependsOn: ["automation-engine"],
        organizationId: "org-test"
      }
    },
    context
  );

  const result = (await updatePluginState(
    {
      ...emptyInput,
      params: { id: "automation-engine" },
      body: {
        state: "disabled",
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.ok, false);
  assert.equal(result.error, "Cannot disable plugin with active dependents");
});

test("updatePluginState force disable succeeds and logs lifecycle", async () => {
  const events: EventEnvelope[] = [];
  const context = makeContext(events);

  const result = (await updatePluginState(
    {
      ...emptyInput,
      params: { id: "automation-engine" },
      body: {
        state: "disabled",
        force: true,
        reason: "maintenance",
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.ok, true);
  const lifecycleEntry = result.lifecycleEntry as Record<string, unknown>;
  assert.equal(lifecycleEntry.toState, "disabled");
  assert.equal(events[0]?.eventType, "plugin.lifecycle.changed");

  const listed = (await listRecords(emptyInput, context)) as Record<string, unknown>;
  const lifecycle = listed.lifecycle as Array<Record<string, unknown>>;
  assert.equal(lifecycle.length > 0, true);
});

test("pluginAction sync creates plugin when missing", async () => {
  const events: EventEnvelope[] = [];
  const context = makeContext(events);

  const result = (await pluginAction(
    {
      ...emptyInput,
      actionInput: {
        entityId: "document-manager",
        name: "Document Manager",
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.ok, true);
  const synced = result.synced as Record<string, unknown>;
  assert.equal(synced.created, true);
});
