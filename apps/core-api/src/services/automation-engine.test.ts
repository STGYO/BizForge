import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AutomationEngine } from "./automation-engine";
import { InMemoryEventBus } from "./event-bus";
import {
  InMemoryAutomationRuleRepository,
  type AutomationRuleRepository
} from "../repositories/automation-rule-repository";
import type { PluginEngine } from "./plugin-engine";

function createPluginEngineStub(options: {
  status?: "enabled" | "disabled";
  withHandler?: boolean;
}): PluginEngine {
  const status = options.status ?? "enabled";
  const withHandler = options.withHandler ?? true;

  return {
    list() {
      return [
        {
          manifest: {
            name: "appointment-manager",
            version: "1.0.0",
            author: "BizForge",
            permissions: ["automation"],
            activationEvents: ["onStartup"],
            backendEntry: "dist/server/index.js",
            frontendEntry: "dist/ui/index.js"
          },
          status,
          rootPath: "plugins/appointment-manager",
          registration: {
            manifest: {
              name: "appointment-manager",
              version: "1.0.0",
              author: "BizForge",
              permissions: ["automation"],
              activationEvents: ["onStartup"],
              backendEntry: "dist/server/index.js",
              frontendEntry: "dist/ui/index.js"
            },
            actions: [
              {
                key: "schedule_follow_up",
                displayName: "Schedule Follow Up",
                handlerName: "scheduleFollowUp",
                inputSchema: {
                  type: "object",
                  properties: {
                    customerId: { type: "string" },
                    offsetHours: { type: "number" }
                  },
                  required: ["customerId", "offsetHours"]
                }
              }
            ],
            handlers: withHandler
              ? {
                  scheduleFollowUp: async () => ({ ok: true })
                }
              : {}
          }
        }
      ];
    }
  } as unknown as PluginEngine;
}

function createEngine(pluginEngine: PluginEngine): {
  engine: AutomationEngine;
  eventBus: InMemoryEventBus;
  repository: AutomationRuleRepository;
} {
  const eventBus = new InMemoryEventBus();
  const repository = new InMemoryAutomationRuleRepository();
  const engine = new AutomationEngine(eventBus, pluginEngine, repository);
  engine.initialize();

  return { engine, eventBus, repository };
}

test("emits automation.action.executed for successful action handler", async () => {
  const { eventBus } = createEngine(createPluginEngineStub({ status: "enabled", withHandler: true }));

  const executedEvents: Array<Record<string, unknown>> = [];
  eventBus.subscribe("automation.action.executed", async (event) => {
    executedEvents.push(event.payload as Record<string, unknown>);
  });

  await eventBus.publish({
    eventId: randomUUID(),
    eventType: "automation.action.requested",
    occurredAt: new Date().toISOString(),
    organizationId: "org-1",
    sourcePlugin: "core.automation",
    schemaVersion: 1,
    payload: {
      plugin: "appointment-manager",
      actionKey: "schedule_follow_up",
      input: { customerId: "cust-1", offsetHours: 24 },
      triggerEventId: "trigger-1"
    }
  });

  assert.equal(executedEvents.length, 1);
  const executed = executedEvents[0];
  assert.ok(executed);
  assert.equal(executed.plugin, "appointment-manager");
  assert.equal(executed.actionKey, "schedule_follow_up");
  assert.equal(executed.triggerEventId, "trigger-1");
});

test("emits automation.action.failed when plugin is disabled", async () => {
  const { eventBus } = createEngine(createPluginEngineStub({ status: "disabled", withHandler: true }));

  const failedEvents: Array<Record<string, unknown>> = [];
  eventBus.subscribe("automation.action.failed", async (event) => {
    failedEvents.push(event.payload as Record<string, unknown>);
  });

  await eventBus.publish({
    eventId: randomUUID(),
    eventType: "automation.action.requested",
    occurredAt: new Date().toISOString(),
    organizationId: "org-1",
    sourcePlugin: "core.automation",
    schemaVersion: 1,
    payload: {
      plugin: "appointment-manager",
      actionKey: "schedule_follow_up",
      input: { customerId: "cust-1", offsetHours: 24 },
      triggerEventId: "trigger-1"
    }
  });

  assert.equal(failedEvents.length, 1);
  const failed = failedEvents[0];
  assert.ok(failed);
  assert.equal(failed.reason, "plugin_unavailable");
  assert.equal(failed.plugin, "appointment-manager");
  assert.equal(failed.actionKey, "schedule_follow_up");
  assert.equal(failed.triggerEventId, "trigger-1");
});

test("validates rule definitions against plugin catalog", async () => {
  const { engine } = createEngine(createPluginEngineStub({ status: "enabled", withHandler: true }));

  const valid = engine.validateRuleDefinition([
    {
      plugin: "appointment-manager",
      actionKey: "schedule_follow_up",
      input: {}
    }
  ]);
  assert.equal(valid.valid, true);

  const invalid = engine.validateRuleDefinition([
    {
      plugin: "unknown-plugin",
      actionKey: "schedule_follow_up",
      input: {}
    }
  ]);
  assert.equal(invalid.valid, false);
  if (!invalid.valid) {
    assert.match(invalid.error, /Unknown plugin/);
  }
});

test("rejects createRule when trigger event is unknown", async () => {
  const { engine } = createEngine(createPluginEngineStub({ status: "enabled", withHandler: true }));

  await assert.rejects(
    async () => {
      await engine.createRule({
        organizationId: "org-1",
        triggerEvent: "unknown.event",
        conditions: [],
        actions: [
          {
            plugin: "appointment-manager",
            actionKey: "schedule_follow_up",
            input: { customerId: "cust-1", offsetHours: 24 }
          }
        ],
        enabled: true
      });
    },
    /Unknown trigger event/
  );
});

