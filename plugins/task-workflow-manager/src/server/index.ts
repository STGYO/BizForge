import type {
  EventEnvelope,
  PluginManifest,
  PluginPermission,
  PluginRegistration,
  PluginHandler
} from "@bizforge/plugin-sdk";
import { createHash, randomUUID } from "node:crypto";
import manifest from "../../plugin.json" assert { type: "json" };

const typedManifest = {
  ...manifest,
  permissions: manifest.permissions as PluginPermission[]
} as PluginManifest;

type TaskStatus = "todo" | "in_progress" | "blocked" | "completed";
type TaskPriority = "low" | "medium" | "high";

interface WorkflowTask {
  id: string;
  title: string;
  description: string;
  assignee: string;
  dueAt: string;
  priority: TaskPriority;
  status: TaskStatus;
  linkedEntityId?: string | undefined;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | undefined;
}

interface TaskHistoryEntry {
  id: string;
  taskId: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  note: string;
  changedAt: string;
}

const tasks = new Map<string, WorkflowTask>();
const taskHistory = new Map<string, TaskHistoryEntry[]>();
const workflowOrder: TaskStatus[] = ["todo", "in_progress", "blocked", "completed"];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";

function makeId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function toDeterministicUuid(value: string): string {
  const digest = createHash("sha1").update(value).digest("hex").slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

function normalizeUuid(value: unknown, fallback: string): string {
  const candidate = String(value ?? "").trim();
  if (!candidate) {
    return fallback;
  }

  return UUID_PATTERN.test(candidate) ? candidate.toLowerCase() : toDeterministicUuid(candidate);
}

function resolveOrganizationId(payload: Record<string, unknown>, headers: unknown): string {
  const source =
    payload.organizationId ??
    (headers as Record<string, unknown> | undefined)?.["x-bizforge-org-id"] ??
    DEFAULT_ORGANIZATION_ID;
  return normalizeUuid(source, DEFAULT_ORGANIZATION_ID);
}

function normalizePriority(value: unknown): TaskPriority {
  const candidate = String(value ?? "medium").toLowerCase();
  if (candidate === "low" || candidate === "high") {
    return candidate;
  }

  return "medium";
}

function normalizeStatus(value: unknown): TaskStatus {
  const candidate = String(value ?? "todo").toLowerCase();
  if (candidate === "in_progress" || candidate === "blocked" || candidate === "completed") {
    return candidate;
  }

  return "todo";
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

async function emitTaskEvent(
  context: Parameters<PluginHandler>[1],
  type: string,
  payload: Record<string, unknown>,
  organizationId: string,
  occurredAt: string
): Promise<void> {
  if (context.persistence) {
    await context.persistence.writeEvent({
      eventType: type,
      organizationId,
      sourcePlugin: typedManifest.name,
      payload
    });
    return;
  }

  await context.eventBus.publish(
    publishEvent(type, payload, organizationId, occurredAt, typedManifest.name)
  );
}

function mapTaskRow(row: Record<string, unknown>): WorkflowTask {
  return {
    id: String(row.id),
    title: String(row.title ?? "Follow-up task"),
    description: String(row.description ?? ""),
    assignee: String(row.assignee ?? "unassigned"),
    dueAt: String(row.dueAt ?? new Date().toISOString()),
    priority: normalizePriority(row.priority),
    status: normalizeStatus(row.status),
    ...(row.linkedEntityId ? { linkedEntityId: String(row.linkedEntityId) } : {}),
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? row.createdAt ?? new Date().toISOString()),
    ...(row.completedAt ? { completedAt: String(row.completedAt) } : {})
  };
}

function mapHistoryRow(row: Record<string, unknown>): TaskHistoryEntry {
  return {
    id: String(row.id),
    taskId: String(row.taskId),
    fromStatus: normalizeStatus(row.fromStatus),
    toStatus: normalizeStatus(row.toStatus),
    note: String(row.note ?? "workflow state changed"),
    changedAt: String(row.changedAt ?? new Date().toISOString())
  };
}

function nextStatus(current: TaskStatus): TaskStatus {
  const idx = workflowOrder.indexOf(current);
  return workflowOrder[Math.min(idx + 1, workflowOrder.length - 1)] ?? "completed";
}

const listRecords: PluginHandler = async ({ query, headers }, context) => {
  const payload = (query ?? {}) as Record<string, unknown>;
  const organizationId = resolveOrganizationId(payload, headers);

  if (context.persistence?.isDatabaseAvailable) {
    const result = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         title,
         COALESCE(description, '') AS description,
         assignee,
         due_at AS "dueAt",
         priority,
         status,
         linked_entity_id AS "linkedEntityId",
         created_at AS "createdAt",
         updated_at AS "updatedAt",
         completed_at AS "completedAt"
       FROM workflow_tasks
       WHERE organization_id = $1::uuid
       ORDER BY created_at DESC`,
      organizationId
    );

    return {
      plugin: typedManifest.name,
      tasks: result.rows.map((row) => mapTaskRow(row))
    };
  }

  return {
    plugin: typedManifest.name,
    tasks: Array.from(tasks.values())
  };
};

const createRecord: PluginHandler = async ({ body, headers }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const organizationId = resolveOrganizationId(payload, headers);
  const task: WorkflowTask = {
    id: randomUUID(),
    title: String(payload.title ?? "Follow-up task"),
    description: String(payload.description ?? ""),
    assignee: String(payload.assignee ?? "unassigned"),
    dueAt: String(payload.dueAt ?? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()),
    priority: normalizePriority(payload.priority),
    status: normalizeStatus(payload.status),
    linkedEntityId: payload.entityId ? String(payload.entityId) : undefined,
    createdAt: now,
    updatedAt: now
  };

  if (context.persistence?.isDatabaseAvailable) {
    await context.persistence.queryByOrganization(
      `INSERT INTO workflow_tasks (
         id,
         organization_id,
         title,
         description,
         assignee,
         due_at,
         priority,
         status,
         linked_entity_id,
         created_at,
         updated_at,
         completed_at
       ) VALUES (
         $2::uuid,
         $1::uuid,
         $3,
         NULLIF($4, ''),
         $5,
         $6::timestamptz,
         $7,
         $8,
         NULLIF($9, ''),
         $10::timestamptz,
         $11::timestamptz,
         NULL
       )`,
      organizationId,
      [
        task.id,
        task.title,
        task.description,
        task.assignee,
        task.dueAt,
        task.priority,
        task.status,
        task.linkedEntityId ?? "",
        task.createdAt,
        task.updatedAt
      ]
    );
  } else {
    tasks.set(task.id, task);
    taskHistory.set(task.id, []);
  }

  await emitTaskEvent(
    context,
    "task.created",
    {
      taskId: task.id,
      title: task.title,
      assignee: task.assignee,
      dueAt: task.dueAt,
      status: task.status,
      linkedEntityId: task.linkedEntityId
    },
    organizationId,
    now
  );

  return {
    created: true,
    task
  };
};

const getTask: PluginHandler = async ({ params, query, headers }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = (query ?? {}) as Record<string, unknown>;
  const taskId = String(routeParams.id ?? "");
  const organizationId = resolveOrganizationId(payload, headers);

  if (context.persistence?.isDatabaseAvailable) {
    const taskRows = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         title,
         COALESCE(description, '') AS description,
         assignee,
         due_at AS "dueAt",
         priority,
         status,
         linked_entity_id AS "linkedEntityId",
         created_at AS "createdAt",
         updated_at AS "updatedAt",
         completed_at AS "completedAt"
       FROM workflow_tasks
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
       LIMIT 1`,
      organizationId,
      [taskId]
    );

    const row = taskRows.rows[0];
    if (!row) {
      return {
        found: false,
        error: "Task not found"
      };
    }

    const historyRows = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         h.id::text AS id,
         h.task_id::text AS "taskId",
         h.from_status AS "fromStatus",
         h.to_status AS "toStatus",
         COALESCE(h.note, '') AS note,
         h.changed_at AS "changedAt"
       FROM workflow_task_history h
       INNER JOIN workflow_tasks t ON t.id = h.task_id
       WHERE t.organization_id = $1::uuid
         AND h.task_id = $2::uuid
       ORDER BY h.changed_at DESC`,
      organizationId,
      [taskId]
    );

    return {
      found: true,
      task: mapTaskRow(row),
      history: historyRows.rows.map((entry) => mapHistoryRow(entry))
    };
  }

  const task = tasks.get(taskId);

  if (!task) {
    return {
      found: false,
      error: "Task not found"
    };
  }

  return {
    found: true,
    task,
    history: taskHistory.get(taskId) ?? []
  };
};

const progressTask: PluginHandler = async ({ params, body, actionInput }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = ((actionInput ?? body) ?? {}) as Record<string, unknown>;
  const taskId = String(routeParams.id ?? payload.taskId ?? payload.entityId ?? "");
  const organizationId = resolveOrganizationId(payload, undefined);

  if (context.persistence?.isDatabaseAvailable) {
    const taskRows = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         title,
         COALESCE(description, '') AS description,
         assignee,
         due_at AS "dueAt",
         priority,
         status,
         linked_entity_id AS "linkedEntityId",
         created_at AS "createdAt",
         updated_at AS "updatedAt",
         completed_at AS "completedAt"
       FROM workflow_tasks
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
       LIMIT 1`,
      organizationId,
      [taskId]
    );

    const row = taskRows.rows[0];
    if (!row) {
      return {
        ok: false,
        error: "Task not found"
      };
    }

    const task = mapTaskRow(row);
    const targetStatus = payload.status
      ? normalizeStatus(payload.status)
      : (payload.complete ? "completed" : nextStatus(task.status));
    const now = new Date().toISOString();
    const nextTask: WorkflowTask = {
      ...task,
      status: targetStatus,
      assignee: payload.assignee ? String(payload.assignee) : task.assignee,
      updatedAt: now,
      ...(targetStatus === "completed" ? { completedAt: now } : {})
    };

    await context.persistence.queryByOrganization(
      `UPDATE workflow_tasks
       SET status = $3,
           assignee = $4,
           updated_at = $5::timestamptz,
           completed_at = $6::timestamptz
       WHERE organization_id = $1::uuid
         AND id = $2::uuid`,
      organizationId,
      [
        nextTask.id,
        nextTask.status,
        nextTask.assignee,
        nextTask.updatedAt,
        nextTask.completedAt ?? null
      ]
    );

    const historyItem: TaskHistoryEntry = {
      id: randomUUID(),
      taskId,
      fromStatus: task.status,
      toStatus: targetStatus,
      note: String(payload.note ?? "workflow state changed"),
      changedAt: now
    };

    await context.persistence.queryByOrganization(
      `INSERT INTO workflow_task_history (
         id,
         task_id,
         from_status,
         to_status,
         note,
         changed_at
       ) VALUES (
         $2::uuid,
         $3::uuid,
         $4,
         $5,
         NULLIF($6, ''),
         $7::timestamptz
       )`,
      organizationId,
      [
        historyItem.id,
        historyItem.taskId,
        historyItem.fromStatus,
        historyItem.toStatus,
        historyItem.note,
        historyItem.changedAt
      ]
    );

    await emitTaskEvent(
      context,
      "task.workflow.progressed",
      {
        taskId,
        fromStatus: task.status,
        toStatus: targetStatus,
        assignee: nextTask.assignee
      },
      organizationId,
      now
    );

    if (targetStatus === "completed") {
      await emitTaskEvent(
        context,
        "task.completed",
        {
          taskId,
          linkedEntityId: nextTask.linkedEntityId,
          completedAt: now
        },
        organizationId,
        now
      );
    }

    return {
      ok: true,
      task: nextTask,
      historyItem
    };
  }

  const task = tasks.get(taskId);

  if (!task) {
    return {
      ok: false,
      error: "Task not found"
    };
  }

  const targetStatus = payload.status
    ? normalizeStatus(payload.status)
    : (payload.complete ? "completed" : nextStatus(task.status));
  const now = new Date().toISOString();
  const nextTask: WorkflowTask = {
    ...task,
    status: targetStatus,
    assignee: payload.assignee ? String(payload.assignee) : task.assignee,
    updatedAt: now,
    completedAt: targetStatus === "completed" ? now : undefined
  };
  tasks.set(taskId, nextTask);

  const historyItem: TaskHistoryEntry = {
    id: makeId("hist"),
    taskId,
    fromStatus: task.status,
    toStatus: targetStatus,
    note: String(payload.note ?? "workflow state changed"),
    changedAt: now
  };
  const history = taskHistory.get(taskId) ?? [];
  taskHistory.set(taskId, [historyItem, ...history]);

  await emitTaskEvent(
    context,
    "task.workflow.progressed",
    {
      taskId,
      fromStatus: task.status,
      toStatus: targetStatus,
      assignee: nextTask.assignee
    },
    organizationId,
    now
  );

  if (targetStatus === "completed") {
    await emitTaskEvent(
      context,
      "task.completed",
      {
        taskId,
        linkedEntityId: nextTask.linkedEntityId,
        completedAt: now
      },
      organizationId,
      now
    );
  }

  return {
    ok: true,
    task: nextTask,
    historyItem
  };
};

