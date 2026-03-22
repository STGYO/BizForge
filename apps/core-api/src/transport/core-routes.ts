import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BizForgeRuntime } from "../server";
import { PluginLifecycleService } from "../services/plugin-lifecycle-service";
import { MarketplaceService } from "../services/marketplace-service";
import { InMemoryPluginInstallRepository } from "../repositories/plugin-install-repository";

const orgHeaderSchema = z.object({
  "x-bizforge-org-id": z.string().min(1)
});

const automationRuleIdParamsSchema = z.object({
  id: z.string().min(1)
});

const automationRuleBodySchema = z.object({
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
});

const automationRulePatchBodySchema = z
  .object({
    triggerEvent: z.string().min(1).optional(),
    conditions: z
      .array(
        z.object({
          field: z.string().min(1),
          equals: z.any()
        })
      )
      .optional(),
    actions: z
      .array(
        z.object({
          plugin: z.string().min(1),
          actionKey: z.string().min(1),
          input: z.record(z.any())
        })
      )
      .optional(),
    enabled: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required"
  });

const automationSimulationBodySchema = z.object({
  samplePayload: z.record(z.any())
});

export async function registerCoreRoutes(
  server: FastifyInstance,
  runtime: BizForgeRuntime
): Promise<void> {
  runtime.automationEngine.initialize();
  const pluginInstallRepository = new InMemoryPluginInstallRepository();
  const pluginLifecycleService = new PluginLifecycleService({
    pluginEngine: runtime.pluginEngine,
    automationEngine: runtime.automationEngine,
    pluginInstallRepository
  });
  const marketplaceService = new MarketplaceService({
    pluginEngine: runtime.pluginEngine,
    pluginInstallRepository
  });

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
    const outcome = await pluginLifecycleService.installPlugin(params.name);
    if (!outcome.ok) {
      return reply.code(outcome.error.httpStatus).send({
        error: outcome.error.message,
        code: outcome.error.code
      });
    }

    return reply.code(200).send({
      status: outcome.status,
      plugin: outcome.plugin
    });
  });

  server.get("/api/marketplace/plugins", async (request, reply) => {
    const parsedHeaders = orgHeaderSchema.safeParse(request.headers);
    if (!parsedHeaders.success) {
      return reply.code(400).send({ error: "Missing x-bizforge-org-id header" });
    }

    const headers = parsedHeaders.data;
    return await marketplaceService.listCatalog(headers["x-bizforge-org-id"]);
  });

  server.post("/api/marketplace/plugins/:name/install", async (request, reply) => {
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
    const outcome = await pluginLifecycleService.installPlugin(
      params.name,
      headers["x-bizforge-org-id"]
    );

    if (!outcome.ok) {
      return reply.code(outcome.error.httpStatus).send({
        error: outcome.error.message,
        code: outcome.error.code
      });
    }

    return reply.code(200).send({
      status: outcome.status,
      plugin: outcome.plugin
    });
  });

  server.post("/api/marketplace/plugins/:name/uninstall", async (request, reply) => {
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
    const outcome = await pluginLifecycleService.uninstallPlugin(
      params.name,
      headers["x-bizforge-org-id"]
    );

    if (!outcome.ok) {
      return reply.code(outcome.error.httpStatus).send({
        error: outcome.error.message,
        code: outcome.error.code
      });
    }

    return reply.code(200).send({
      status: outcome.status,
      plugin: outcome.plugin
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
    const outcome = await pluginLifecycleService.uninstallPlugin(
      params.name,
      headers["x-bizforge-org-id"]
    );

    if (!outcome.ok) {
      return reply.code(outcome.error.httpStatus).send({
        error: outcome.error.message,
        code: outcome.error.code
      });
    }

    return reply.code(200).send({
      status: outcome.status,
      plugin: outcome.plugin
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

    const parsedBody = automationRuleBodySchema.safeParse(request.body);

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

  server.get("/api/automation/rules/:id", async (request, reply) => {
    const parsedHeaders = orgHeaderSchema.safeParse(request.headers);
    if (!parsedHeaders.success) {
      return reply.code(400).send({ error: "Missing x-bizforge-org-id header" });
    }

    const parsedParams = automationRuleIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid automation rule id" });
    }

    const headers = parsedHeaders.data;
    const params = parsedParams.data;
    const rule = await runtime.automationEngine.getRule(params.id, headers["x-bizforge-org-id"]);

    if (!rule) {
      return reply.code(404).send({ error: "Automation rule not found", code: "rule_not_found" });
    }

    return rule;
  });

  server.patch("/api/automation/rules/:id", async (request, reply) => {
    const parsedHeaders = orgHeaderSchema.safeParse(request.headers);
    if (!parsedHeaders.success) {
      return reply.code(400).send({ error: "Missing x-bizforge-org-id header" });
    }

    const parsedParams = automationRuleIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid automation rule id" });
    }

    const parsedBody = automationRulePatchBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Invalid automation rule payload" });
    }

    const headers = parsedHeaders.data;
    const params = parsedParams.data;
    const body = parsedBody.data;
    const patch: Partial<{
      triggerEvent: string;
      conditions: Array<{ field: string; equals: unknown }>;
      actions: Array<{ plugin: string; actionKey: string; input: Record<string, unknown> }>;
      enabled: boolean;
    }> = {};

    if (body.triggerEvent !== undefined) {
      patch.triggerEvent = body.triggerEvent;
    }

    if (body.conditions !== undefined) {
      patch.conditions = body.conditions.map((condition) => ({
        field: condition.field,
        equals: condition.equals as unknown
      }));
    }

    if (body.actions !== undefined) {
      patch.actions = body.actions;
    }

    if (body.enabled !== undefined) {
      patch.enabled = body.enabled;
    }

    try {
      const updated = await runtime.automationEngine.updateRule(
        params.id,
        headers["x-bizforge-org-id"],
        patch
      );

      if (!updated) {
        return reply
          .code(404)
          .send({ error: "Automation rule not found", code: "rule_not_found" });
      }

      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid automation rule";
      return reply.code(400).send({ error: message });
    }
  });

  server.post("/api/automation/rules/:id/enable", async (request, reply) => {
    const parsedHeaders = orgHeaderSchema.safeParse(request.headers);
    if (!parsedHeaders.success) {
      return reply.code(400).send({ error: "Missing x-bizforge-org-id header" });
    }

    const parsedParams = automationRuleIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid automation rule id" });
    }

    const headers = parsedHeaders.data;
    const params = parsedParams.data;
    const updated = await runtime.automationEngine.setRuleEnabled(
      params.id,
      headers["x-bizforge-org-id"],
      true
    );

    if (!updated) {
      return reply.code(404).send({ error: "Automation rule not found", code: "rule_not_found" });
    }

    return updated;
  });

  server.post("/api/automation/rules/:id/disable", async (request, reply) => {
    const parsedHeaders = orgHeaderSchema.safeParse(request.headers);
    if (!parsedHeaders.success) {
      return reply.code(400).send({ error: "Missing x-bizforge-org-id header" });
    }

    const parsedParams = automationRuleIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid automation rule id" });
    }

    const headers = parsedHeaders.data;
    const params = parsedParams.data;
    const updated = await runtime.automationEngine.setRuleEnabled(
      params.id,
      headers["x-bizforge-org-id"],
      false
    );

    if (!updated) {
      return reply.code(404).send({ error: "Automation rule not found", code: "rule_not_found" });
    }

    return updated;
  });

  server.delete("/api/automation/rules/:id", async (request, reply) => {
    const parsedHeaders = orgHeaderSchema.safeParse(request.headers);
    if (!parsedHeaders.success) {
      return reply.code(400).send({ error: "Missing x-bizforge-org-id header" });
    }

    const parsedParams = automationRuleIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid automation rule id" });
    }

    const headers = parsedHeaders.data;
    const params = parsedParams.data;
    const deleted = await runtime.automationEngine.deleteRule(
      params.id,
      headers["x-bizforge-org-id"]
    );

    if (!deleted) {
      return reply.code(404).send({ error: "Automation rule not found", code: "rule_not_found" });
    }

    return reply.code(204).send();
  });

  server.post("/api/automation/rules/:id/simulate", async (request, reply) => {
    const parsedHeaders = orgHeaderSchema.safeParse(request.headers);
    if (!parsedHeaders.success) {
      return reply.code(400).send({ error: "Missing x-bizforge-org-id header" });
    }

    const parsedParams = automationRuleIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid automation rule id" });
    }

    const parsedBody = automationSimulationBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Invalid simulation payload" });
    }

    const headers = parsedHeaders.data;
    const params = parsedParams.data;
    const body = parsedBody.data;

    const result = await runtime.automationEngine.simulateRule(
      params.id,
      headers["x-bizforge-org-id"],
      body.samplePayload
    );

    if (!result) {
      return reply.code(404).send({ error: "Automation rule not found", code: "rule_not_found" });
    }

    return result;
  });
}
