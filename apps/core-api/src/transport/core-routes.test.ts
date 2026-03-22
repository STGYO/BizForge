import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerCoreRoutes } from "./core-routes";
import type { BizForgeRuntime } from "../server";

function createRuntimeStub(): BizForgeRuntime {
  return {
    persistence: "in-memory",
    eventBus: {} as BizForgeRuntime["eventBus"],
    pluginEngine: {
      list: () => [],
      disable: () => false,
      enable: () => false,
      getLoadReport: () => ({
        scannedDirectories: 2,
        loadedPlugins: 1,
        skippedPlugins: 1,
        failedPlugins: [{ pluginDir: "broken-plugin", reason: "Missing plugin.json" }]
      })
    } as unknown as BizForgeRuntime["pluginEngine"],
    automationEngine: {
      initialize: () => {},
      listRules: async () => [],
      listCatalog: () => ({ triggers: [], actions: [] }),
      createRule: async () => {
        throw new Error("Unknown plugin: unknown-plugin");
      }
    } as unknown as BizForgeRuntime["automationEngine"]
  };
}

function createRuntimeStubWithRules(
  rules: Array<{ actions: Array<{ plugin: string }> }>
): BizForgeRuntime {
  return {
    persistence: "in-memory",
    eventBus: {} as BizForgeRuntime["eventBus"],
    pluginEngine: {
      list: () => [
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
          status: "enabled",
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
            routes: [],
            triggers: [],
            actions: []
          }
        }
      ],
      disable: () => true,
      enable: () => true,
      getLoadReport: () => ({
        scannedDirectories: 1,
        loadedPlugins: 1,
        skippedPlugins: 0,
        failedPlugins: []
      })
    } as unknown as BizForgeRuntime["pluginEngine"],
    automationEngine: {
      initialize: () => {},
      listRules: async () => rules as unknown as Array<
        Awaited<ReturnType<BizForgeRuntime["automationEngine"]["listRules"]>>[number]
      >,
      listCatalog: () => ({ triggers: [], actions: [] }),
      createRule: async () => {
        throw new Error("Unknown plugin: unknown-plugin");
      }
    } as unknown as BizForgeRuntime["automationEngine"]
  };
}

test("returns health payload", async () => {
  const app = Fastify();
  await registerCoreRoutes(app, createRuntimeStub());

  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { status: string; service: string; persistence: string };
  assert.equal(body.status, "ok");
  assert.equal(body.service, "core-api");
  assert.equal(body.persistence, "in-memory");

  await app.close();
});

test("returns runtime diagnostics payload", async () => {
  const app = Fastify();
  await registerCoreRoutes(app, createRuntimeStub());

  const response = await app.inject({ method: "GET", url: "/api/runtime/diagnostics" });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    persistence: string;
    pluginLoad: {
      scannedDirectories: number;
      loadedPlugins: number;
      skippedPlugins: number;
      failedPlugins: Array<{ pluginDir: string; reason: string }>;
    };
  };

  assert.equal(body.persistence, "in-memory");
  assert.equal(body.pluginLoad.scannedDirectories, 2);
  assert.equal(body.pluginLoad.loadedPlugins, 1);
  assert.equal(body.pluginLoad.skippedPlugins, 1);
  assert.equal(body.pluginLoad.failedPlugins[0]?.pluginDir, "broken-plugin");

  await app.close();
});

test("returns 400 when org header is missing for list rules", async () => {
  const app = Fastify();
  await registerCoreRoutes(app, createRuntimeStub());

  const response = await app.inject({ method: "GET", url: "/api/automation/rules" });

  assert.equal(response.statusCode, 400);
  const body = response.json() as { error: string };
  assert.match(body.error, /x-bizforge-org-id/i);

  await app.close();
});

test("returns 400 when automation rule payload is invalid", async () => {
  const app = Fastify();
  await registerCoreRoutes(app, createRuntimeStub());

  const response = await app.inject({
    method: "POST",
    url: "/api/automation/rules",
    headers: {
      "x-bizforge-org-id": "org-1"
    },
    payload: {
      triggerEvent: "",
      conditions: [],
      actions: []
    }
  });

  assert.equal(response.statusCode, 400);
  const body = response.json() as { error: string };
  assert.match(body.error, /invalid automation rule payload/i);

  await app.close();
});

test("returns 400 when rule definition validation fails", async () => {
  const app = Fastify();
  await registerCoreRoutes(app, createRuntimeStub());

  const response = await app.inject({
    method: "POST",
    url: "/api/automation/rules",
    headers: {
      "x-bizforge-org-id": "org-1"
    },
    payload: {
      triggerEvent: "lead.generated",
      conditions: [{ field: "source", equals: "web" }],
      actions: [
        {
          plugin: "unknown-plugin",
          actionKey: "do-something",
          input: {}
        }
      ],
      enabled: true
    }
  });

  assert.equal(response.statusCode, 400);
  const body = response.json() as { error: string };
  assert.match(body.error, /unknown plugin/i);

  await app.close();
});