const pluginAction: PluginHandler = async ({ actionInput }, context) => {
  const payload = (actionInput ?? {}) as Record<string, unknown>;
  const result = (await createRecord(
    {
      body: payload,
      query: {},
      params: {},
      headers: {}
    },
    context
  )) as Record<string, unknown>;

  return {
    ok: true,
    plugin: typedManifest.name,
    action: "create_follow_up_task",
    task: result.task
  };
};

export const pluginRegistration: PluginRegistration = {
  manifest: typedManifest,
  handlers: {
    listRecords,
    createRecord,
    getTask,
    progressTask,
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
      path: "/tasks/:id",
      handlerName: "getTask"
    },
    {
      method: "POST",
      path: "/tasks/:id/progress",
      handlerName: "progressTask"
    }
  ],
  triggers: [
    {
      key: "task_created",
      displayName: "Task Created",
      eventType: "task.created"
    },
    {
      key: "task_workflow_progressed",
      displayName: "Task Workflow Manager Updated",
      eventType: "task.workflow.progressed"
    },
    {
      key: "task_completed",
      displayName: "Task Completed",
      eventType: "task.completed"
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
          title: { type: "string" },
          description: { type: "string" },
          assignee: { type: "string" },
          dueAt: { type: "string" },
          priority: {
            type: "string",
            enum: ["low", "medium", "high"]
          }
        },
        required: ["entityId", "title"]
      }
    }
  ]
};




