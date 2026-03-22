import { randomUUID } from "node:crypto";
import type { PluginQueryResult, PluginDatabaseClient } from "@bizforge/plugin-sdk";

export interface AutomationExecutionAuditRecord {
  id: string;
  ruleId: string;
  organizationId: string;
  triggerEvent: string;
  triggerEventId?: string;
  matched: boolean;
  actionsTriggered: number;
  conditionsSummary?: Record<string, unknown>;
  actionsExecuted: Record<string, unknown>[];
  errors: string[];
  status: "pending" | "success" | "partial_failure" | "failed";
  retryCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationDeadLetterRecord {
  id: string;
  ruleId: string;
  organizationId: string;
  originalEvent: Record<string, unknown>;
  actionConfig: Record<string, unknown>;
  failureReason: string;
  retryAttempts: number;
  createdAt: string;
}

export class AutomationAuditRepository {
  constructor(private readonly db: PluginDatabaseClient | undefined) {}

  async logExecution(
    ruleId: string,
    organizationId: string,
    audit: Omit<AutomationExecutionAuditRecord, "id" | "ruleId" | "organizationId" | "createdAt" | "updatedAt">
  ): Promise<AutomationExecutionAuditRecord | null> {
    if (!this.db?.isAvailable) {
      return null;
    }

    try {
      const result = await this.db.query<AutomationExecutionAuditRecord>(
        `INSERT INTO automation_execution_audit 
         (rule_id, organization_id, trigger_event, trigger_event_id, matched, 
          actions_triggered, conditions_summary, actions_executed, errors, status, retry_count, last_error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id, rule_id as "ruleId", organization_id as "organizationId", 
                   trigger_event as "triggerEvent", trigger_event_id as "triggerEventId",
                   matched, actions_triggered as "actionsTriggered", 
                   conditions_summary as "conditionsSummary", actions_executed as "actionsExecuted",
                   errors, status, retry_count as "retryCount", last_error as "lastError",
                   created_at as "createdAt", updated_at as "updatedAt"`,
        [
          ruleId,
          organizationId,
          audit.triggerEvent,
          audit.triggerEventId ?? null,
          audit.matched,
          audit.actionsTriggered,
          audit.conditionsSummary ? JSON.stringify(audit.conditionsSummary) : null,
          JSON.stringify(audit.actionsExecuted),
          audit.errors,
          audit.status,
          audit.retryCount,
          audit.lastError ?? null
        ]
      );

      return result.rows[0] ?? null;
    } catch (error) {
      console.error("Failed to log automation execution:", error);
      return null;
    }
  }

  async updateExecutionStatus(
    auditId: string,
    organizationId: string,
    patch: Partial<Pick<AutomationExecutionAuditRecord, "status" | "retryCount" | "lastError" | "errors">>
  ): Promise<AutomationExecutionAuditRecord | null> {
    if (!this.db?.isAvailable) {
      return null;
    }

    try {
      const setClauses: string[] = ["updated_at = NOW()"];
      const params: unknown[] = [auditId, organizationId];
      let paramIndex = 3;

      if (patch.status !== undefined) {
        setClauses.push(`status = $${paramIndex}`);
        params.push(patch.status);
        paramIndex++;
      }
      if (patch.retryCount !== undefined) {
        setClauses.push(`retry_count = $${paramIndex}`);
        params.push(patch.retryCount);
        paramIndex++;
      }
      if (patch.lastError !== undefined) {
        setClauses.push(`last_error = $${paramIndex}`);
        params.push(patch.lastError);
        paramIndex++;
      }
      if (patch.errors !== undefined) {
        setClauses.push(`errors = $${paramIndex}`);
        params.push(patch.errors);
        paramIndex++;
      }

      const result = await this.db.query<AutomationExecutionAuditRecord>(
        `UPDATE automation_execution_audit
         SET ${setClauses.join(", ")}
         WHERE id = $1 AND organization_id = $2
         RETURNING id, rule_id as "ruleId", organization_id as "organizationId",
                   trigger_event as "triggerEvent", trigger_event_id as "triggerEventId",
                   matched, actions_triggered as "actionsTriggered",
                   conditions_summary as "conditionsSummary", actions_executed as "actionsExecuted",
                   errors, status, retry_count as "retryCount", last_error as "lastError",
                   created_at as "createdAt", updated_at as "updatedAt"`,
        params
      );

      return result.rows[0] ?? null;
    } catch (error) {
      console.error("Failed to update automation execution audit:", error);
      return null;
    }
  }

