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

type PluginState = "enabled" | "disabled";

interface ManagedPluginRecord {
  id: string;
  name: string;
  version: string;
  state: PluginState;
  dependsOn: string[];
  updatedAt: string;
  createdAt: string;
}

interface LifecycleLogEntry {
  id: string;
  pluginId: string;
  fromState: PluginState;
  toState: PluginState;
  reason: string;
  changedAt: string;
}

const managedPlugins = new Map<string, ManagedPluginRecord>();
const lifecycleLog: LifecycleLogEntry[] = [];

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrganizationId(payload: Record<string, unknown>): string {
  return String(payload.organizationId ?? "org-1");
}

function findBlockingDependents(targetId: string): string[] {
  const blockers: string[] = [];
  for (const plugin of managedPlugins.values()) {
    if (plugin.id !== targetId && plugin.state === "enabled" && plugin.dependsOn.includes(targetId)) {
      blockers.push(plugin.id);
    }
  }

  return blockers;
}

function appendLifecycleEntry(entry: LifecycleLogEntry): void {
  lifecycleLog.unshift(entry);
  if (lifecycleLog.length > 100) {
    lifecycleLog.pop();
  }
}

const listRecords: PluginHandler = async () => {
  return {
    plugin: typedManifest.name,
    plugins: Array.from(managedPlugins.values()),
    lifecycle: lifecycleLog
  };
};

const createRecord: PluginHandler = async ({ body }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const pluginRecord: ManagedPluginRecord = {
    id: String(payload.pluginId ?? payload.id ?? makeId("plugin")),
    name: String(payload.name ?? "Unnamed Plugin"),
    version: String(payload.version ?? "1.0.0"),
    state: payload.state === "disabled" ? "disabled" : "enabled",
    dependsOn: Array.isArray(payload.dependsOn)
      ? payload.dependsOn.map((entry) => String(entry)).filter((entry) => entry.length > 0)
      : [],
    createdAt: now,
    updatedAt: now
  };
  managedPlugins.set(pluginRecord.id, pluginRecord);

  await context.eventBus.publish({
    eventId: makeId("evt"),
    eventType: "plugin.lifecycle.changed",
    occurredAt: now,
    organizationId: getOrganizationId(payload),
    sourcePlugin: typedManifest.name,
    schemaVersion: 1,
    payload: {
      pluginId: pluginRecord.id,
      state: pluginRecord.state,
      reason: "registered"
    }
  });

  return {
    created: true,
    pluginRecord
  };
};

const updatePluginState: PluginHandler = async ({ params, body }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = (body ?? {}) as Record<string, unknown>;
  const pluginId = String(routeParams.id ?? payload.pluginId ?? "");
  const current = managedPlugins.get(pluginId);

  if (!current) {
    return {
      ok: false,
      error: "Plugin not found"
    };
  }

  const nextState: PluginState = payload.state === "disabled" ? "disabled" : "enabled";
  const blockers = nextState === "disabled" ? findBlockingDependents(pluginId) : [];
  const force = payload.force === true;

  if (blockers.length > 0 && !force) {
    return {
      ok: false,
      error: "Cannot disable plugin with active dependents",
      blockers
    };
  }

  const now = new Date().toISOString();
  const nextRecord: ManagedPluginRecord = {
    ...current,
    state: nextState,
    updatedAt: now
  };
  managedPlugins.set(pluginId, nextRecord);

  const lifecycleEntry: LifecycleLogEntry = {
    id: makeId("life"),
    pluginId,
    fromState: current.state,
    toState: nextState,
    reason: String(payload.reason ?? (force ? "forced-change" : "manual-change")),
    changedAt: now
  };
  appendLifecycleEntry(lifecycleEntry);

  await context.eventBus.publish({
    eventId: makeId("evt"),
    eventType: "plugin.lifecycle.changed",
    occurredAt: now,
    organizationId: getOrganizationId(payload),
    sourcePlugin: typedManifest.name,
    schemaVersion: 1,
    payload: {
      pluginId,
      fromState: current.state,
      toState: nextState,
      reason: lifecycleEntry.reason,
      blockers
    }
  });

  return {
    ok: true,
    pluginRecord: nextRecord,
    lifecycleEntry
  };
};

const pluginAction: PluginHandler = async ({ actionInput, body }, context) => {
  const payload = ((actionInput ?? body) ?? {}) as Record<string, unknown>;
  const pluginId = String(payload.entityId ?? payload.pluginId ?? "");

  if (!pluginId) {
    return {
      ok: false,
      error: "pluginId is required"
    };
  }

  if (!managedPlugins.has(pluginId)) {
    const created = await createRecord(
      {
        body: {
          pluginId,
          name: payload.name,
          version: payload.version,
          state: payload.state,
          dependsOn: payload.dependsOn,
          organizationId: payload.organizationId
        },
        query: {},
        params: {},
        headers: {},
        actionInput: {}
      },
      context
    );

    return {
      ok: true,
      action: "sync_plugin_state",
      synced: created
    };
  }

  const updated = await updatePluginState(
    {
      body: {
        state: payload.state,
        force: payload.force,
        reason: payload.reason,
        organizationId: payload.organizationId
      },
      query: {},
      params: { id: pluginId },
      headers: {},
      actionInput: {}
    },
    context
  );

  return {
    ok: (updated as Record<string, unknown>).ok === true,
    plugin: typedManifest.name,
    action: "sync_plugin_state",
    synced: updated
  };
};

export const pluginRegistration: PluginRegistration = {
  manifest: typedManifest,
  handlers: {
    listRecords,
    createRecord,
    updatePluginState,
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
      method: "POST",
      path: "/plugins/:id/state",
      handlerName: "updatePluginState"
    }
  ],
  triggers: [
    {
      key: "plugin_lifecycle_changed",
      displayName: "Plugin Manager Updated",
      eventType: "plugin.lifecycle.changed"
    }
  ],
  actions: [
    {
      key: "sync_plugin_state",
      displayName: "Plugin Manager Action",
      handlerName: "pluginAction",
      inputSchema: {
        type: "object",
        properties: {
          entityId: { type: "string" },
          state: { type: "string" },
          force: { type: "boolean" },
          reason: { type: "string" }
        },
        required: ["entityId"]
      }
    }
  ]
};




