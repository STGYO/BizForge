import Fastify, { type FastifyInstance } from "fastify";
import { PluginEngine } from "./services/plugin-engine";
import { InMemoryEventBus } from "./services/event-bus";
import { AutomationEngine } from "./services/automation-engine";
import { registerCoreRoutes } from "./transport/core-routes";
import { registerPluginRoutes } from "./transport/plugin-routes";
import { checkPostgresHealth, getPgPool } from "./db/postgres";
import {
  InMemoryAutomationRuleRepository,
  PostgresAutomationRuleRepository,
  type AutomationRuleRepository
} from "./repositories/automation-rule-repository";

export interface BizForgeRuntime {
  pluginEngine: PluginEngine;
  eventBus: InMemoryEventBus;
  automationEngine: AutomationEngine;
  persistence: "in-memory" | "postgres";
}

export async function createServer(): Promise<FastifyInstance> {
  const server = Fastify({ logger: true });

  const eventBus = new InMemoryEventBus();
  const pluginEngine = new PluginEngine({
    pluginsDir: process.env.PLUGINS_DIR ?? "../../plugins"
  });
  const pgPool = getPgPool();
  const dbHealthy = await checkPostgresHealth();

  const automationRuleRepository: AutomationRuleRepository =
    pgPool && dbHealthy
      ? new PostgresAutomationRuleRepository(pgPool)
      : new InMemoryAutomationRuleRepository();

  const automationEngine = new AutomationEngine(
    eventBus,
    pluginEngine,
    automationRuleRepository
  );

  const runtime: BizForgeRuntime = {
    eventBus,
    pluginEngine,
    automationEngine,
    persistence: pgPool && dbHealthy ? "postgres" : "in-memory"
  };

  if (runtime.persistence === "in-memory") {
    server.log.warn(
      "DATABASE_URL not configured or database unavailable. Using in-memory automation persistence."
    );
  }

  await registerCoreRoutes(server, runtime);
  await pluginEngine.loadInstalledPlugins();
  await registerPluginRoutes(server, runtime);

  return server;
}
