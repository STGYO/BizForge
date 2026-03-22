import { randomUUID } from "node:crypto";
import type {
  EventEnvelope,
  PluginDatabaseClient,
  PluginEventBus,
  PluginEventWriteInput,
  PluginPersistenceHelper,
  PluginQueryResult
} from "@bizforge/plugin-sdk";

class DefaultPluginPersistenceHelper implements PluginPersistenceHelper {
  readonly mode: "postgres" | "in-memory";
  readonly isDatabaseAvailable: boolean;

  constructor(
    private readonly eventBus: PluginEventBus,
    private readonly db: PluginDatabaseClient
  ) {
    this.mode = db.mode;
    this.isDatabaseAvailable = db.isAvailable;
  }

  createId(prefix = "plg"): string {
    return `${prefix}_${randomUUID()}`;
  }

  withOrganizationParams(organizationId: string, params: unknown[] = []): unknown[] {
    return [organizationId, ...params];
  }

  async queryByOrganization<TRow = Record<string, unknown>>(
    text: string,
    organizationId: string,
    params: unknown[] = []
  ): Promise<PluginQueryResult<TRow>> {
    if (!this.db.isAvailable) {
      throw new Error("Plugin database is not available for organization-scoped queries");
    }

    return await this.db.query<TRow>(text, this.withOrganizationParams(organizationId, params));
  }

  async writeEvent(input: PluginEventWriteInput): Promise<EventEnvelope> {
    const event: EventEnvelope = {
      eventId: randomUUID(),
      eventType: input.eventType,
      occurredAt: new Date().toISOString(),
      organizationId: input.organizationId,
      sourcePlugin: input.sourcePlugin,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      schemaVersion: 1,
      payload: input.payload
    };

    await this.eventBus.publish(event);
    return event;
  }
}

export function createPluginPersistenceHelper(
  eventBus: PluginEventBus,
  db: PluginDatabaseClient
): PluginPersistenceHelper {
  return new DefaultPluginPersistenceHelper(eventBus, db);
}
