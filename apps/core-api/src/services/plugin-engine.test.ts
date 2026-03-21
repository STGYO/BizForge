import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { PluginEngine } from "./plugin-engine";

function createPluginManifest(name: string, backendEntry: string): string {
  return JSON.stringify({
    name,
    version: "1.0.0",
    author: "BizForge",
    description: "test plugin",
    permissions: ["automation"],
    activationEvents: ["onStartup"],
    backendEntry,
    frontendEntry: "dist/ui/index.js"
  });
}

test("loads plugins and reports skipped entries", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bizforge-plugin-engine-"));

  try {
    const validPluginRoot = path.join(tempRoot, "valid-plugin");
    const invalidPluginRoot = path.join(tempRoot, "missing-manifest");

    await mkdir(validPluginRoot, { recursive: true });
    await mkdir(path.join(validPluginRoot, "dist", "server"), { recursive: true });
    await mkdir(invalidPluginRoot, { recursive: true });

    await writeFile(
      path.join(validPluginRoot, "plugin.json"),
      createPluginManifest("valid-plugin", "dist/server/index.js"),
      "utf-8"
    );

    await writeFile(
      path.join(validPluginRoot, "dist", "server", "index.js"),
      [
        "export const registration = {",
        "  manifest: {",
        "    name: 'valid-plugin',",
        "    version: '1.0.0',",
        "    author: 'BizForge',",
        "    permissions: ['automation'],",
        "    activationEvents: ['onStartup'],",
        "    backendEntry: 'dist/server/index.js',",
        "    frontendEntry: 'dist/ui/index.js'",
        "  },",
        "  routes: [],",
        "  triggers: [],",
        "  actions: [],",
        "  handlers: {}",
        "};"
      ].join("\n"),
      "utf-8"
    );

    const engine = new PluginEngine({ pluginsDir: tempRoot });
    await engine.loadInstalledPlugins();

    const plugins = engine.list();
    assert.equal(plugins.length, 1);
    const loadedPlugin = plugins[0];
    assert.ok(loadedPlugin);
    assert.equal(loadedPlugin.manifest.name, "valid-plugin");

    const report = engine.getLoadReport();
    assert.equal(report.scannedDirectories, 2);
    assert.equal(report.loadedPlugins, 1);
    assert.equal(report.skippedPlugins, 1);
    assert.equal(report.failedPlugins.length, 1);
    const failedPlugin = report.failedPlugins[0];
    assert.ok(failedPlugin);
    assert.equal(failedPlugin.pluginDir, "missing-manifest");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
