import type { FastifyInstance } from "fastify";
import type { PluginRuntimeContext } from "@bizforge/plugin-sdk";
import type { BizForgeRuntime } from "../server";

export async function registerPluginRoutes(
  server: FastifyInstance,
  runtime: BizForgeRuntime
): Promise<void> {
  const context: PluginRuntimeContext = {
    eventBus: runtime.eventBus
  };

  for (const plugin of runtime.pluginEngine.list()) {
    server.get(`/api/plugins/${plugin.manifest.name}/meta`, async () => ({
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      status: plugin.status,
      permissions: plugin.manifest.permissions,
      activationEvents: plugin.manifest.activationEvents,
      routes: plugin.registration.routes ?? [],
      triggers: plugin.registration.triggers ?? [],
      actions: plugin.registration.actions ?? []
    }));

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
