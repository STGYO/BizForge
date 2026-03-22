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

type AppointmentStatus = "scheduled" | "confirmed" | "completed" | "cancelled";

interface AppointmentRecord {
  id: string;
  customerId: string;
  staffId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

const appointments = new Map<string, AppointmentRecord>();

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrganizationId(payload: Record<string, unknown>): string {
  return String(payload.organizationId ?? "org-1");
}

function normalizeStatus(value: unknown): AppointmentStatus {
  const candidate = String(value ?? "scheduled").toLowerCase();
  if (candidate === "confirmed" || candidate === "completed" || candidate === "cancelled") {
    return candidate;
  }

  return "scheduled";
}

function toIso(value: unknown, fallback: Date): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return fallback.toISOString();
}

const listAppointments: PluginHandler = async () => {
  return {
    plugin: typedManifest.name,
    appointments: Array.from(appointments.values())
  };
};

const createAppointment: PluginHandler = async ({ body }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const now = new Date();
  const startsAt = new Date(toIso(payload.startsAt, new Date(now.getTime() + 60 * 60 * 1000)));
  const endsAt = new Date(toIso(payload.endsAt, new Date(startsAt.getTime() + 30 * 60 * 1000)));

  const appointment: AppointmentRecord = {
    id: makeId("appt"),
    customerId: String(payload.customerId ?? "unknown"),
    staffId: String(payload.staffId ?? "unassigned"),
    title: String(payload.title ?? "Customer Appointment"),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    status: normalizeStatus(payload.status),
    notes: String(payload.notes ?? ""),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };

  appointments.set(appointment.id, appointment);

  await context.eventBus.publish({
    eventId: makeId("evt"),
    eventType: "appointment.booked",
    occurredAt: appointment.createdAt,
    organizationId: getOrganizationId(payload),
    sourcePlugin: typedManifest.name,
    schemaVersion: 1,
    payload: {
      appointmentId: appointment.id,
      customerId: appointment.customerId,
      startsAt: appointment.startsAt,
      status: appointment.status
    }
  });

  return {
    created: true,
    appointment
  };
};

const rescheduleAppointment: PluginHandler = async ({ params, body }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = (body ?? {}) as Record<string, unknown>;
  const appointmentId = String(routeParams.id ?? "");
  const current = appointments.get(appointmentId);

  if (!current) {
    return {
      ok: false,
      error: "Appointment not found"
    };
  }

  const now = new Date().toISOString();
  const next: AppointmentRecord = {
    ...current,
    startsAt: toIso(payload.startsAt, new Date(current.startsAt)),
    endsAt: toIso(payload.endsAt, new Date(current.endsAt)),
    updatedAt: now
  };
  appointments.set(appointmentId, next);

  await context.eventBus.publish({
    eventId: makeId("evt"),
    eventType: "appointment.rescheduled",
    occurredAt: now,
    organizationId: getOrganizationId(payload),
    sourcePlugin: typedManifest.name,
    schemaVersion: 1,
    payload: {
      appointmentId,
      startsAt: next.startsAt,
      endsAt: next.endsAt
    }
  });

  return {
    ok: true,
    appointment: next
  };
};

const updateAppointmentStatus: PluginHandler = async ({ params, body }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = (body ?? {}) as Record<string, unknown>;
  const appointmentId = String(routeParams.id ?? "");
  const current = appointments.get(appointmentId);

  if (!current) {
    return {
      ok: false,
      error: "Appointment not found"
    };
  }

  const nextStatus = normalizeStatus(payload.status);
  const now = new Date().toISOString();
  const next: AppointmentRecord = {
    ...current,
    status: nextStatus,
    updatedAt: now
  };
  appointments.set(appointmentId, next);

  await context.eventBus.publish({
    eventId: makeId("evt"),
    eventType: "appointment.status.updated",
    occurredAt: now,
    organizationId: getOrganizationId(payload),
    sourcePlugin: typedManifest.name,
    schemaVersion: 1,
    payload: {
      appointmentId,
      status: next.status
    }
  });

  if (nextStatus === "completed") {
    await context.eventBus.publish({
      eventId: makeId("evt"),
      eventType: "appointment.completed",
      occurredAt: now,
      organizationId: getOrganizationId(payload),
      sourcePlugin: typedManifest.name,
      schemaVersion: 1,
      payload: {
        appointmentId,
        customerId: next.customerId
      }
    });
  }

  return {
    ok: true,
    appointment: next
  };
};

const scheduleFollowUp: PluginHandler = async ({ actionInput }, context) => {
  const payload = (actionInput ?? {}) as Record<string, unknown>;
  const customerId = String(payload.customerId ?? payload.entityId ?? "");
  if (!customerId) {
    return {
      ok: false,
      error: "customerId is required"
    };
  }

  const offsetHours = Number(payload.offsetHours ?? 24);
  const startDate = new Date(Date.now() + Math.max(offsetHours, 1) * 60 * 60 * 1000);
  const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);

  return createAppointment(
    {
      body: {
        customerId,
        staffId: String(payload.staffId ?? "automation"),
        title: String(payload.title ?? "Follow-up Appointment"),
        startsAt: startDate.toISOString(),
        endsAt: endDate.toISOString(),
        status: "scheduled",
        notes: String(payload.notes ?? "Created by automation"),
        organizationId: payload.organizationId
      },
      query: {},
      params: {},
      headers: {},
      actionInput: {}
    },
    context
  );
};

export const pluginRegistration: PluginRegistration = {
  manifest: typedManifest,
  handlers: {
    listAppointments,
    createAppointment,
    rescheduleAppointment,
    updateAppointmentStatus,
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
    },
    {
      method: "PATCH",
      path: "/appointments/:id/reschedule",
      handlerName: "rescheduleAppointment"
    },
    {
      method: "PATCH",
      path: "/appointments/:id/status",
      handlerName: "updateAppointmentStatus"
    }
  ],
  triggers: [
    {
      key: "appointment.booked",
      displayName: "Appointment Booked",
      eventType: "appointment.booked"
    },
    {
      key: "appointment.rescheduled",
      displayName: "Appointment Rescheduled",
      eventType: "appointment.rescheduled"
    },
    {
      key: "appointment.completed",
      displayName: "Appointment Completed",
      eventType: "appointment.completed"
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
          entityId: { type: "string" },
          customerId: { type: "string" },
          offsetHours: { type: "number" },
          staffId: { type: "string" }
        },
        required: []
      }
    }
  ]
};




