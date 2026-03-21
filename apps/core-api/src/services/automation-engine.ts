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
  }

  async createRule(input: Omit<AutomationRule, "id">): Promise<AutomationRule> {
    const created = await this.repository.create(input);
    return this.toAutomationRule(created);
  }

  async listRules(organizationId: string): Promise<AutomationRule[]> {
    const records = await this.repository.listByOrganization(organizationId);
    return records.map((record) => this.toAutomationRule(record));
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