test("installs plugin when plugin exists", async () => {
  const app = Fastify();
  await registerCoreRoutes(app, createRuntimeStubWithRules([]));

  const response = await app.inject({
    method: "POST",
    url: "/api/plugins/appointment-manager/install"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { status: string; plugin: string };
  assert.equal(body.status, "installed");
  assert.equal(body.plugin, "appointment-manager");

  await app.close();
});

test("returns not found when installing unknown plugin", async () => {
  const app = Fastify();
  await registerCoreRoutes(app, createRuntimeStub());

  const response = await app.inject({
    method: "POST",
    url: "/api/plugins/unknown/install"
  });

  assert.equal(response.statusCode, 404);
  const body = response.json() as { error: string; code: string };
  assert.match(body.error, /plugin not found/i);
  assert.equal(body.code, "plugin_not_found");

  await app.close();
});

test("blocks uninstall when plugin is referenced by automation rules", async () => {
  const app = Fastify();
  await registerCoreRoutes(
    app,
    createRuntimeStubWithRules([
      {
        actions: [{ plugin: "appointment-manager" }]
      }
    ])
  );

  await app.inject({
    method: "POST",
    url: "/api/marketplace/plugins/appointment-manager/install",
    headers: {
      "x-bizforge-org-id": "org-1"
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/plugins/appointment-manager/uninstall",
    headers: {
      "x-bizforge-org-id": "org-1"
    }
  });

  assert.equal(response.statusCode, 409);
  const body = response.json() as { error: string; code: string };
  assert.match(body.error, /referenced by active automation rules/i);
  assert.equal(body.code, "plugin_in_use");

  await app.close();
});

test("uninstalls plugin when no automation rules reference it", async () => {
  const app = Fastify();
  await registerCoreRoutes(app, createRuntimeStubWithRules([]));

  await app.inject({
    method: "POST",
    url: "/api/marketplace/plugins/appointment-manager/install",
    headers: {
      "x-bizforge-org-id": "org-1"
    }
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/plugins/appointment-manager/uninstall",
    headers: {
      "x-bizforge-org-id": "org-1"
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { status: string; plugin: string };
  assert.equal(body.status, "uninstalled");
  assert.equal(body.plugin, "appointment-manager");

  await app.close();
});

test("returns not found when uninstalling unknown plugin", async () => {
  const app = Fastify();
  await registerCoreRoutes(app, createRuntimeStub());

  const response = await app.inject({
    method: "POST",
    url: "/api/plugins/unknown/uninstall",
    headers: {
      "x-bizforge-org-id": "org-1"
    }
  });

  assert.equal(response.statusCode, 404);
  const body = response.json() as { error: string; code: string };
  assert.match(body.error, /plugin not found/i);
  assert.equal(body.code, "plugin_not_found");

  await app.close();
});

test("returns 400 when org header is missing for marketplace catalog", async () => {
  const app = Fastify();
  await registerCoreRoutes(app, createRuntimeStubWithRules([]));

  const response = await app.inject({ method: "GET", url: "/api/marketplace/plugins" });

  assert.equal(response.statusCode, 400);
  const body = response.json() as { error: string };
  assert.match(body.error, /x-bizforge-org-id/i);

  await app.close();
});

test("marketplace install and uninstall update org-scoped catalog state", async () => {
  const app = Fastify();
  await registerCoreRoutes(app, createRuntimeStubWithRules([]));

  const beforeInstall = await app.inject({
    method: "GET",
    url: "/api/marketplace/plugins",
    headers: {
      "x-bizforge-org-id": "org-1"
    }
  });

  assert.equal(beforeInstall.statusCode, 200);
  const beforeCatalog = beforeInstall.json() as Array<{ name: string; installed: boolean }>;
  assert.equal(beforeCatalog[0]?.name, "appointment-manager");
  assert.equal(beforeCatalog[0]?.installed, false);

  const installResponse = await app.inject({
    method: "POST",
    url: "/api/marketplace/plugins/appointment-manager/install",
    headers: {
      "x-bizforge-org-id": "org-1"
    }
  });

  assert.equal(installResponse.statusCode, 200);

  const afterInstall = await app.inject({
    method: "GET",
    url: "/api/marketplace/plugins",
    headers: {
      "x-bizforge-org-id": "org-1"
    }
  });

  const installedCatalog = afterInstall.json() as Array<{ name: string; installed: boolean }>;
  assert.equal(installedCatalog[0]?.installed, true);

  const uninstallResponse = await app.inject({
    method: "POST",
    url: "/api/marketplace/plugins/appointment-manager/uninstall",
    headers: {
      "x-bizforge-org-id": "org-1"
    }
  });

  assert.equal(uninstallResponse.statusCode, 200);

  const afterUninstall = await app.inject({
    method: "GET",
    url: "/api/marketplace/plugins",
    headers: {
      "x-bizforge-org-id": "org-1"
    }
  });

  const uninstalledCatalog = afterUninstall.json() as Array<{ name: string; installed: boolean }>;
  assert.equal(uninstalledCatalog[0]?.installed, false);

  await app.close();
});

test("marketplace catalog is isolated per organization", async () => {
  const app = Fastify();
  await registerCoreRoutes(app, createRuntimeStubWithRules([]));

  await app.inject({
    method: "POST",
    url: "/api/marketplace/plugins/appointment-manager/install",
    headers: {
      "x-bizforge-org-id": "org-1"
    }
  });

  const orgOneCatalog = await app.inject({
    method: "GET",
    url: "/api/marketplace/plugins",
    headers: {
      "x-bizforge-org-id": "org-1"
    }
  });

  const orgTwoCatalog = await app.inject({
    method: "GET",
    url: "/api/marketplace/plugins",
    headers: {
      "x-bizforge-org-id": "org-2"
    }
  });

  const orgOne = orgOneCatalog.json() as Array<{ installed: boolean }>;
  const orgTwo = orgTwoCatalog.json() as Array<{ installed: boolean }>;

  assert.equal(orgOne[0]?.installed, true);
  assert.equal(orgTwo[0]?.installed, false);

  await app.close();
});
