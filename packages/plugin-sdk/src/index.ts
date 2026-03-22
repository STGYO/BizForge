export type PluginPermission =
  | "contacts"
  | "calendar"
  | "messages"
  | "payments"
  | "automation"
  | "analytics"
  | "documents";

export interface PluginManifest {
  name: string;
  version: string;
  author: string;
  description?: string;
  core?: boolean;
  preinstalled?: boolean;
  category?: "core" | "operations" | "extension";
  dependsOn?: string[];
  permissions: PluginPermission[];
  activationEvents: string[];
  backendEntry: string;
  frontendEntry: string;
  ui?: {
    slots?: Record<string, {
      displayName: string;
      layout?: "panel" | "card" | "modal" | "sidebar";
      componentRequired?: boolean;
    }>;
    entry?: string;
    exposedComponents?: string[];
  };
}

export interface EventEnvelope<TPayload = unknown> {
  eventId: string;
  eventType: string;
  occurredAt: string;
  organizationId: string;
  sourcePlugin?: string;
  correlationId?: string;
  schemaVersion: number;
  payload: TPayload;
}

export interface PluginEventBus {
  publish<TPayload>(event: EventEnvelope<TPayload>): Promise<void>;
  subscribe(eventType: string, handler: (event: EventEnvelope) => Promise<void>): () => void;
}

export interface PluginQueryResult<TRow = Record<string, unknown>> {
  rows: TRow[];
  rowCount: number;
}

export interface PluginDatabaseClient {
  readonly mode: "postgres" | "in-memory";
  readonly isAvailable: boolean;
  query<TRow = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<PluginQueryResult<TRow>>;
}

export interface PluginEventWriteInput {
  eventType: string;
  organizationId: string;
  sourcePlugin: string;
  payload: unknown;
  correlationId?: string;
}

export interface PluginPersistenceHelper {
  readonly mode: "postgres" | "in-memory";
  readonly isDatabaseAvailable: boolean;
  createId(prefix?: string): string;
  withOrganizationParams(organizationId: string, params?: unknown[]): unknown[];
  queryByOrganization<TRow = Record<string, unknown>>(
    text: string,
    organizationId: string,
    params?: unknown[]
  ): Promise<PluginQueryResult<TRow>>;
  writeEvent(input: PluginEventWriteInput): Promise<EventEnvelope>;
}

export interface PluginRuntimeContext {
  eventBus: PluginEventBus;
  db?: PluginDatabaseClient;
  persistence?: PluginPersistenceHelper;
}

export type PluginHandler = (
  input: {
    body: unknown;
    query: unknown;
    params: unknown;
    headers: unknown;
    rawEvent?: EventEnvelope;
    actionInput?: Record<string, unknown>;
  },
  context: PluginRuntimeContext
) => Promise<unknown>;

export interface PluginRouteDefinition {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  handlerName: string;
}

export interface AutomationTriggerDefinition {
  key: string;
  displayName: string;
  eventType: string;
}

export interface AutomationActionDefinition {
  key: string;
  displayName: string;
  handlerName?: string;
  inputSchema: Record<string, unknown>;
}

export interface PluginUISlotDescriptor {
  pluginName: string;
  slotName: string;
  displayName: string;
  layout: "panel" | "card" | "modal" | "sidebar";
  componentRequired: boolean;
}

export interface PluginUIComponentManifest {
  pluginName: string;
  componentNames: string[];
  slots: PluginUISlotDescriptor[];
  componentUrl: string;
  integrity?: string;
}

export interface PluginSandboxMessage {
  type: "request" | "response" | "event";
  id?: string;
  channel: string;
  payload: unknown;
  error?: { message: string; code: string };
}

export interface PluginRegistration {
  manifest: PluginManifest;
  routes?: PluginRouteDefinition[];
  triggers?: AutomationTriggerDefinition[];
  actions?: AutomationActionDefinition[];
  handlers?: Record<string, PluginHandler>;
  uiComponents?: PluginUIComponentManifest;
}
