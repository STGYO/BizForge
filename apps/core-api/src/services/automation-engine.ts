import { randomUUID } from "node:crypto";
import type { EventEnvelope } from "@bizforge/plugin-sdk";
import { InMemoryEventBus } from "./event-bus";
import { PluginEngine } from "./plugin-engine";
import {
  type AutomationRuleRepository,
  type AutomationAction,
  type AutomationCondition,
  type AutomationRuleRecord
} from "../repositories/automation-rule-repository";

export interface AutomationTriggerCatalogItem {
  plugin: string;
  key: string;
  displayName: string;
  eventType: string;
}

export interface AutomationActionCatalogItem {
  plugin: string;
  key: string;
  displayName: string;
  inputSchema: Record<string, unknown>;
}

export interface AutomationRule {
  id: string;
  organizationId: string;
  triggerEvent: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  enabled: boolean;
}

export class AutomationEngine {
  constructor(
    private readonly eventBus: InMemoryEventBus,
    private readonly pluginEngine: PluginEngine,
    private readonly repository: AutomationRuleRepository
  ) {}

  initialize(): void {
    this.eventBus.subscribe("lead.generated", async (event) => this.executeForEvent(event));
    this.eventBus.subscribe("customer.created", async (event) => this.executeForEvent(event));
    this.eventBus.subscribe("automation.action.requested", async (event) =>
      this.executeRequestedAction(event)
    );
  }

  async createRule(input: Omit<AutomationRule, "id">): Promise<AutomationRule> {
    const validation = this.validateRuleDefinition(input.actions);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const created = await this.repository.create(input);
    return this.toAutomationRule(created);
  }

  async listRules(organizationId: string): Promise<AutomationRule[]> {
    const records = await this.repository.listByOrganization(organizationId);
    return records.map((record) => this.toAutomationRule(record));
  }

  listCatalog(): {
    triggers: AutomationTriggerCatalogItem[];
    actions: AutomationActionCatalogItem[];
  } {
    const enabledPlugins = this.pluginEngine
      .list()
      .filter((plugin) => plugin.status === "enabled");

    const triggers = enabledPlugins.flatMap((plugin) =>
      (plugin.registration.triggers ?? []).map((trigger) => ({
        plugin: plugin.manifest.name,
        key: trigger.key,
        displayName: trigger.displayName,
        eventType: trigger.eventType
      }))
    );

    const actions = enabledPlugins.flatMap((plugin) =>
      (plugin.registration.actions ?? []).map((action) => ({
        plugin: plugin.manifest.name,
        key: action.key,
        displayName: action.displayName,
        inputSchema: action.inputSchema
      }))
    );

    return { triggers, actions };
  }

  validateRuleDefinition(actions: AutomationAction[]):
    | { valid: true }
    | { valid: false; error: string } {
    for (const action of actions) {
      const plugin = this.pluginEngine.list().find((item) => item.manifest.name === action.plugin);
      if (!plugin) {
        return { valid: false, error: `Unknown plugin: ${action.plugin}` };
      }

      if (!plugin.manifest.permissions.includes("automation")) {
        return {
          valid: false,
          error: `Plugin ${action.plugin} is missing automation permission`
        };
      }

      const hasAction = (plugin.registration.actions ?? []).some(
        (pluginAction) => pluginAction.key === action.actionKey
      );
      if (!hasAction) {
        return {
          valid: false,
          error: `Action ${action.actionKey} is not registered by plugin ${action.plugin}`
        };
      }
    }

    return { valid: true };
  }

  private async executeForEvent(event: EventEnvelope): Promise<void> {
    const rules = await this.repository.listEnabledByTrigger(event.eventType);

    for (const rule of rules) {
      const matches = rule.conditions.every(
        (condition) =>
          (event.payload as Record<string, unknown>)[condition.field] === condition.equals
      );
      if (!matches) {
        continue;
      }

      for (const action of rule.actions) {
        const plugin = this.pluginEngine.list().find((item) => item.manifest.name === action.plugin);
        if (!plugin || plugin.status !== "enabled") {
          continue;
        }

        await this.eventBus.publish({
          eventId: randomUUID(),
          eventType: "automation.action.requested",
          occurredAt: new Date().toISOString(),
          organizationId: rule.organizationId,
          sourcePlugin: "core.automation",
          schemaVersion: 1,
          payload: {
            plugin: action.plugin,
            actionKey: action.actionKey,
            input: action.input,
            triggerEventId: event.eventId
          }
        });
      }
    }
  }

  private async executeRequestedAction(event: EventEnvelope): Promise<void> {
    const payload = event.payload as {
      plugin: string;
      actionKey: string;
      input: Record<string, unknown>;
      triggerEventId: string;
    };

    const plugin = this.pluginEngine.list().find((item) => item.manifest.name === payload.plugin);
    if (!plugin || plugin.status !== "enabled") {
      return;
    }

    if (!plugin.manifest.permissions.includes("automation")) {
      return;
    }

    const action = (plugin.registration.actions ?? []).find(
      (registeredAction) => registeredAction.key === payload.actionKey
    );
    if (!action) {
      return;
    }

    const handlerName = action.handlerName ?? payload.actionKey;
    const handler = plugin.registration.handlers?.[handlerName];
    if (!handler) {
      return;
    }

    await handler(
      {
        body: undefined,
        query: undefined,
        params: undefined,
        headers: undefined,
        rawEvent: event,
        actionInput: payload.input
      },
      { eventBus: this.eventBus }
    );
  }

  private toAutomationRule(record: AutomationRuleRecord): AutomationRule {
    return {
      id: record.id,
      organizationId: record.organizationId,
      triggerEvent: record.triggerEvent,
      conditions: record.conditions,
      actions: record.actions,
      enabled: record.enabled
    };
  }
}
