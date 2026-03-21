import type { FastifyInstance } from "fastify";
import type { BizForgeRuntime } from "../server";

export async function registerPluginRoutes(
  server: FastifyInstance,
  runtime: BizForgeRuntime
): Promise<void> {
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
  }
}
