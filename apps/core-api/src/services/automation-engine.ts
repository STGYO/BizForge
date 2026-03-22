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

export interface SimulationResult {
  matched: boolean;
  actionsTriggered: number;
  errors: string[];
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
    const triggerValidation = this.validateTriggerExists(input.triggerEvent);
    if (!triggerValidation.valid) {
      throw new Error(triggerValidation.error);
    }

    const conditionValidation = this.validateConditionFields(
      input.triggerEvent,
      input.conditions
    );
    if (!conditionValidation.valid) {
      throw new Error(conditionValidation.error);
    }

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

  async getRule(ruleId: string, organizationId: string): Promise<AutomationRule | null> {
    const record = await this.repository.getById(ruleId, organizationId);
    if (!record) {
      return null;
    }

    return this.toAutomationRule(record);
  }

  async updateRule(
    ruleId: string,
    organizationId: string,
    patch: Partial<Omit<AutomationRule, "id" | "organizationId">>
  ): Promise<AutomationRule | null> {
    const existing = await this.repository.getById(ruleId, organizationId);
    if (!existing) {
      return null;
    }

    const merged = {
      triggerEvent: patch.triggerEvent ?? existing.triggerEvent,
      conditions: patch.conditions ?? existing.conditions,
      actions: patch.actions ?? existing.actions,
      enabled: patch.enabled ?? existing.enabled
    };

    const triggerValidation = this.validateTriggerExists(merged.triggerEvent);
    if (!triggerValidation.valid) {
      throw new Error(triggerValidation.error);
    }

    const conditionValidation = this.validateConditionFields(
      merged.triggerEvent,
      merged.conditions
    );
    if (!conditionValidation.valid) {
      throw new Error(conditionValidation.error);
    }

    const actionValidation = this.validateRuleDefinition(merged.actions);
    if (!actionValidation.valid) {
      throw new Error(actionValidation.error);
    }

    const updated = await this.repository.update(ruleId, organizationId, merged);
    if (!updated) {
      return null;
    }

    return this.toAutomationRule(updated);
  }

  async setRuleEnabled(
    ruleId: string,
    organizationId: string,
    enabled: boolean
  ): Promise<AutomationRule | null> {
    const updated = await this.repository.setEnabled(ruleId, organizationId, enabled);
    if (!updated) {
      return null;
    }

    return this.toAutomationRule(updated);
  }

  async deleteRule(ruleId: string, organizationId: string): Promise<boolean> {
    return await this.repository.delete(ruleId, organizationId);
  }

