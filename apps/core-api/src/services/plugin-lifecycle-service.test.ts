import test from "node:test";
import assert from "node:assert/strict";
import { PluginLifecycleService } from "./plugin-lifecycle-service";
import type { AutomationRuleRecord } from "../repositories/automation-rule-repository";

function createServiceStub(options?: {
  plugins?: Array<{
    name: string;
    status?: "enabled" | "disabled";
    core?: boolean;
    dependsOn?: string[];
  }>;
  rules?: AutomationRuleRecord[];
}) {
  const enabled: string[] = [];
  const disabled: string[] = [];

  const plugins = options?.plugins ?? [{ name: "appointment-manager" }];
  const rules = options?.rules ?? [];

  const service = new PluginLifecycleService({
    pluginEngine: {
      list: () =>
        plugins.map((plugin) => ({
          manifest: {
            name: plugin.name,
            version: "1.0.0",
            author: "BizForge",
            core: plugin.core ?? false,
            dependsOn: plugin.dependsOn ?? [],
            permissions: [],
            activationEvents: [],
            backendEntry: "dist/server/index.js",
            frontendEntry: "dist/ui/index.js"
          },
          status: plugin.status ?? ("enabled" as const),
          rootPath: `plugins/${plugin.name}`,
          registration: {
            manifest: {
              name: plugin.name,
              version: "1.0.0",
              author: "BizForge",
              core: plugin.core ?? false,
              dependsOn: plugin.dependsOn ?? [],
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
  const { service, enabled } = createServiceStub({ plugins: [] });

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

test("installPlugin blocks when plugin dependency is missing", async () => {
  const { service, enabled } = createServiceStub({
    plugins: [
      {
        name: "messaging-notifications",
        dependsOn: ["customer-crm"]
      }
    ]
  });

  const result = await service.installPlugin("messaging-notifications", "org-1");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "plugin_dependency_missing");
    assert.match(result.error.message, /customer-crm/i);
  }
  assert.deepEqual(enabled, []);
});

test("disablePlugin blocks when active dependents exist", async () => {
  const { service, disabled } = createServiceStub({
    plugins: [
      { name: "customer-crm", status: "enabled" },
      { name: "leads-manager", status: "enabled", dependsOn: ["customer-crm"] }
    ]
  });

  const result = await service.disablePlugin("customer-crm");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "plugin_dependency_conflict");
  }
  assert.deepEqual(disabled, []);
});

test("disablePlugin allows force override when dependents exist", async () => {
  const { service, disabled } = createServiceStub({
    plugins: [
      { name: "customer-crm", status: "enabled" },
      { name: "leads-manager", status: "enabled", dependsOn: ["customer-crm"] }
    ]
  });

  const result = await service.disablePlugin("customer-crm", { force: true });

  assert.equal(result.ok, true);
  assert.deepEqual(disabled, ["customer-crm"]);
});

test("uninstallPlugin blocks core plugin without force", async () => {
  const { service } = createServiceStub({
    plugins: [{ name: "customer-crm", core: true }],
    rules: []
  });

  const result = await service.uninstallPlugin("customer-crm", "org-1");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "plugin_core_protected");
  }
});

test("uninstallPlugin allows core plugin force override", async () => {
  const { service, disabled } = createServiceStub({
    plugins: [{ name: "customer-crm", core: true }],
    rules: []
  });

  const result = await service.uninstallPlugin("customer-crm", "org-1", {
    force: true
  });

  assert.equal(result.ok, true);
  assert.deepEqual(disabled, ["customer-crm"]);
});