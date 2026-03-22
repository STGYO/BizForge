import assert from "node:assert/strict";
import test from "node:test";
import type { EventEnvelope, PluginHandler, PluginRuntimeContext } from "@bizforge/plugin-sdk";
import { pluginRegistration } from "./index";

const handlers = pluginRegistration.handlers;

if (!handlers) {
  throw new Error("Task workflow manager handlers are missing");
}

if (!handlers.createRecord || !handlers.progressTask || !handlers.pluginAction) {
  throw new Error("Task workflow manager expected handlers are missing");
}

const createRecord = handlers.createRecord as PluginHandler;
const progressTask = handlers.progressTask as PluginHandler;
const pluginAction = handlers.pluginAction as PluginHandler;

function makeContext(events: EventEnvelope[] = []): PluginRuntimeContext {
  return {
    eventBus: {
      publish: async (event) => {
        events.push(event);
      },
      subscribe: () => {
        return () => {
          return undefined;
        };
      }
    }
  };
}

const emptyInput = {
  body: {},
  query: {},
  params: {},
  headers: {}
};

test("createRecord creates task and emits task.created", async () => {
  const events: EventEnvelope[] = [];
  const result = (await createRecord(
    {
      ...emptyInput,
      body: {
        title: "Call customer",
        assignee: "ops-1",
        entityId: "cust-123",
        organizationId: "org-test"
      }
    },
    makeContext(events)
  )) as Record<string, unknown>;

  assert.equal(result.created, true);
  const task = result.task as Record<string, unknown>;
  assert.equal(task.title, "Call customer");
  assert.equal(task.status, "todo");
  assert.equal(events[0]?.eventType, "task.created");
});

test("progressTask advances and emits workflow event", async () => {
  const events: EventEnvelope[] = [];
  const context = makeContext(events);

  const created = (await createRecord(
    {
      ...emptyInput,
      body: {
        title: "Prepare quote",
        assignee: "sales-1",
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  const task = created.task as Record<string, unknown>;
  const taskId = String(task.id);
  events.length = 0;

  const progressed = (await progressTask(
    {
      ...emptyInput,
      params: { id: taskId },
      body: { note: "started", organizationId: "org-test" }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(progressed.ok, true);
  const nextTask = progressed.task as Record<string, unknown>;
  assert.equal(nextTask.status, "in_progress");
  assert.equal(events[0]?.eventType, "task.workflow.progressed");
});

test("progressTask complete emits completed event", async () => {
  const events: EventEnvelope[] = [];
  const context = makeContext(events);

  const created = (await createRecord(
    {
      ...emptyInput,
      body: {
        title: "Confirm payment",
        assignee: "finance-1",
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  const task = created.task as Record<string, unknown>;
  const taskId = String(task.id);
  events.length = 0;

  const completed = (await progressTask(
    {
      ...emptyInput,
      params: { id: taskId },
      body: { status: "completed", organizationId: "org-test" }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(completed.ok, true);
  const nextTask = completed.task as Record<string, unknown>;
  assert.equal(nextTask.status, "completed");
  assert.equal(events[0]?.eventType, "task.workflow.progressed");
  assert.equal(events[1]?.eventType, "task.completed");
});

test("pluginAction creates follow-up task", async () => {
  const events: EventEnvelope[] = [];
  const result = (await pluginAction(
    {
      ...emptyInput,
      actionInput: {
        entityId: "lead-1",
        title: "Follow up lead",
        assignee: "sales-1",
        organizationId: "org-test"
      }
    },
    makeContext(events)
  )) as Record<string, unknown>;

  assert.equal(result.ok, true);
  const task = result.task as Record<string, unknown>;
  assert.equal(task.linkedEntityId, "lead-1");
  assert.equal(events[0]?.eventType, "task.created");
});
