import assert from "node:assert/strict";
import test from "node:test";
import type {
  EventEnvelope,
  PluginHandler,
  PluginPersistenceHelper,
  PluginRuntimeContext
} from "@bizforge/plugin-sdk";
import { pluginRegistration } from "./index";

const handlers = pluginRegistration.handlers;

if (!handlers) {
  throw new Error("Leads manager handlers are missing");
}

if (!handlers.listRecords || !handlers.createRecord || !handlers.advanceLeadStage || !handlers.pluginAction) {
  throw new Error("Leads manager expected handlers are missing");
}

const listRecords = handlers.listRecords as PluginHandler;
const createRecord = handlers.createRecord as PluginHandler;
const advanceLeadStage = handlers.advanceLeadStage as PluginHandler;
const pluginAction = handlers.pluginAction as PluginHandler;

interface QueryCall {
  text: string;
  organizationId: string;
  params: unknown[];
}

function makeContext(options?: {
  dbAvailable?: boolean;
  queryHandler?: (call: QueryCall) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>;
  events?: EventEnvelope[];
}): { context: PluginRuntimeContext; calls: QueryCall[]; events: EventEnvelope[] } {
  const calls: QueryCall[] = [];
  const events = options?.events ?? [];

  const persistence: PluginPersistenceHelper = {
    mode: options?.dbAvailable ? "postgres" : "in-memory",
    isDatabaseAvailable: options?.dbAvailable ?? false,
    createId: (prefix = "plg") => `${prefix}_id`,
    withOrganizationParams: (organizationId, params = []) => [organizationId, ...params],
    queryByOrganization: async <TRow = Record<string, unknown>>(
      text: string,
      organizationId: string,
      params: unknown[] = []
    ) => {
      const call: QueryCall = { text, organizationId, params };
      calls.push(call);
      if (options?.queryHandler) {
        return (await options.queryHandler(call)) as { rows: TRow[]; rowCount: number };
      }

      return { rows: [] as TRow[], rowCount: 0 };
    },
    writeEvent: async (input) => {
      const event: EventEnvelope = {
        eventId: "evt_test",
        eventType: input.eventType,
        occurredAt: new Date().toISOString(),
        organizationId: input.organizationId,
        sourcePlugin: input.sourcePlugin,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        schemaVersion: 1,
        payload: input.payload
      };
      events.push(event);
      return event;
    }
  };

  return {
    context: {
      eventBus: {
        publish: async (event) => {
          events.push(event);
        },
        subscribe: () => {
          return () => {
            return undefined;
          };
        }
      },
      persistence
    },
    calls,
    events
  };
}

const emptyInput = {
  body: {},
  query: {},
  params: {},
  headers: {}
};

test("createRecord persists lead and emits lead.generated", async () => {
  const { context, calls, events } = makeContext({ dbAvailable: true });

  const result = (await createRecord(
    {
      ...emptyInput,
      body: {
        organizationId: "org-one",
        name: "Lead One",
        source: "web"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.created, true);
  assert.match(calls[0]?.text ?? "", /INSERT INTO leads_manager_leads/i);
  assert.equal(events[0]?.eventType, "lead.generated");
});

test("listRecords returns mapped rows from persistence", async () => {
  const { context } = makeContext({
    dbAvailable: true,
    queryHandler: async () => ({
      rowCount: 1,
      rows: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          name: "Lead Two",
          email: "lead2@example.com",
          phone: "999",
          source: "import",
          owner: "owner-a",
          stage: "new",
          score: 10,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z"
        }
      ]
    })
  });

  const result = (await listRecords(
    {
      ...emptyInput,
      query: { organizationId: "org-two" }
    },
    context
  )) as Record<string, unknown>;

  const leads = result.leads as Array<Record<string, unknown>>;
  assert.equal(leads.length, 1);
  assert.equal(leads[0]?.name, "Lead Two");
});

test("advanceLeadStage fails when persistence lookup misses lead", async () => {
  const { context } = makeContext({
    dbAvailable: true,
    queryHandler: async () => ({ rows: [], rowCount: 0 })
  });

  const result = (await advanceLeadStage(
    {
      ...emptyInput,
      body: {
        organizationId: "org-three",
        leadId: "missing-lead"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.ok, false);
  assert.equal(result.error, "Lead not found");
});

test("pluginAction updates in-memory lead score when persistence is unavailable", async () => {
  const { context } = makeContext({ dbAvailable: false });

  const created = (await createRecord(
    {
      ...emptyInput,
      body: { name: "Fallback Lead" }
    },
    context
  )) as Record<string, unknown>;
  const lead = created.lead as Record<string, unknown>;

  const result = (await pluginAction(
    {
      ...emptyInput,
      actionInput: {
        leadId: lead.id,
        scoreDelta: 7
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.ok, true);
  const updated = result.lead as Record<string, unknown>;
  assert.equal(updated.score, Number(lead.score) + 7);
});
