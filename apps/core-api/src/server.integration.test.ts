import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "./server";

function pluginManifestJson(name: string): string {
  return JSON.stringify({
    name,
    version: "1.0.0",
    author: "BizForge",
    description: "Integration test plugin",
    permissions: ["automation"],
    activationEvents: ["onStartup"],
    backendEntry: "dist/server/index.js",
    frontendEntry: "dist/ui/index.js"
  });
}

test("createServer loads plugin from PLUGINS_DIR and mounts plugin routes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bizforge-server-it-"));
  const pluginDir = path.join(tempRoot, "test-plugin");
  const originalPluginsDir = process.env.PLUGINS_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  try {
    await mkdir(path.join(pluginDir, "dist", "server"), { recursive: true });

    await writeFile(path.join(pluginDir, "plugin.json"), pluginManifestJson("test-plugin"), "utf-8");
    await writeFile(
      path.join(pluginDir, "dist", "server", "index.js"),
      [
        "export const testPluginRegistration = {",
        "  manifest: {",
        "    name: 'test-plugin',",
        "    version: '1.0.0',",
        "    author: 'BizForge',",
        "    permissions: ['automation'],",
        "    activationEvents: ['onStartup'],",
        "    backendEntry: 'dist/server/index.js',",
        "    frontendEntry: 'dist/ui/index.js'",
        "  },",
        "  routes: [",
        "    { method: 'GET', path: '/ping', handlerName: 'pingHandler' }",
        "  ],",
        "  triggers: [],",
        "  actions: [],",
        "  handlers: {",
        "    pingHandler: async () => ({ ok: true, source: 'test-plugin' })",
        "  }",
        "};"
      ].join("\n"),
      "utf-8"
    );

    process.env.PLUGINS_DIR = tempRoot;
    delete process.env.DATABASE_URL;

    const server = await createServer();

    try {
      const pluginsResponse = await server.inject({
        method: "GET",
        url: "/api/plugins"
      });

      assert.equal(pluginsResponse.statusCode, 200);
      const plugins = pluginsResponse.json() as Array<{ manifest: { name: string } }>;
      assert.equal(plugins.length, 1);
      assert.equal(plugins[0]?.manifest.name, "test-plugin");

      const metaResponse = await server.inject({
        method: "GET",
        url: "/api/plugins/test-plugin/meta"
      });

      assert.equal(metaResponse.statusCode, 200);
      const meta = metaResponse.json() as { name: string; routes: Array<{ path: string }> };
      assert.equal(meta.name, "test-plugin");
      assert.equal(meta.routes[0]?.path, "/ping");

      const routeResponse = await server.inject({
        method: "GET",
        url: "/api/plugins/test-plugin/ping"
      });

      assert.equal(routeResponse.statusCode, 200);
      const routeBody = routeResponse.json() as { ok: boolean; source: string };
      assert.equal(routeBody.ok, true);
      assert.equal(routeBody.source, "test-plugin");

      const diagnosticsResponse = await server.inject({
        method: "GET",
        url: "/api/runtime/diagnostics"
      });

      assert.equal(diagnosticsResponse.statusCode, 200);
      const diagnostics = diagnosticsResponse.json() as {
        persistence: string;
        pluginLoad: { loadedPlugins: number; scannedDirectories: number };
      };
      assert.equal(diagnostics.persistence, "in-memory");
      assert.equal(diagnostics.pluginLoad.scannedDirectories, 1);
      assert.equal(diagnostics.pluginLoad.loadedPlugins, 1);
    } finally {
      await server.close();
    }
  } finally {
    if (originalPluginsDir === undefined) {
      delete process.env.PLUGINS_DIR;
    } else {
      process.env.PLUGINS_DIR = originalPluginsDir;
    }

    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("createServer reports route-conflicting plugin as skipped in diagnostics", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bizforge-server-it-conflict-"));
  const pluginOneDir = path.join(tempRoot, "plugin-one");
  const pluginTwoDir = path.join(tempRoot, "plugin-two");
  const originalPluginsDir = process.env.PLUGINS_DIR;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  try {
    await mkdir(path.join(pluginOneDir, "dist", "server"), { recursive: true });
    await mkdir(path.join(pluginTwoDir, "dist", "server"), { recursive: true });

    await writeFile(path.join(pluginOneDir, "plugin.json"), pluginManifestJson("plugin-one"), "utf-8");
    await writeFile(path.join(pluginTwoDir, "plugin.json"), pluginManifestJson("plugin-two"), "utf-8");

    const moduleWithConflictingRoute = (name: string) =>
      [
        "export const registration = {",
        "  manifest: {",
        `    name: '${name}',`,
        "    version: '1.0.0',",
        "    author: 'BizForge',",
        "    permissions: ['automation'],",
        "    activationEvents: ['onStartup'],",
        "    backendEntry: 'dist/server/index.js',",
        "    frontendEntry: 'dist/ui/index.js'",
        "  },",
        "  routes: [",
        "    { method: 'GET', path: '/ping', handlerName: 'pingHandler' }",
        "  ],",
        "  triggers: [],",
        "  actions: [],",
        "  handlers: {",
        "    pingHandler: async () => ({ ok: true, source: 'conflict' })",
        "  }",
        "};"
      ].join("\n");

    await writeFile(
      path.join(pluginOneDir, "dist", "server", "index.js"),
      moduleWithConflictingRoute("plugin-one"),
      "utf-8"
    );
    await writeFile(
      path.join(pluginTwoDir, "dist", "server", "index.js"),
      moduleWithConflictingRoute("plugin-two"),
      "utf-8"
    );

    process.env.PLUGINS_DIR = tempRoot;
    delete process.env.DATABASE_URL;

    const server = await createServer();

    try {
      const diagnosticsResponse = await server.inject({
        method: "GET",
        url: "/api/runtime/diagnostics"
      });

      assert.equal(diagnosticsResponse.statusCode, 200);
      const diagnostics = diagnosticsResponse.json() as {
        pluginLoad: {
          scannedDirectories: number;
          loadedPlugins: number;
          skippedPlugins: number;
          failedPlugins: Array<{ reason: string }>;
        };
      };

      assert.equal(diagnostics.pluginLoad.scannedDirectories, 2);
      assert.equal(diagnostics.pluginLoad.loadedPlugins, 1);
      assert.equal(diagnostics.pluginLoad.skippedPlugins, 1);
      assert.equal(diagnostics.pluginLoad.failedPlugins.length, 1);
      assert.match(diagnostics.pluginLoad.failedPlugins[0]?.reason ?? "", /Route conflicts detected/i);

      const pluginListResponse = await server.inject({ method: "GET", url: "/api/plugins" });
      assert.equal(pluginListResponse.statusCode, 200);
      const plugins = pluginListResponse.json() as Array<{ manifest: { name: string } }>;
      assert.equal(plugins.length, 1);
    } finally {
      await server.close();
    }
  } finally {
    if (originalPluginsDir === undefined) {
      delete process.env.PLUGINS_DIR;
    } else {
      process.env.PLUGINS_DIR = originalPluginsDir;
    }

    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});