  async simulateRule(
    ruleId: string,
    organizationId: string,
    samplePayload: Record<string, unknown>
  ): Promise<SimulationResult | null> {
    const record = await this.repository.getById(ruleId, organizationId);
    if (!record) {
      return null;
    }

    const conditionValidation = this.validateConditionFields(
      record.triggerEvent,
      record.conditions,
      samplePayload
    );
    if (!conditionValidation.valid) {
      return {
        matched: false,
        actionsTriggered: 0,
        errors: [conditionValidation.error]
      };
    }

    const actionValidation = this.validateRuleDefinition(record.actions);
    if (!actionValidation.valid) {
      return {
        matched: false,
        actionsTriggered: 0,
        errors: [actionValidation.error]
      };
    }

    const matched = record.conditions.every(
      (condition) => samplePayload[condition.field] === condition.equals
    );

    return {
      matched,
      actionsTriggered: matched ? record.actions.length : 0,
      errors: []
    };
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

  validateTriggerExists(triggerEvent: string): { valid: true } | { valid: false; error: string } {
    const builtInTriggers = new Set(["lead.generated", "customer.created"]);
    const catalogTriggers = new Set(this.listCatalog().triggers.map((trigger) => trigger.eventType));
    const knownTriggers = new Set([...builtInTriggers, ...catalogTriggers]);

    if (!knownTriggers.has(triggerEvent)) {
      return {
        valid: false,
        error: `Unknown trigger event: ${triggerEvent}`
      };
    }

    return { valid: true };
  }

  private validateConditionFields(
    triggerEvent: string,
    conditions: AutomationCondition[],
    samplePayload?: Record<string, unknown>
  ): { valid: true } | { valid: false; error: string } {
    const payloadKeys =
      samplePayload && typeof samplePayload === "object" ? Object.keys(samplePayload) : null;

    if (payloadKeys && payloadKeys.length > 0) {
      for (const condition of conditions) {
        if (!payloadKeys.includes(condition.field)) {
          return {
            valid: false,
            error: `Condition field ${condition.field} is not present in sample payload`
          };
        }
      }

      return { valid: true };
    }

    const coreFieldMap: Record<string, string[]> = {
      "lead.generated": ["source"],
      "customer.created": ["source"]
    };

    const knownFields = coreFieldMap[triggerEvent];
    if (!knownFields) {
      return { valid: true };
    }

    for (const condition of conditions) {
      if (!knownFields.includes(condition.field)) {
        return {
          valid: false,
          error: `Condition field ${condition.field} is not supported for trigger ${triggerEvent}`
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
      await this.publishActionFailure(event, "plugin_unavailable");
      return;
    }

    if (!plugin.manifest.permissions.includes("automation")) {
      await this.publishActionFailure(event, "plugin_missing_automation_permission");
      return;
    }

    const action = (plugin.registration.actions ?? []).find(
      (registeredAction) => registeredAction.key === payload.actionKey
    );
    if (!action) {
      await this.publishActionFailure(event, "action_not_registered");
      return;
    }

    const handlerName = action.handlerName ?? payload.actionKey;
    const handler = plugin.registration.handlers?.[handlerName];
    if (!handler) {
      await this.publishActionFailure(event, "handler_not_found");
      return;
    }

    if (!this.validateActionInputSchema(action.inputSchema, payload.input)) {
      await this.publishActionFailure(event, "action_input_validation_failed");
      return;
    }

    try {
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

      await this.eventBus.publish({
        eventId: randomUUID(),
        eventType: "automation.action.executed",
        occurredAt: new Date().toISOString(),
        organizationId: event.organizationId,
        sourcePlugin: "core.automation",
        schemaVersion: 1,
        correlationId: event.eventId,
        payload: {
          plugin: payload.plugin,
          actionKey: payload.actionKey,
          triggerEventId: payload.triggerEventId
        }
      });
    } catch {
      await this.publishActionFailure(event, "handler_execution_failed");
    }
  }

  private async publishActionFailure(event: EventEnvelope, reason: string): Promise<void> {
    const payload = event.payload as {
      plugin: string;
      actionKey: string;
      triggerEventId: string;
    };

    await this.eventBus.publish({
      eventId: randomUUID(),
      eventType: "automation.action.failed",
      occurredAt: new Date().toISOString(),
      organizationId: event.organizationId,
      sourcePlugin: "core.automation",
      schemaVersion: 1,
      correlationId: event.eventId,
      payload: {
        plugin: payload.plugin,
        actionKey: payload.actionKey,
        triggerEventId: payload.triggerEventId,
        reason
      }
    });
  }

  private validateActionInputSchema(
    schema: Record<string, unknown>,
    input: Record<string, unknown>
  ): boolean {
    if (Object.keys(schema).length === 0) {
      return true;
    }

    const schemaType = schema.type;
    if (schemaType !== "object") {
      return true;
    }

    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return false;
    }

    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (typeof key !== "string") {
        continue;
      }

      if (!(key in input)) {
        return false;
      }
    }

    const properties =
      schema.properties && typeof schema.properties === "object"
        ? (schema.properties as Record<string, unknown>)
        : {};

    for (const [propertyName, definition] of Object.entries(properties)) {
      if (!(propertyName in input)) {
        continue;
      }

      const propertyValue = input[propertyName];
      if (!this.matchesSchemaType(definition, propertyValue)) {
        return false;
      }
    }

    return true;
  }

  private matchesSchemaType(definition: unknown, value: unknown): boolean {
    if (!definition || typeof definition !== "object") {
      return true;
    }

    const expectedType = (definition as { type?: unknown }).type;
    if (typeof expectedType !== "string") {
      return true;
    }

    switch (expectedType as string) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "boolean":
        return typeof value === "boolean";
      case "object":
        return typeof value === "object" && value !== null && !Array.isArray(value);
      case "array":
        return Array.isArray(value);
      default:
        return true;
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
