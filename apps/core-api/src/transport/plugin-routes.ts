import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PluginRuntimeContext } from "@bizforge/plugin-sdk";
import type { BizForgeRuntime } from "../server";
import { createPluginPersistenceHelper } from "../services/plugin-persistence";

export async function registerPluginRoutes(
  server: FastifyInstance,
  runtime: BizForgeRuntime
): Promise<void> {
  const context: PluginRuntimeContext = {
    eventBus: runtime.eventBus,
    db: runtime.pluginDatabase,
    persistence: createPluginPersistenceHelper(runtime.eventBus, runtime.pluginDatabase)
  };

  for (const plugin of runtime.pluginEngine.list()) {
    server.get(`/api/plugins/${plugin.manifest.name}/meta`, async () => ({
      pluginName: plugin.manifest.name,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      status: plugin.status,
      permissions: plugin.manifest.permissions,
      activationEvents: plugin.manifest.activationEvents,
      routes: plugin.registration.routes ?? [],
      triggers: plugin.registration.triggers ?? [],
      actions: plugin.registration.actions ?? [],
      ui: plugin.manifest.ui ?? null,
      uiComponents: plugin.registration.uiComponents ?? null
    }));

    server.get(`/api/plugins/${plugin.manifest.name}/ui/*`, async (request, reply) => {
      if (plugin.status !== "enabled") {
        return reply.code(409).send({
          error: "plugin_disabled",
          message: "Plugin is disabled"
        });
      }

      const wildcard = String((request.params as { "*"?: string })["*"] ?? "");
      const normalizedRelative = wildcard.replace(/\\/g, "/").replace(/^\/+/, "");

      if (!normalizedRelative || normalizedRelative.includes("..")) {
        return reply.code(400).send({ error: "invalid_ui_asset_path" });
      }

      const candidatePaths = [
        path.resolve(plugin.rootPath, "ui", normalizedRelative),
        path.resolve(plugin.rootPath, "dist", "ui", normalizedRelative)
      ];

      for (const candidate of candidatePaths) {
        try {
          const content = await readFile(candidate);
          const extension = path.extname(candidate).toLowerCase();
          const mimeType =
            extension === ".html"
              ? "text/html; charset=utf-8"
              : extension === ".js"
                ? "application/javascript; charset=utf-8"
                : extension === ".css"
                  ? "text/css; charset=utf-8"
                  : "application/octet-stream";

          return reply.type(mimeType).send(content);
        } catch {
          continue;
        }
      }

      return reply.code(404).send({ error: "ui_asset_not_found" });
    });

    for (const route of plugin.registration.routes ?? []) {
      const fullPath = `/api/plugins/${plugin.manifest.name}${route.path}`;

      server.route({
        method: route.method,
        url: fullPath,
        handler: async (request, reply) => {
          if (plugin.status !== "enabled") {
            return reply.code(409).send({
              error: "plugin_disabled",
              message: "Plugin is disabled"
            });
          }

          const handler = plugin.registration.handlers?.[route.handlerName];
          if (!handler) {
            return reply.code(500).send({
              error: "handler_not_found",
              message: `Plugin handler not found: ${route.handlerName}`
            });
          }

          try {
            const result = await handler(
              {
                body: request.body,
                query: request.query,
                params: request.params,
                headers: request.headers
              },
              context
            );

            return reply.send(result);
          } catch (error) {
            request.log.error(
              { error, plugin: plugin.manifest.name, handler: route.handlerName },
              "Plugin route handler failed"
            );
            return reply.code(500).send({
              error: "handler_execution_failed",
              message: "Plugin route execution failed"
            });
          }
        }
      });
    }
  }
}
