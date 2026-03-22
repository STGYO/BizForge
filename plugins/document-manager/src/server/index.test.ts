import assert from "node:assert/strict";
import test from "node:test";
import type { EventEnvelope, PluginHandler, PluginRuntimeContext } from "@bizforge/plugin-sdk";
import { pluginRegistration } from "./index";

const handlers = pluginRegistration.handlers;

if (!handlers) {
  throw new Error("Document manager handlers are missing");
}

if (!handlers.createRecord || !handlers.addVersion || !handlers.pluginAction) {
  throw new Error("Document manager expected handlers are missing");
}

const createRecord = handlers.createRecord as PluginHandler;
const addVersion = handlers.addVersion as PluginHandler;
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

test("createRecord creates document and first version", async () => {
  const events: EventEnvelope[] = [];
  const result = (await createRecord(
    {
      ...emptyInput,
      body: {
        customerId: "cust-1",
        title: "Master Service Agreement",
        content: "Initial draft",
        organizationId: "org-test"
      }
    },
    makeContext(events)
  )) as Record<string, unknown>;

  assert.equal(result.created, true);
  const document = result.document as Record<string, unknown>;
  assert.equal(document.latestVersion, 1);
  assert.equal(events[0]?.eventType, "document.created");
  assert.equal(events[1]?.eventType, "document.version.created");
});

test("addVersion increments version and emits version event", async () => {
  const events: EventEnvelope[] = [];
  const context = makeContext(events);

  const created = (await createRecord(
    {
      ...emptyInput,
      body: {
        customerId: "cust-2",
        title: "Proposal",
        content: "v1",
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  const document = created.document as Record<string, unknown>;
  const documentId = String(document.id);
  events.length = 0;

  const updated = (await addVersion(
    {
      ...emptyInput,
      params: { id: documentId },
      body: {
        title: "Proposal v2",
        content: "updated",
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(updated.ok, true);
  const nextDoc = updated.document as Record<string, unknown>;
  assert.equal(nextDoc.latestVersion, 2);
  assert.equal(events[0]?.eventType, "document.version.created");
});

test("addVersion shared visibility emits shared event", async () => {
  const events: EventEnvelope[] = [];
  const context = makeContext(events);

  const created = (await createRecord(
    {
      ...emptyInput,
      body: {
        customerId: "cust-3",
        title: "Contract",
        content: "v1",
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  const document = created.document as Record<string, unknown>;
  const documentId = String(document.id);
  events.length = 0;

  const updated = (await addVersion(
    {
      ...emptyInput,
      params: { id: documentId },
      body: {
        title: "Contract shared",
        content: "shared copy",
        visibility: "shared",
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(updated.ok, true);
  assert.equal(events[1]?.eventType, "document.shared");
});

test("pluginAction attaches document to entity", async () => {
  const events: EventEnvelope[] = [];
  const result = (await pluginAction(
    {
      ...emptyInput,
      actionInput: {
        entityId: "cust-42",
        title: "Action-created doc",
        content: "attached",
        organizationId: "org-test"
      }
    },
    makeContext(events)
  )) as Record<string, unknown>;

  assert.equal(result.ok, true);
  const document = result.document as Record<string, unknown>;
  assert.equal(document.customerId, "cust-42");
  assert.equal(events[0]?.eventType, "document.created");
});
