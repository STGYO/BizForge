import assert from "node:assert/strict";
import test from "node:test";
import type { EventEnvelope, PluginHandler, PluginRuntimeContext } from "@bizforge/plugin-sdk";
import { pluginRegistration } from "./index";

const handlers = pluginRegistration.handlers;

if (!handlers) {
  throw new Error("Appointment manager handlers are missing");
}

if (
  !handlers.createAppointment ||
  !handlers.rescheduleAppointment ||
  !handlers.updateAppointmentStatus ||
  !handlers.scheduleFollowUp
) {
  throw new Error("Appointment manager expected handlers are missing");
}

const createAppointment = handlers.createAppointment as PluginHandler;
const rescheduleAppointment = handlers.rescheduleAppointment as PluginHandler;
const updateAppointmentStatus = handlers.updateAppointmentStatus as PluginHandler;
const scheduleFollowUp = handlers.scheduleFollowUp as PluginHandler;

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

test("createAppointment creates appointment and emits booked event", async () => {
  const events: EventEnvelope[] = [];
  const result = (await createAppointment(
    {
      ...emptyInput,
      body: {
        customerId: "cust-1",
        organizationId: "org-test",
        title: "Discovery call"
      }
    },
    makeContext(events)
  )) as Record<string, unknown>;

  assert.equal(result.created, true);
  const appointment = result.appointment as Record<string, unknown>;
  assert.equal(appointment.customerId, "cust-1");
  assert.equal(events[0]?.eventType, "appointment.booked");
});

test("rescheduleAppointment updates times and emits rescheduled event", async () => {
  const events: EventEnvelope[] = [];
  const context = makeContext(events);

  const created = (await createAppointment(
    {
      ...emptyInput,
      body: {
        customerId: "cust-2",
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  const appointment = created.appointment as Record<string, unknown>;
  const appointmentId = String(appointment.id);
  events.length = 0;

  const nextStart = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const result = (await rescheduleAppointment(
    {
      ...emptyInput,
      params: { id: appointmentId },
      body: {
        startsAt: nextStart,
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.ok, true);
  const updated = result.appointment as Record<string, unknown>;
  assert.equal(updated.startsAt, nextStart);
  assert.equal(events[0]?.eventType, "appointment.rescheduled");
});

test("updateAppointmentStatus completed emits status and completed events", async () => {
  const events: EventEnvelope[] = [];
  const context = makeContext(events);

  const created = (await createAppointment(
    {
      ...emptyInput,
      body: {
        customerId: "cust-3",
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  const appointment = created.appointment as Record<string, unknown>;
  const appointmentId = String(appointment.id);
  events.length = 0;

  const result = (await updateAppointmentStatus(
    {
      ...emptyInput,
      params: { id: appointmentId },
      body: {
        status: "completed",
        organizationId: "org-test"
      }
    },
    context
  )) as Record<string, unknown>;

  assert.equal(result.ok, true);
  assert.equal(events[0]?.eventType, "appointment.status.updated");
  assert.equal(events[1]?.eventType, "appointment.completed");
});

test("scheduleFollowUp action creates scheduled appointment", async () => {
  const events: EventEnvelope[] = [];
  const result = (await scheduleFollowUp(
    {
      ...emptyInput,
      actionInput: {
        entityId: "cust-4",
        offsetHours: 4,
        organizationId: "org-test"
      }
    },
    makeContext(events)
  )) as Record<string, unknown>;

  assert.equal(result.created, true);
  const appointment = result.appointment as Record<string, unknown>;
  assert.equal(appointment.customerId, "cust-4");
  assert.equal(events[0]?.eventType, "appointment.booked");
});
