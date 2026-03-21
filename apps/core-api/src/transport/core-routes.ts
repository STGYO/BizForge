import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BizForgeRuntime } from "../server";

const orgHeaderSchema = z.object({
  "x-bizforge-org-id": z.string().min(1)
});

export async function registerCoreRoutes(
  server: FastifyInstance,
  runtime: BizForgeRuntime
): Promise<void> {
  runtime.automationEngine.initialize();

  server.get("/health", async () => ({
    status: "ok",
    service: "core-api",
    persistence: runtime.persistence
  }));

  server.get("/api/plugins", async () => {
    return runtime.pluginEngine.list();
  });

  server.post("/api/plugins/:name/disable", async (request, reply) => {
    const params = z.object({ name: z.string().min(1) }).parse(request.params);
    const changed = runtime.pluginEngine.disable(params.name);
    return changed ? { status: "disabled" } : reply.code(404).send({ error: "Plugin not found" });
  });

  server.post("/api/plugins/:name/enable", async (request, reply) => {
    const params = z.object({ name: z.string().min(1) }).parse(request.params);
    const changed = runtime.pluginEngine.enable(params.name);
    return changed ? { status: "enabled" } : reply.code(404).send({ error: "Plugin not found" });
  });

  server.get("/api/automation/rules", async (request) => {
    const headers = orgHeaderSchema.parse(request.headers);
    return await runtime.automationEngine.listRules(headers["x-bizforge-org-id"]);
  });

  server.get("/api/automation/catalog", async () => {
    return runtime.automationEngine.listCatalog();
  });

  server.post("/api/automation/rules", async (request, reply) => {
    const headers = orgHeaderSchema.parse(request.headers);
    const body = z
      .object({
        triggerEvent: z.string().min(1),
        conditions: z.array(
          z.object({
            field: z.string().min(1),
            equals: z.any()
          })
        ),
        actions: z.array(
          z.object({
            plugin: z.string().min(1),
            actionKey: z.string().min(1),
            input: z.record(z.any())
          })
        ),
        enabled: z.boolean().default(true)
      })
      .parse(request.body);

    const normalizedConditions = body.conditions.map((condition) => ({
      field: condition.field,
      equals: condition.equals as unknown
    }));

    try {
      return await runtime.automationEngine.createRule({
        organizationId: headers["x-bizforge-org-id"],
        triggerEvent: body.triggerEvent,
        conditions: normalizedConditions,
        actions: body.actions,
        enabled: body.enabled
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid automation rule";
      return reply.code(400).send({ error: message });
    }
  });
}
