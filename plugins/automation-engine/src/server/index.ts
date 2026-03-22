import type {
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

const listRecords: PluginHandler = async () => {
  return {
    plugin: typedManifest.name,
    records: []
  };
};

const createRecord: PluginHandler = async ({ body }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const record = {
    id: `${typedManifest.name.replace(/-/g, "_")}-${Date.now()}`, 
    title: String(payload.title ?? "Automation Engine Record"),
    createdAt: new Date().toISOString()
  };

  await context.eventBus.publish({
    eventId: `evt-${typedManifest.name}-${Date.now()}`, 
    eventType: "automation.execution.completed",
    occurredAt: new Date().toISOString(),
    organizationId: String(payload.organizationId ?? "org-1"),
    sourcePlugin: typedManifest.name,
    schemaVersion: 1,
    payload: {
      recordId: record.id,
      title: record.title
    }
  });

  return {
    created: true,
    record
  };
};

const pluginAction: PluginHandler = async ({ actionInput }) => {
  return {
    ok: true,
    plugin: typedManifest.name,
    action: "retry_automation_execution",
    input: actionInput ?? {}
  };
};

export const pluginRegistration: PluginRegistration = {
  manifest: typedManifest,
  handlers: {
    listRecords,
    createRecord,
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
    }
  ],
  triggers: [
    {
      key: "automation_execution_completed",
      displayName: "Automation Engine Updated",
      eventType: "automation.execution.completed"
    }
  ],
  actions: [
    {
      key: "retry_automation_execution",
      displayName: "Automation Engine Action",
      handlerName: "pluginAction",
      inputSchema: {
        type: "object",
        properties: {
          entityId: { type: "string" },
          note: { type: "string" }
        },
        required: ["entityId"]
      }
    }
  ]
};




