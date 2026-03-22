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
    title: String(payload.title ?? "Task Workflow Manager Record"),
    createdAt: new Date().toISOString()
  };

  await context.eventBus.publish({
    eventId: `evt-${typedManifest.name}-${Date.now()}`, 
    eventType: "task.workflow.progressed",
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
    action: "create_follow_up_task",
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
      key: "task_workflow_progressed",
      displayName: "Task Workflow Manager Updated",
      eventType: "task.workflow.progressed"
    }
  ],
  actions: [
    {
      key: "create_follow_up_task",
      displayName: "Task Workflow Manager Action",
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




