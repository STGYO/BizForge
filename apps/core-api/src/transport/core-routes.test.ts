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
