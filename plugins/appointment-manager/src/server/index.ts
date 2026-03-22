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

const listAppointments: PluginHandler = async () => {
  return {
    appointments: [
      {
        id: "appt-001",
        customerId: "cust-001",
        startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        status: "scheduled"
      }
    ]
  };
};

const createAppointment: PluginHandler = async ({ body }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const appointment = {
    id: `appt-${Date.now()}`,
    customerId: String(payload.customerId ?? "unknown"),
    startsAt: String(payload.startsAt ?? new Date().toISOString()),
    status: "scheduled"
  };

  await context.eventBus.publish({
    eventId: `evt-${Date.now()}`,
    eventType: "appointment.booked",
    occurredAt: new Date().toISOString(),
    organizationId: String(payload.organizationId ?? "demo-org"),
    sourcePlugin: typedManifest.name,
    schemaVersion: 1,
    payload: {
      appointmentId: appointment.id,
      customerId: appointment.customerId,
      startsAt: appointment.startsAt
    }
  });

  return {
    created: true,
    appointment
  };
};

const scheduleFollowUp: PluginHandler = async ({ actionInput }) => {
  return {
    scheduled: true,
    type: "follow_up",
    customerId: String(actionInput?.customerId ?? "unknown"),
    offsetHours: Number(actionInput?.offsetHours ?? 24)
  };
};

export const appointmentManagerPlugin: PluginRegistration = {
  manifest: typedManifest,
  handlers: {
    listAppointments,
    createAppointment,
    scheduleFollowUp
  },
  routes: [
    {
      method: "GET",
      path: "/appointments",
      handlerName: "listAppointments"
    },
    {
      method: "POST",
      path: "/appointments",
      handlerName: "createAppointment"
    }
  ],
  triggers: [
    {
      key: "appointment.booked",
      displayName: "Appointment Booked",
      eventType: "appointment.booked"
    }
  ],
  actions: [
    {
      key: "schedule_follow_up",
      displayName: "Schedule Follow Up",
      handlerName: "scheduleFollowUp",
      inputSchema: {
        type: "object",
        properties: {
          customerId: { type: "string" },
          offsetHours: { type: "number" }
        },
        required: ["customerId", "offsetHours"]
      }
    }
  ]
};




