import { randomUUID } from "node:crypto";
import { type Pool } from "pg";

export interface AutomationCondition {
  field: string;
  equals: unknown;
}

export interface AutomationAction {
  plugin: string;
  actionKey: string;
  input: Record<string, unknown>;
}

export interface AutomationRuleRecord {
  id: string;
  organizationId: string;
  triggerEvent: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  enabled: boolean;
}

export interface CreateAutomationRuleInput {
  organizationId: string;
  triggerEvent: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  enabled: boolean;
}

export interface AutomationRuleRepository {
  create(input: CreateAutomationRuleInput): Promise<AutomationRuleRecord>;
  listByOrganization(organizationId: string): Promise<AutomationRuleRecord[]>;
  listEnabledByTrigger(triggerEvent: string): Promise<AutomationRuleRecord[]>;
}

export class InMemoryAutomationRuleRepository implements AutomationRuleRepository {
  private readonly rules = new Map<string, AutomationRuleRecord>();

  async create(input: CreateAutomationRuleInput): Promise<AutomationRuleRecord> {
    const record: AutomationRuleRecord = {
      id: randomUUID(),
      ...input
    };
    this.rules.set(record.id, record);
    return record;
  }

  async listByOrganization(organizationId: string): Promise<AutomationRuleRecord[]> {
    return Array.from(this.rules.values()).filter(
      (rule) => rule.organizationId === organizationId
    );
  }

  async listEnabledByTrigger(triggerEvent: string): Promise<AutomationRuleRecord[]> {
    return Array.from(this.rules.values()).filter(
      (rule) => rule.enabled && rule.triggerEvent === triggerEvent
    );
  }
}

export class PostgresAutomationRuleRepository implements AutomationRuleRepository {
  constructor(private readonly pool: Pool) {}

  private static readonly rowColumns =
    "id, organization_id, trigger_event, conditions, actions, enabled";

  async create(input: CreateAutomationRuleInput): Promise<AutomationRuleRecord> {
    const id = randomUUID();

    await this.pool.query(
      `INSERT INTO automation_rules (id, organization_id, trigger_event, conditions, actions, enabled)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
      [
        id,
        input.organizationId,
        input.triggerEvent,
        JSON.stringify(input.conditions),
        JSON.stringify(input.actions),
        input.enabled
      ]
    );

    return {
      id,
      ...input
    };
  }

  async listByOrganization(organizationId: string): Promise<AutomationRuleRecord[]> {
    const result = await this.pool.query(
      `SELECT ${PostgresAutomationRuleRepository.rowColumns}
       FROM automation_rules
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [organizationId]
    );

    const rows = result.rows as Array<{
      id: string;
      organization_id: string;
      trigger_event: string;
      conditions: AutomationCondition[] | string;
      actions: AutomationAction[] | string;
      enabled: boolean;
    }>;

    return rows.map((row) => this.mapRow(row));
  }

  async listEnabledByTrigger(triggerEvent: string): Promise<AutomationRuleRecord[]> {
    const result = await this.pool.query(
      `SELECT ${PostgresAutomationRuleRepository.rowColumns}
       FROM automation_rules
       WHERE trigger_event = $1 AND enabled = true`,
      [triggerEvent]
    );

    const rows = result.rows as Array<{
      id: string;
      organization_id: string;
      trigger_event: string;
      conditions: AutomationCondition[] | string;
      actions: AutomationAction[] | string;
      enabled: boolean;
    }>;

    return rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: {
    id: string;
    organization_id: string;
    trigger_event: string;
    conditions: AutomationCondition[] | string;
    actions: AutomationAction[] | string;
    enabled: boolean;
  }): AutomationRuleRecord {
    return {
      id: row.id,
      organizationId: row.organization_id,
      triggerEvent: row.trigger_event,
      conditions:
        typeof row.conditions === "string"
          ? (JSON.parse(row.conditions) as AutomationCondition[])
          : row.conditions,
      actions:
        typeof row.actions === "string"
          ? (JSON.parse(row.actions) as AutomationAction[])
          : row.actions,
      enabled: row.enabled
    };
  }
}
