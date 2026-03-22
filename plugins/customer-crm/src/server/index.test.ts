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
  throw new Error("Customer CRM handlers are missing");
}

if (
  !handlers.listRecords ||
  !handlers.createRecord ||
  !handlers.getCustomer ||
  !handlers.addInteraction ||
  !handlers.pluginAction
) {
  throw new Error("Customer CRM expected handlers are missing");
}

const listRecords = handlers.listRecords as PluginHandler;
const createRecord = handlers.createRecord as PluginHandler;
const getCustomer = handlers.getCustomer as PluginHandler;
const addInteraction = handlers.addInteraction as PluginHandler;
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
        return (await options.queryHandler(call)) as {
          rows: TRow[];
          rowCount: number;
        };
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

test("createRecord uses organization-scoped insert and emits customer.created", async () => {
  const { context, calls, events } = makeContext({ dbAvailable: true });

  const result = (await createRecord(
    {
      ...emptyInput,
      body: {
        organizationId: "org-alpha",
        name: "Acme",
        email: "acme@example.com"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.created, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.text, /INSERT INTO customer_crm_customers/i);
  assert.equal(events[0]?.eventType, "customer.created");
});

test("listRecords reads from persistence and maps customer rows", async () => {
  const { context } = makeContext({
    dbAvailable: true,
    queryHandler: async (call) => {
      if (/FROM customer_crm_customers/i.test(call.text)) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              name: "Beta Corp",
              phone: "123",
              email: "beta@example.com",
              tags: ["vip"],
              notes: ["renewal"],
              lastInteractionAt: "2025-01-01T00:00:00.000Z",
              createdAt: "2025-01-01T00:00:00.000Z"
            }
          ]
        };
      }

      return { rows: [], rowCount: 0 };
    }
  });

  const result = (await listRecords(
    {
      ...emptyInput,
      query: { organizationId: "org-beta" }
    },
    context
  )) as Record<string, unknown>;

  const customers = result.customers as Array<Record<string, unknown>>;
  assert.equal(customers.length, 1);
  assert.equal(customers[0]?.name, "Beta Corp");
  assert.equal((customers[0]?.tags as string[] | undefined)?.[0], "vip");
});

test("addInteraction returns not found when customer is missing in persistence", async () => {
  const { context } = makeContext({
    dbAvailable: true,
    queryHandler: async () => ({ rows: [], rowCount: 0 })
  });

  const result = (await addInteraction(
    {
      ...emptyInput,
      params: { id: "cust-404" },
      body: { organizationId: "org-gamma", message: "hello" }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.added, false);
  assert.equal(result.error, "Customer not found");
});

test("pluginAction falls back to in-memory path when persistence is unavailable", async () => {
  const { context } = makeContext({ dbAvailable: false });

  const result = (await pluginAction(
    {
      ...emptyInput,
      actionInput: {
        entityId: "legacy-customer",
        name: "Legacy Co"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.ok, true);
  const customer = result.customer as Record<string, unknown>;
  assert.equal(customer.name, "Legacy Co");
});

test("getCustomer returns not found for missing in-memory customer", async () => {
  const { context } = makeContext({ dbAvailable: false });

  const result = (await getCustomer(
    {
      ...emptyInput,
      params: { id: "missing-customer" }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.found, false);
});
