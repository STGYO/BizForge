import type {
  EventEnvelope,
  PluginManifest,
  PluginPermission,
  PluginRegistration,
  PluginHandler
} from "@bizforge/plugin-sdk";
import manifest from "../../plugin.json" assert { type: "json" };

const typedManifest = {
  ...manifest,
  permissions: manifest.permissions as PluginPermission[]
} as PluginManifest;

type MessageChannel = "email" | "sms" | "in_app";
type DeliveryStatus = "queued" | "sent" | "failed";

interface MessageTemplate {
  id: string;
  key: string;
  name: string;
  channel: MessageChannel;
  subject: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

interface DeliveryRecord {
  id: string;
  recipient: string;
  channel: MessageChannel;
  subject: string;
  body: string;
  status: DeliveryStatus;
  templateId?: string | undefined;
  createdAt: string;
  sentAt?: string | undefined;
  failedAt?: string | undefined;
  failureReason?: string | undefined;
}

const templatesById = new Map<string, MessageTemplate>();
const templatesByKey = new Map<string, MessageTemplate>();
const deliveries: DeliveryRecord[] = [];

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrganizationId(payload: Record<string, unknown>): string {
  return String(payload.organizationId ?? "org-1");
}

function normalizeChannel(value: unknown): MessageChannel {
  const candidate = String(value ?? "email").toLowerCase();
  if (candidate === "sms" || candidate === "in_app") {
    return candidate;
  }

  return "email";
}

function interpolateTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, key: string) => {
    const value = variables[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function publishEvent(
  type: string,
  payload: Record<string, unknown>,
  organizationId: string,
  occurredAt: string,
  sourcePlugin: string
): EventEnvelope<Record<string, unknown>> {
  return {
    eventId: makeId("evt"),
    eventType: type,
    occurredAt,
    organizationId,
    sourcePlugin,
    schemaVersion: 1,
    payload
  };
}

type SendMessageInput = {
  templateId?: string;
  templateKey?: string;
  recipient?: string;
  channel?: unknown;
  subject?: unknown;
  body?: unknown;
  variables?: Record<string, unknown>;
  simulateFailure?: unknown;
  organizationId?: unknown;
};

async function dispatchMessage(
  input: SendMessageInput,
  context: Parameters<PluginHandler>[1]
): Promise<{ ok: boolean; delivery?: DeliveryRecord; error?: string }> {
  const template =
    (input.templateId ? templatesById.get(String(input.templateId)) : undefined) ??
    (input.templateKey ? templatesByKey.get(String(input.templateKey)) : undefined);

  if (!input.recipient) {
    return {
      ok: false,
      error: "recipient is required"
    };
  }

  const variables = (input.variables ?? {}) as Record<string, unknown>;
  const channel = template?.channel ?? normalizeChannel(input.channel);
  const subjectTemplate = String(input.subject ?? template?.subject ?? "");
  const bodyTemplate = String(input.body ?? template?.body ?? "");
  const subject = interpolateTemplate(subjectTemplate, variables);
  const body = interpolateTemplate(bodyTemplate, variables);

  if (body.length === 0) {
    return {
      ok: false,
      error: "message body is required"
    };
  }

  const now = new Date().toISOString();
  const organizationId = getOrganizationId(input as Record<string, unknown>);
  const failed = Boolean(input.simulateFailure);
  const delivery: DeliveryRecord = {
    id: makeId("msg"),
    recipient: String(input.recipient),
    channel,
    subject,
    body,
    status: failed ? "failed" : "sent",
    templateId: template?.id,
    createdAt: now,
    sentAt: failed ? undefined : now,
    failedAt: failed ? now : undefined,
    failureReason: failed ? "Simulated provider failure" : undefined
  };

  deliveries.unshift(delivery);

  await context.eventBus.publish(
    publishEvent(
      "message.delivery.updated",
      {
        messageId: delivery.id,
        templateId: delivery.templateId,
        status: delivery.status,
        recipient: delivery.recipient,
        channel: delivery.channel
      },
      organizationId,
      now,
      typedManifest.name
    )
  );

  if (!failed) {
    await context.eventBus.publish(
      publishEvent(
        "message.sent",
        {
          messageId: delivery.id,
          recipient: delivery.recipient,
          channel: delivery.channel,
          templateId: delivery.templateId
        },
        organizationId,
        now,
        typedManifest.name
      )
    );
  }

  if (failed) {
    return {
      ok: false,
      delivery,
      error: "message delivery failed"
    };
  }

  return {
    ok: true,
    delivery
  };
}

const listRecords: PluginHandler = async () => {
  return {
    plugin: typedManifest.name,
    templates: Array.from(templatesById.values()),
    deliveries: deliveries.slice(0, 100)
  };
};

const createRecord: PluginHandler = async ({ body }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const template: MessageTemplate = {
    id: makeId("tpl"),
    key: String(payload.key ?? makeId("template")),
    name: String(payload.name ?? payload.title ?? "Untitled Template"),
    channel: normalizeChannel(payload.channel),
    subject: String(payload.subject ?? ""),
    body: String(payload.body ?? ""),
    createdAt: now,
    updatedAt: now
  };

  if (template.body.length === 0) {
    return {
      created: false,
      error: "Template body is required"
    };
  }

  templatesById.set(template.id, template);
  templatesByKey.set(template.key, template);

  await context.eventBus.publish({
    eventId: makeId("evt"),
    eventType: "message.template.created",
    occurredAt: now,
    organizationId: String(payload.organizationId ?? "org-1"),
    sourcePlugin: typedManifest.name,
    schemaVersion: 1,
    payload: {
      templateId: template.id,
      key: template.key,
      channel: template.channel
    }
  });

  return {
    created: true,
    template
  };
};

const getTemplate: PluginHandler = async ({ params }) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const templateId = String(routeParams.id ?? "");
  const template = templatesById.get(templateId);

  if (!template) {
    return {
      found: false,
      error: "Template not found"
    };
  }

  return {
    found: true,
    template
  };
};

const sendMessage: PluginHandler = async ({ body }, context) => {
  const payload = (body ?? {}) as SendMessageInput;
  return dispatchMessage(payload, context);
};

const pluginAction: PluginHandler = async ({ actionInput }, context) => {
  const payload = (actionInput ?? {}) as SendMessageInput;
  const result = await dispatchMessage(payload, context);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error ?? "message delivery failed"
    };
  }

  return {
    ok: true,
    plugin: typedManifest.name,
    action: "send_templated_message",
    delivery: result.delivery
  };
};