test("emits automation.action.failed when action input violates schema", async () => {
  const { eventBus } = createEngine(createPluginEngineStub({ status: "enabled", withHandler: true }));

  const failedEvents: Array<Record<string, unknown>> = [];
  const executedEvents: Array<Record<string, unknown>> = [];

  eventBus.subscribe("automation.action.failed", async (event) => {
    failedEvents.push(event.payload as Record<string, unknown>);
  });
  eventBus.subscribe("automation.action.executed", async (event) => {
    executedEvents.push(event.payload as Record<string, unknown>);
  });

  await eventBus.publish({
    eventId: randomUUID(),
    eventType: "automation.action.requested",
    occurredAt: new Date().toISOString(),
    organizationId: "org-1",
    sourcePlugin: "core.automation",
    schemaVersion: 1,
    payload: {
      plugin: "appointment-manager",
      actionKey: "schedule_follow_up",
      input: { customerId: "cust-1", offsetHours: "24" },
      triggerEventId: "trigger-2"
    }
  });

  assert.equal(executedEvents.length, 0);
  assert.equal(failedEvents.length, 1);

  const failed = failedEvents[0];
  assert.ok(failed);
  assert.equal(failed.reason, "action_input_validation_failed");
  assert.equal(failed.plugin, "appointment-manager");
  assert.equal(failed.actionKey, "schedule_follow_up");
  assert.equal(failed.triggerEventId, "trigger-2");
});

test("executes action end-to-end when trigger event matches rule", async () => {
  const { engine, eventBus } = createEngine(
    createPluginEngineStub({ status: "enabled", withHandler: true })
  );

  const executedEvents: Array<Record<string, unknown>> = [];
  eventBus.subscribe("automation.action.executed", async (event) => {
    executedEvents.push(event.payload as Record<string, unknown>);
  });

  await engine.createRule({
    organizationId: "org-1",
    triggerEvent: "lead.generated",
    conditions: [{ field: "source", equals: "web" }],
    actions: [
      {
        plugin: "appointment-manager",
        actionKey: "schedule_follow_up",
        input: { customerId: "cust-100", offsetHours: 24 }
      }
    ],
    enabled: true
  });

  await eventBus.publish({
    eventId: "trigger-e2e-1",
    eventType: "lead.generated",
    occurredAt: new Date().toISOString(),
    organizationId: "org-1",
    sourcePlugin: "core.leads",
    schemaVersion: 1,
    payload: {
      source: "web"
    }
  });

  assert.equal(executedEvents.length, 1);
  const executed = executedEvents[0];
  assert.ok(executed);
  assert.equal(executed.plugin, "appointment-manager");
  assert.equal(executed.actionKey, "schedule_follow_up");
  assert.equal(executed.triggerEventId, "trigger-e2e-1");
});

test("emits validation failure end-to-end when matched rule has invalid action input", async () => {
  const { engine, eventBus } = createEngine(
    createPluginEngineStub({ status: "enabled", withHandler: true })
  );

  const failedEvents: Array<Record<string, unknown>> = [];
  eventBus.subscribe("automation.action.failed", async (event) => {
    failedEvents.push(event.payload as Record<string, unknown>);
  });

  await engine.createRule({
    organizationId: "org-1",
    triggerEvent: "lead.generated",
    conditions: [{ field: "source", equals: "partner" }],
    actions: [
      {
        plugin: "appointment-manager",
        actionKey: "schedule_follow_up",
        input: { customerId: "cust-101", offsetHours: "invalid-type" }
      }
    ],
    enabled: true
  });

  await eventBus.publish({
    eventId: "trigger-e2e-2",
    eventType: "lead.generated",
    occurredAt: new Date().toISOString(),
    organizationId: "org-1",
    sourcePlugin: "core.leads",
    schemaVersion: 1,
    payload: {
      source: "partner"
    }
  });

  assert.equal(failedEvents.length, 1);
  const failed = failedEvents[0];
  assert.ok(failed);
  assert.equal(failed.reason, "action_input_validation_failed");
  assert.equal(failed.plugin, "appointment-manager");
  assert.equal(failed.actionKey, "schedule_follow_up");
  assert.equal(failed.triggerEventId, "trigger-e2e-2");
});

test("simulates rule match without executing handlers", async () => {
  const { engine, eventBus } = createEngine(
    createPluginEngineStub({ status: "enabled", withHandler: true })
  );

  const executedEvents: Array<Record<string, unknown>> = [];
  eventBus.subscribe("automation.action.executed", async (event) => {
    executedEvents.push(event.payload as Record<string, unknown>);
  });

  const created = await engine.createRule({
    organizationId: "org-1",
    triggerEvent: "lead.generated",
    conditions: [{ field: "source", equals: "web" }],
    actions: [
      {
        plugin: "appointment-manager",
        actionKey: "schedule_follow_up",
        input: { customerId: "cust-200", offsetHours: 24 }
      }
    ],
    enabled: true
  });

  const result = await engine.simulateRule(created.id, "org-1", {
    source: "web"
  });

  assert.ok(result);
  assert.equal(result?.matched, true);
  assert.equal(result?.actionsTriggered, 1);
  assert.deepEqual(result?.errors, []);
  assert.equal(executedEvents.length, 0);
});
