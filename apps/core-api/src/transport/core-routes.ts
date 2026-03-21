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

  server.get("/api/runtime/diagnostics", async () => ({
    persistence: runtime.persistence,
    pluginLoad: runtime.pluginEngine.getLoadReport()
  }));

  server.get("/api/plugins", async () => {
    return runtime.pluginEngine.list();
  });

  server.post("/api/plugins/:name/disable", async (request, reply) => {
    const parsedParams = z.object({ name: z.string().min(1) }).safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid plugin name" });
    }

    const params = parsedParams.data;
    const changed = runtime.pluginEngine.disable(params.name);
    return changed ? { status: "disabled" } : reply.code(404).send({ error: "Plugin not found" });
  });

  server.post("/api/plugins/:name/enable", async (request, reply) => {
    const parsedParams = z.object({ name: z.string().min(1) }).safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid plugin name" });
    }

    const params = parsedParams.data;
    const changed = runtime.pluginEngine.enable(params.name);
    return changed ? { status: "enabled" } : reply.code(404).send({ error: "Plugin not found" });
  });

  server.post("/api/plugins/:name/install", async (request, reply) => {
    const parsedParams = z.object({ name: z.string().min(1) }).safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid plugin name" });
    }

    const params = parsedParams.data;
    const plugin = runtime.pluginEngine
      .list()
      .find((entry) => entry.manifest.name === params.name);

    if (!plugin) {
      return reply.code(404).send({ error: "Plugin not found" });
    }

    runtime.pluginEngine.enable(params.name);
    return reply.code(200).send({
      status: "installed",
      plugin: params.name
    });
  });

  server.post("/api/plugins/:name/uninstall", async (request, reply) => {
    const parsedParams = z.object({ name: z.string().min(1) }).safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid plugin name" });
    }

    const parsedHeaders = orgHeaderSchema.safeParse(request.headers);
    if (!parsedHeaders.success) {
      return reply.code(400).send({ error: "Missing x-bizforge-org-id header" });
    }

    const params = parsedParams.data;
    const headers = parsedHeaders.data;
    const plugin = runtime.pluginEngine
      .list()
      .find((entry) => entry.manifest.name === params.name);

    if (!plugin) {
      return reply.code(404).send({ error: "Plugin not found" });
    }

    const rules = await runtime.automationEngine.listRules(headers["x-bizforge-org-id"]);
    const activeReferences = rules.some((rule) =>
      rule.actions.some((action) => action.plugin === params.name)
    );

    if (activeReferences) {
      return reply.code(409).send({
        error: "Plugin is referenced by active automation rules"
      });
    }

    runtime.pluginEngine.disable(params.name);
    return reply.code(200).send({
      status: "uninstalled",
      plugin: params.name
    });
  });

  server.get("/api/automation/rules", async (request, reply) => {
    const parsedHeaders = orgHeaderSchema.safeParse(request.headers);
    if (!parsedHeaders.success) {
      return reply.code(400).send({ error: "Missing x-bizforge-org-id header" });
    }

    const headers = parsedHeaders.data;
    return await runtime.automationEngine.listRules(headers["x-bizforge-org-id"]);
  });

  server.get("/api/automation/catalog", async () => {
    return runtime.automationEngine.listCatalog();
  });

  server.post("/api/automation/rules", async (request, reply) => {
    const parsedHeaders = orgHeaderSchema.safeParse(request.headers);
    if (!parsedHeaders.success) {
      return reply.code(400).send({ error: "Missing x-bizforge-org-id header" });
    }

    const parsedBody = z
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
      .safeParse(request.body);

    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Invalid automation rule payload" });
    }

    const headers = parsedHeaders.data;
    const body = parsedBody.data;

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