  async listRecentExecutions(
    ruleId: string,
    organizationId: string,
    limit: number = 10
  ): Promise<AutomationExecutionAuditRecord[]> {
    if (!this.db?.isAvailable) {
      return [];
    }

    try {
      const result = await this.db.query<AutomationExecutionAuditRecord>(
        `SELECT id, rule_id as "ruleId", organization_id as "organizationId",
                trigger_event as "triggerEvent", trigger_event_id as "triggerEventId",
                matched, actions_triggered as "actionsTriggered",
                conditions_summary as "conditionsSummary", actions_executed as "actionsExecuted",
                errors, status, retry_count as "retryCount", last_error as "lastError",
                created_at as "createdAt", updated_at as "updatedAt"
         FROM automation_execution_audit
         WHERE rule_id = $1 AND organization_id = $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [ruleId, organizationId, limit]
      );

      return result.rows;
    } catch (error) {
      console.error("Failed to list execution audits:", error);
      return [];
    }
  }

  async addToDeadLetter(
    ruleId: string,
    organizationId: string,
    deadLetter: Omit<AutomationDeadLetterRecord, "id" | "createdAt">
  ): Promise<AutomationDeadLetterRecord | null> {
    if (!this.db?.isAvailable) {
      return null;
    }

    try {
      const result = await this.db.query<AutomationDeadLetterRecord>(
        `INSERT INTO automation_dead_letter 
         (rule_id, organization_id, original_event, action_config, failure_reason, retry_attempts)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, rule_id as "ruleId", organization_id as "organizationId",
                   original_event as "originalEvent", action_config as "actionConfig",
                   failure_reason as "failureReason", retry_attempts as "retryAttempts",
                   created_at as "createdAt"`,
        [
          ruleId,
          organizationId,
          JSON.stringify(deadLetter.originalEvent),
          JSON.stringify(deadLetter.actionConfig),
          deadLetter.failureReason,
          deadLetter.retryAttempts
        ]
      );

      return result.rows[0] ?? null;
    } catch (error) {
      console.error("Failed to add to dead-letter queue:", error);
      return null;
    }
  }

  async listDeadLetters(organizationId: string, limit: number = 50): Promise<AutomationDeadLetterRecord[]> {
    if (!this.db?.isAvailable) {
      return [];
    }

    try {
      const result = await this.db.query<AutomationDeadLetterRecord>(
        `SELECT id, rule_id as "ruleId", organization_id as "organizationId",
                original_event as "originalEvent", action_config as "actionConfig",
                failure_reason as "failureReason", retry_attempts as "retryAttempts",
                created_at as "createdAt"
         FROM automation_dead_letter
         WHERE organization_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [organizationId, limit]
      );

      return result.rows;
    } catch (error) {
      console.error("Failed to list dead-letter entries:", error);
      return [];
    }
  }

  async addToDeadLetterDirect(
    deadLetter: {
      organizationId: string;
      originalEvent: unknown;
      failureReason: string;
      retryAttempts: number;
    }
  ): Promise<string | null> {
    if (!this.db?.isAvailable) {
      return null;
    }

    try {
      const deadLetterId = randomUUID();
      const result = await this.db.query<{ id: string }>(
        `INSERT INTO automation_dead_letter 
         (id, organization_id, original_event, action_config, failure_reason, retry_attempts)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          deadLetterId,
          deadLetter.organizationId,
          JSON.stringify(deadLetter.originalEvent),
          JSON.stringify({}),
          deadLetter.failureReason,
          deadLetter.retryAttempts
        ]
      );

      return result.rows[0]?.id ?? null;
    } catch (error) {
      console.error("Failed to add to dead-letter queue:", error);
      return null;
    }
  }

  async removeFromDeadLetter(deadLetterId: string, organizationId: string): Promise<boolean> {
    if (!this.db?.isAvailable) {
      return false;
    }

    try {
      const result = await this.db.query(
        `DELETE FROM automation_dead_letter
         WHERE id = $1 AND organization_id = $2`,
        [deadLetterId, organizationId]
      );

      return (result as any).rowCount > 0;
    } catch (error) {
      console.error("Failed to remove from dead-letter queue:", error);
      return false;
    }
  }
}
