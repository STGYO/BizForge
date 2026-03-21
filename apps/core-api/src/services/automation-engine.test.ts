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
                inputSchema: {}
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
