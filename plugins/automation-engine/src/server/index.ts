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

type ExecutionStatus = "queued" | "running" | "succeeded" | "failed";

interface WorkflowRecord {
  id: string;
  name: string;
  triggerEvent: string;
  actionKey: string;
  enabled: boolean;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ExecutionRecord {
  id: string;
  workflowId: string;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt: string | null;
  attempt: number;
  error: string | null;
}

const workflows = new Map<string, WorkflowRecord>();
const executions = new Map<string, ExecutionRecord>();

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrganizationId(payload: Record<string, unknown>): string {
  return String(payload.organizationId ?? "org-1");
}

function findLatestExecution(workflowId: string): ExecutionRecord | undefined {
  return Array.from(executions.values())
    .filter((execution) => execution.workflowId === workflowId)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
}

const listRecords: PluginHandler = async () => {
  return {
    plugin: typedManifest.name,
    workflows: Array.from(workflows.values()),
    executions: Array.from(executions.values())
  };
};

const createRecord: PluginHandler = async ({ body }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const workflow: WorkflowRecord = {
    id: makeId("wf"),
    name: String(payload.name ?? payload.title ?? "Automation Workflow"),
    triggerEvent: String(payload.triggerEvent ?? "customer.created"),
    actionKey: String(payload.actionKey ?? "sync_plugin_state"),
    enabled: payload.enabled !== false,
    runCount: 0,
    createdAt: now,
    updatedAt: now
  };
  workflows.set(workflow.id, workflow);

  await context.eventBus.publish({
    eventId: makeId("evt"),
    eventType: "automation.rule.created",
    occurredAt: now,
    organizationId: getOrganizationId(payload),
    sourcePlugin: typedManifest.name,
    schemaVersion: 1,
    payload: {
      workflowId: workflow.id,
      triggerEvent: workflow.triggerEvent,
      actionKey: workflow.actionKey
    }
  });

  return {
    created: true,
    workflow
  };
};

const runWorkflow: PluginHandler = async ({ params, body }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = (body ?? {}) as Record<string, unknown>;
  const workflowId = String(routeParams.id ?? payload.workflowId ?? "");
  const workflow = workflows.get(workflowId);

  if (!workflow) {
    return {
      ok: false,
      error: "Workflow not found"
    };
  }

  const startedAt = new Date().toISOString();
  const execution: ExecutionRecord = {
    id: makeId("exec"),
    workflowId,
    status: "running",
    startedAt,
    finishedAt: null,
    attempt: Number(payload.attempt ?? 1),
    error: null
  };
  executions.set(execution.id, execution);

  await context.eventBus.publish({
    eventId: makeId("evt"),
    eventType: "automation.execution.started",
    occurredAt: startedAt,
    organizationId: getOrganizationId(payload),
    sourcePlugin: typedManifest.name,
    schemaVersion: 1,
    payload: {
      workflowId,
      executionId: execution.id
    }
  });

  const finishedAt = new Date().toISOString();
  const shouldFail = payload.simulateFailure === true;
  const finalExecution: ExecutionRecord = {
    ...execution,
    status: shouldFail ? "failed" : "succeeded",
    finishedAt,
    error: shouldFail ? String(payload.failureReason ?? "Execution failed") : null
  };
  executions.set(finalExecution.id, finalExecution);

  const nextWorkflow: WorkflowRecord = {
    ...workflow,
    runCount: workflow.runCount + 1,
    updatedAt: finishedAt
  };
  workflows.set(workflowId, nextWorkflow);

  await context.eventBus.publish({
    eventId: makeId("evt"),
    eventType: shouldFail ? "automation.execution.failed" : "automation.execution.completed",
    occurredAt: finishedAt,
    organizationId: getOrganizationId(payload),
    sourcePlugin: typedManifest.name,
    schemaVersion: 1,
    payload: {
      workflowId,
      executionId: finalExecution.id,
      status: finalExecution.status,
      error: finalExecution.error
    }
  });

  return {
    ok: !shouldFail,
    workflow: nextWorkflow,
    execution: finalExecution
  };
};

const getExecution: PluginHandler = async ({ params }) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const executionId = String(routeParams.id ?? "");
  const execution = executions.get(executionId);

  if (!execution) {
    return {
      found: false,
      error: "Execution not found"
    };
  }

  return {
    found: true,
    execution
  };
};

const pluginAction: PluginHandler = async ({ actionInput, body }, context) => {
  const payload = ((actionInput ?? body) ?? {}) as Record<string, unknown>;
  const workflowId = String(payload.entityId ?? payload.workflowId ?? "");

  if (!workflowId || !workflows.has(workflowId)) {
    return {
      ok: false,
      error: "workflowId is required"
    };
  }

  const latest = findLatestExecution(workflowId);

  if (latest && latest.status !== "failed" && payload.force !== true) {
    return {
      ok: false,
      error: "Latest execution is not failed. Set force=true to retry anyway."
    };
  }

  const attempt = (latest?.attempt ?? 0) + 1;

  return runWorkflow(
    {
      body: {
        workflowId,
        attempt,
        organizationId: payload.organizationId,
        simulateFailure: payload.simulateFailure === true,
        failureReason: payload.failureReason
      },
      query: {},
      params: { id: workflowId },
      headers: {},
      actionInput: {}
    },
    context
  );
};

export const pluginRegistration: PluginRegistration = {
  manifest: typedManifest,
  handlers: {
    listRecords,
    createRecord,
    runWorkflow,
    getExecution,
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
      path: "/automations/:id/run",
      handlerName: "runWorkflow"
    },
    {
      method: "GET",
      path: "/executions/:id",
      handlerName: "getExecution"
    }
  ],
  triggers: [
    {
      key: "automation_rule_created",
      displayName: "Automation Rule Created",
      eventType: "automation.rule.created"
    },
    {
      key: "automation_execution_completed",
      displayName: "Automation Execution Completed",
      eventType: "automation.execution.completed"
    },
    {
      key: "automation_execution_failed",
      displayName: "Automation Execution Failed",
      eventType: "automation.execution.failed"
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
          force: { type: "boolean" },
          simulateFailure: { type: "boolean" },
          failureReason: { type: "string" }
        },
        required: ["entityId"]
      }
    }
  ]
};




