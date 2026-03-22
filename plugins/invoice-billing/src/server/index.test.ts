import assert from "node:assert/strict";
import test from "node:test";
import type { EventEnvelope, PluginHandler, PluginRuntimeContext } from "@bizforge/plugin-sdk";
import { pluginRegistration } from "./index";

const handlers = pluginRegistration.handlers;

if (!handlers) {
  throw new Error("Invoice billing plugin handlers are not defined");
}

if (!handlers.createRecord || !handlers.issueInvoice || !handlers.recordPayment || !handlers.pluginAction) {
  throw new Error("Invoice billing expected handlers are missing");
}

const createRecord = handlers.createRecord as PluginHandler;
const issueInvoice = handlers.issueInvoice as PluginHandler;
const recordPayment = handlers.recordPayment as PluginHandler;
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

test("createRecord creates invoice and emits invoice.created", async () => {
  const published: EventEnvelope[] = [];
  const context = makeContext(published);

  const result = (await createRecord(
    {
      ...emptyInput,
      body: {
        customerId: "cust-1",
        lineItems: [{ description: "Consulting", quantity: 2, unitPrice: 150 }],
        taxRate: 0.1,
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.created, true);
  const invoice = result.invoice as Record<string, unknown>;
  assert.equal(invoice.status, "draft");
  assert.equal(invoice.totalAmount, 330);

  assert.equal(published.length, 1);
  assert.equal(published[0]?.eventType, "invoice.created");
});

test("issueInvoice transitions invoice to issued and emits invoice.issued", async () => {
  const published: EventEnvelope[] = [];
  const context = makeContext(published);

  const createResult = (await createRecord(
    {
      ...emptyInput,
      body: {
        customerId: "cust-issue",
        lineItems: [{ description: "Subscription", quantity: 1, unitPrice: 200 }],
        taxRate: 0,
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  const invoice = createResult.invoice as Record<string, unknown>;
  const invoiceId = String(invoice.id);
  published.length = 0;

  const result = (await issueInvoice(
    {
      ...emptyInput,
      params: { id: invoiceId },
      body: { organizationId: "org-test" }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.issued, true);
  const nextInvoice = result.invoice as Record<string, unknown>;
  assert.equal(nextInvoice.status, "issued");

  assert.equal(published.length, 1);
  assert.equal(published[0]?.eventType, "invoice.issued");
});

test("recordPayment moves invoice to paid and emits payment + paid events", async () => {
  const published: EventEnvelope[] = [];
  const context = makeContext(published);

  const createResult = (await createRecord(
    {
      ...emptyInput,
      body: {
        customerId: "cust-paid",
        lineItems: [{ description: "Project", quantity: 1, unitPrice: 500 }],
        taxRate: 0,
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  const invoice = createResult.invoice as Record<string, unknown>;
  const invoiceId = String(invoice.id);
  published.length = 0;

  const result = (await recordPayment(
    {
      ...emptyInput,
      params: { id: invoiceId },
      body: {
        amount: 500,
        method: "card",
        reference: "pay-123",
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.ok, true);
  const nextInvoice = result.invoice as Record<string, unknown>;
  assert.equal(nextInvoice.status, "paid");

  assert.equal(published.length, 2);
  assert.equal(published[0]?.eventType, "invoice.payment.recorded");
  assert.equal(published[1]?.eventType, "invoice.paid");
});

test("pluginAction creates invoice from automation input", async () => {
  const published: EventEnvelope[] = [];
  const context = makeContext(published);

  const result = (await pluginAction(
    {
      ...emptyInput,
      actionInput: {
        customerId: "cust-auto",
        lineItems: [{ description: "Automation generated invoice", quantity: 1, unitPrice: 99 }],
        taxRate: 0,
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.ok, true);
  const invoice = result.invoice as Record<string, unknown>;
  assert.equal(invoice.customerId, "cust-auto");
  assert.equal(invoice.status, "draft");
  assert.equal(published[0]?.eventType, "invoice.created");
});
