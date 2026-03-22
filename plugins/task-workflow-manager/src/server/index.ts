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

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrganizationId(payload: Record<string, unknown>): string {
  return String(payload.organizationId ?? "org-1");
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

function nextStatus(current: TaskStatus): TaskStatus {
  const idx = workflowOrder.indexOf(current);
  return workflowOrder[Math.min(idx + 1, workflowOrder.length - 1)] ?? "completed";
}

const listRecords: PluginHandler = async () => {
  return {
    plugin: typedManifest.name,
    tasks: Array.from(tasks.values())
  };
};

const createRecord: PluginHandler = async ({ body }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const task: WorkflowTask = {
    id: makeId("task"),
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

  tasks.set(task.id, task);
  taskHistory.set(task.id, []);

  await context.eventBus.publish(
    publishEvent(
      "task.created",
      {
        taskId: task.id,
        title: task.title,
        assignee: task.assignee,
        dueAt: task.dueAt,
        status: task.status,
        linkedEntityId: task.linkedEntityId
      },
      getOrganizationId(payload),
      now,
      typedManifest.name
    )
  );

  return {
    created: true,
    task
  };
};

const getTask: PluginHandler = async ({ params }) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const taskId = String(routeParams.id ?? "");
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

  const organizationId = getOrganizationId(payload);
  await context.eventBus.publish(
    publishEvent(
      "task.workflow.progressed",
      {
        taskId,
        fromStatus: task.status,
        toStatus: targetStatus,
        assignee: nextTask.assignee
      },
      organizationId,
      now,
      typedManifest.name
    )
  );

  if (targetStatus === "completed") {
    await context.eventBus.publish(
      publishEvent(
        "task.completed",
        {
          taskId,
          linkedEntityId: nextTask.linkedEntityId,
          completedAt: now
        },
        organizationId,
        now,
        typedManifest.name
      )
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