export const pluginRegistration: PluginRegistration = {
  manifest: typedManifest,
  handlers: {
    listRecords,
    createRecord,
    getTemplate,
    sendMessage,
    pluginAction
  },
  routes: [
    {
      method: "GET",
      path: "/records",
      handlerName: "listRecords"
    },
    {
      method: "POST",
      path: "/records",
      handlerName: "createRecord"
    },
    {
      method: "GET",
      path: "/templates/:id",
      handlerName: "getTemplate"
    },
    {
      method: "POST",
      path: "/messages/send",
      handlerName: "sendMessage"
    }
  ],
  triggers: [
    {
      key: "message_template_created",
      displayName: "Message Template Created",
      eventType: "message.template.created"
    },
    {
      key: "message_delivery_updated",
      displayName: "Messaging Notifications Updated",
      eventType: "message.delivery.updated"
    },
    {
      key: "message_sent",
      displayName: "Message Sent",
      eventType: "message.sent"
    }
  ],
  actions: [
    {
      key: "send_templated_message",
      displayName: "Messaging Notifications Action",
      handlerName: "pluginAction",
      inputSchema: {
        type: "object",
        properties: {
          templateId: { type: "string" },
          templateKey: { type: "string" },
          recipient: { type: "string" },
          channel: { type: "string", enum: ["email", "sms", "in_app"] },
          subject: { type: "string" },
          body: { type: "string" },
          variables: {
            type: "object",
            additionalProperties: true
          }
        },
        required: ["recipient"],
        anyOf: [
          { required: ["templateId"] },
          { required: ["templateKey"] },
          { required: ["body"] }
        ]
      }
    }
  ]
};




