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
  permissions: PluginPermission[];
  activationEvents: string[];
  backendEntry: string;
  frontendEntry: string;
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

export interface PluginRuntimeContext {
  eventBus: PluginEventBus;
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

export interface PluginRegistration {
  manifest: PluginManifest;
  routes?: PluginRouteDefinition[];
  triggers?: AutomationTriggerDefinition[];
  actions?: AutomationActionDefinition[];
  handlers?: Record<string, PluginHandler>;
}
