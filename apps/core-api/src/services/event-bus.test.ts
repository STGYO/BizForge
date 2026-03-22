import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { InMemoryEventBus } from "./event-bus";


test("InMemoryEventBus records delivery failures without aborting other handlers", async () => {
  const eventBus = new InMemoryEventBus();
  const delivered: string[] = [];

  eventBus.subscribe("lead.generated", async () => {
    throw new Error("handler exploded");
  });

  eventBus.subscribe("lead.generated", async (event) => {
    delivered.push(event.eventId);
  });

  await eventBus.publish({
    eventId: randomUUID(),
    eventType: "lead.generated",
    occurredAt: new Date().toISOString(),
    organizationId: "org-1",
    sourcePlugin: "core.leads",
    schemaVersion: 1,
    payload: { source: "web" }
  });

  assert.equal(delivered.length, 1);

  const diagnostics = eventBus.getDiagnostics();
  assert.equal(diagnostics.publishedCount, 1);
  assert.equal(diagnostics.deliveredCount, 1);
  assert.equal(diagnostics.failedDeliveryCount, 1);
  assert.equal(diagnostics.deadLetters.length, 1);
  assert.equal(diagnostics.deadLetters[0]?.eventType, "lead.generated");
  assert.equal(diagnostics.deadLetters[0]?.errorMessage, "handler exploded");
});

test("InMemoryEventBus acknowledges dead letters", async () => {
  const eventBus = new InMemoryEventBus();

  eventBus.subscribe("customer.created", async () => {
    throw new Error("retry me later");
  });

  await eventBus.publish({
    eventId: randomUUID(),
    eventType: "customer.created",
    occurredAt: new Date().toISOString(),
    organizationId: "org-1",
    sourcePlugin: "core.crm",
    schemaVersion: 1,
    payload: { customerId: "cust-1" }
  });

  const diagnostics = eventBus.getDiagnostics();
  const deadLetterId = diagnostics.deadLetters[0]?.id;
  assert.ok(deadLetterId);
  assert.equal(eventBus.acknowledgeDeadLetter(deadLetterId), true);
  assert.equal(eventBus.getDiagnostics().deadLetters.length, 0);
});
