import test from "node:test";
import assert from "node:assert/strict";
import { PluginLifecycleService } from "./plugin-lifecycle-service";
import type { AutomationRuleRecord } from "../repositories/automation-rule-repository";

function createServiceStub(options?: {
  pluginNames?: string[];
  rules?: AutomationRuleRecord[];
}) {
  const enabled: string[] = [];
  const disabled: string[] = [];

  const pluginNames = options?.pluginNames ?? ["appointment-manager"];
  const rules = options?.rules ?? [];

  const service = new PluginLifecycleService({
    pluginEngine: {
      list: () =>
        pluginNames.map((name) => ({
          manifest: {
            name,
            version: "1.0.0",
            author: "BizForge",
            permissions: [],
            activationEvents: [],
            backendEntry: "dist/server/index.js",
            frontendEntry: "dist/ui/index.js"
          },
          status: "enabled" as const,
          rootPath: `plugins/${name}`,
          registration: {
            manifest: {
              name,
              version: "1.0.0",
              author: "BizForge",
              permissions: [],
              activationEvents: [],
              backendEntry: "dist/server/index.js",
              frontendEntry: "dist/ui/index.js"
            },
            routes: [],
            triggers: [],
            actions: []
          }
        })),
      enable: (name: string) => {
        enabled.push(name);
        return true;
      },
      disable: (name: string) => {
        disabled.push(name);
        return true;
      }
    },
    automationEngine: {
      listRules: async () => rules
    }
  });

  return {
    service,
    enabled,
    disabled
  };
}

test("installPlugin returns not found when plugin is missing", async () => {
  const { service, enabled } = createServiceStub({ pluginNames: [] });

  const result = await service.installPlugin("missing-plugin");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.httpStatus, 404);
    assert.equal(result.error.code, "plugin_not_found");
  }
  assert.deepEqual(enabled, []);
});

test("installPlugin enables existing plugin", async () => {
  const { service, enabled } = createServiceStub();

  const result = await service.installPlugin("appointment-manager");

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.status, "installed");
    assert.equal(result.plugin, "appointment-manager");
  }
  assert.deepEqual(enabled, ["appointment-manager"]);
});

test("uninstallPlugin blocks when plugin is referenced by rules", async () => {
  const { service, disabled } = createServiceStub({
    rules: [
      {
        id: "rule-1",
        organizationId: "org-1",
        triggerEvent: "appointment.created",
        conditions: [],
        actions: [{ plugin: "appointment-manager", actionKey: "notify", input: {} }],
        enabled: true
      }
    ]
  });

  const result = await service.uninstallPlugin("appointment-manager", "org-1");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.httpStatus, 409);
    assert.equal(result.error.code, "plugin_in_use");
  }
  assert.deepEqual(disabled, []);
});

test("uninstallPlugin disables plugin when no active references exist", async () => {
  const { service, disabled } = createServiceStub({ rules: [] });

  const result = await service.uninstallPlugin("appointment-manager", "org-1");

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.status, "uninstalled");
    assert.equal(result.plugin, "appointment-manager");
  }
  assert.deepEqual(disabled, ["appointment-manager"]);
});