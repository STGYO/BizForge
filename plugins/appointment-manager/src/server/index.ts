import type {
  EventEnvelope,
  PluginManifest,
  PluginPermission,
  PluginRegistration,
  PluginHandler
} from "@bizforge/plugin-sdk";
import { randomUUID } from "node:crypto";
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
  return `${prefix}_${randomUUID()}`;
}

function resolveOrganizationId(payload: Record<string, unknown>, headers: unknown): string {
  return String(
    payload.organizationId ??
      (headers as Record<string, unknown> | undefined)?.["x-bizforge-org-id"] ??
      "org-1"
  );
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

function publishEvent(
  type: string,
  payload: Record<string, unknown>,
  organizationId: string,
  occurredAt: string
): EventEnvelope<Record<string, unknown>> {
  return {
    eventId: makeId("evt"),
    eventType: type,
    occurredAt,
    organizationId,
    sourcePlugin: typedManifest.name,
    schemaVersion: 1,
    payload
  };
}

async function emitAppointmentEvent(
  context: Parameters<PluginHandler>[1],
  type: string,
  payload: Record<string, unknown>,
  organizationId: string,
  occurredAt: string
): Promise<void> {
  if (context.persistence) {
    await context.persistence.writeEvent({
      eventType: type,
      organizationId,
      sourcePlugin: typedManifest.name,
      payload
    });
    return;
  }

  await context.eventBus.publish(publishEvent(type, payload, organizationId, occurredAt));
}

function mapAppointmentRow(row: Record<string, unknown>): AppointmentRecord {
  return {
    id: String(row.id),
    customerId: String(row.customerId ?? "unknown"),
    staffId: String(row.staffId ?? "unassigned"),
    title: String(row.title ?? "Customer Appointment"),
    startsAt: String(row.startsAt ?? new Date().toISOString()),
    endsAt: String(row.endsAt ?? new Date().toISOString()),
    status: normalizeStatus(row.status),
    notes: String(row.notes ?? ""),
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? new Date().toISOString())
  };
}

const listAppointments: PluginHandler = async ({ query, headers }, context) => {
  const payload = (query ?? {}) as Record<string, unknown>;
  const organizationId = resolveOrganizationId(payload, headers);

  if (context.persistence?.isDatabaseAvailable) {
    const result = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id,
         customer_id AS "customerId",
         COALESCE(staff_id, 'unassigned') AS "staffId",
         title,
         starts_at AS "startsAt",
         ends_at AS "endsAt",
         status,
         COALESCE(notes, '') AS notes,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM appointments
       WHERE organization_id = $1
       ORDER BY starts_at ASC`,
      organizationId
    );

    return {
      plugin: typedManifest.name,
      appointments: result.rows.map((row) => mapAppointmentRow(row))
    };
  }

  return {
    plugin: typedManifest.name,
    appointments: Array.from(appointments.values())
  };
};

const createAppointment: PluginHandler = async ({ body, headers }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const now = new Date();
  const startsAt = new Date(toIso(payload.startsAt, new Date(now.getTime() + 60 * 60 * 1000)));
  const endsAt = new Date(toIso(payload.endsAt, new Date(startsAt.getTime() + 30 * 60 * 1000)));

  const appointment: AppointmentRecord = {
    id: randomUUID(),
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

  const organizationId = resolveOrganizationId(payload, headers);

  if (context.persistence?.isDatabaseAvailable) {
    await context.persistence.queryByOrganization(
      `INSERT INTO appointments (
         id,
         organization_id,
         customer_id,
         staff_id,
         title,
         notes,
         starts_at,
         ends_at,
         status,
         created_at,
         updated_at
       ) VALUES (
         $2,
         $1,
         $3,
         NULLIF($4, ''),
         $5,
         NULLIF($6, ''),
         $7::timestamptz,
         $8::timestamptz,
         $9,
         $10::timestamptz,
         $11::timestamptz
       )`,
      organizationId,
      [
        appointment.id,
        appointment.customerId,
        appointment.staffId,
        appointment.title,
        appointment.notes,
        appointment.startsAt,
        appointment.endsAt,
        appointment.status,
        appointment.createdAt,
        appointment.updatedAt
      ]
    );

    await context.persistence.queryByOrganization(
      `INSERT INTO appointment_activity (
         id,
         appointment_id,
         activity_type,
         activity_payload,
         created_at
       ) VALUES (
         $2,
         $3,
         $4,
         COALESCE($5::jsonb, '{}'::jsonb) || jsonb_build_object('organizationId', $1),
         $6::timestamptz
       )`,
      organizationId,
      [
        randomUUID(),
        appointment.id,
        "appointment.booked",
        JSON.stringify({
          appointmentId: appointment.id,
          customerId: appointment.customerId,
          startsAt: appointment.startsAt,
          status: appointment.status
        }),
        appointment.createdAt
      ]
    );
  } else {
    appointments.set(appointment.id, appointment);
  }

  await emitAppointmentEvent(
    context,
    "appointment.booked",
    {
      appointmentId: appointment.id,
      customerId: appointment.customerId,
      startsAt: appointment.startsAt,
      status: appointment.status
    },
    organizationId,
    appointment.createdAt
  );

  return {
    created: true,
    appointment
  };
};

const rescheduleAppointment: PluginHandler = async ({ params, body }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = (body ?? {}) as Record<string, unknown>;
  const appointmentId = String(routeParams.id ?? "");
  const organizationId = resolveOrganizationId(payload, undefined);

  if (context.persistence?.isDatabaseAvailable) {
    const result = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id,
         customer_id AS "customerId",
         COALESCE(staff_id, 'unassigned') AS "staffId",
         title,
         starts_at AS "startsAt",
         ends_at AS "endsAt",
         status,
         COALESCE(notes, '') AS notes,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM appointments
       WHERE organization_id = $1
         AND id = $2
       LIMIT 1`,
      organizationId,
      [appointmentId]
    );
    const row = result.rows[0];
    if (!row) {
      return {
        ok: false,
        error: "Appointment not found"
      };
    }

    const current = mapAppointmentRow(row);
    const now = new Date().toISOString();
    const next: AppointmentRecord = {
      ...current,
      startsAt: toIso(payload.startsAt, new Date(current.startsAt)),
      endsAt: toIso(payload.endsAt, new Date(current.endsAt)),
      updatedAt: now
    };

    await context.persistence.queryByOrganization(
      `UPDATE appointments
       SET starts_at = $3::timestamptz,
           ends_at = $4::timestamptz,
           updated_at = $5::timestamptz
       WHERE organization_id = $1
         AND id = $2`,
      organizationId,
      [next.id, next.startsAt, next.endsAt, next.updatedAt]
    );

    await context.persistence.queryByOrganization(
      `INSERT INTO appointment_activity (
         id,
         appointment_id,
         activity_type,
         activity_payload,
         created_at
       ) VALUES (
         $2,
         $3,
         $4,
         COALESCE($5::jsonb, '{}'::jsonb) || jsonb_build_object('organizationId', $1),
         $6::timestamptz
       )`,
      organizationId,
      [
        randomUUID(),
        next.id,
        "appointment.rescheduled",
        JSON.stringify({
          appointmentId: next.id,
          startsAt: next.startsAt,
          endsAt: next.endsAt
        }),
        now
      ]
    );

    await emitAppointmentEvent(
      context,
      "appointment.rescheduled",
      {
        appointmentId: next.id,
        startsAt: next.startsAt,
        endsAt: next.endsAt
      },
      organizationId,
      now
    );

    return {
      ok: true,
      appointment: next
    };
  }

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

  await emitAppointmentEvent(
    context,
    "appointment.rescheduled",
    {
      appointmentId,
      startsAt: next.startsAt,
      endsAt: next.endsAt
    },
    organizationId,
    now
  );

  return {
    ok: true,
    appointment: next
  };
};

const updateAppointmentStatus: PluginHandler = async ({ params, body }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = (body ?? {}) as Record<string, unknown>;
  const appointmentId = String(routeParams.id ?? "");
  const organizationId = resolveOrganizationId(payload, undefined);

  if (context.persistence?.isDatabaseAvailable) {
    const result = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id,
         customer_id AS "customerId",
         COALESCE(staff_id, 'unassigned') AS "staffId",
         title,
         starts_at AS "startsAt",
         ends_at AS "endsAt",
         status,
         COALESCE(notes, '') AS notes,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM appointments
       WHERE organization_id = $1
         AND id = $2
       LIMIT 1`,
      organizationId,
      [appointmentId]
    );
    const row = result.rows[0];
    if (!row) {
      return {
        ok: false,
        error: "Appointment not found"
      };
    }

    const current = mapAppointmentRow(row);
    const nextStatus = normalizeStatus(payload.status);
    const now = new Date().toISOString();
    const next: AppointmentRecord = {
      ...current,
      status: nextStatus,
      updatedAt: now
    };

    await context.persistence.queryByOrganization(
      `UPDATE appointments
       SET status = $3,
           updated_at = $4::timestamptz
       WHERE organization_id = $1
         AND id = $2`,
      organizationId,
      [next.id, next.status, next.updatedAt]
    );

    await context.persistence.queryByOrganization(
      `INSERT INTO appointment_activity (
         id,
         appointment_id,
         activity_type,
         activity_payload,
         created_at
       ) VALUES (
         $2,
         $3,
         $4,
         COALESCE($5::jsonb, '{}'::jsonb) || jsonb_build_object('organizationId', $1),
         $6::timestamptz
       )`,
      organizationId,
      [
        randomUUID(),
        next.id,
        "appointment.status.updated",
        JSON.stringify({ appointmentId: next.id, status: next.status }),
        now
      ]
    );

    await emitAppointmentEvent(
      context,
      "appointment.status.updated",
      {
        appointmentId: next.id,
        status: next.status
      },
      organizationId,
      now
    );

    if (nextStatus === "completed") {
      await context.persistence.queryByOrganization(
        `INSERT INTO appointment_activity (
           id,
           appointment_id,
           activity_type,
           activity_payload,
           created_at
         ) VALUES (
           $2,
           $3,
           $4,
           COALESCE($5::jsonb, '{}'::jsonb) || jsonb_build_object('organizationId', $1),
           $6::timestamptz
         )`,
        organizationId,
        [
          randomUUID(),
          next.id,
          "appointment.completed",
          JSON.stringify({ appointmentId: next.id, customerId: next.customerId }),
          now
        ]
      );

      await emitAppointmentEvent(
        context,
        "appointment.completed",
        {
          appointmentId: next.id,
          customerId: next.customerId
        },
        organizationId,
        now
      );
    }

    return {
      ok: true,
      appointment: next
    };
  }

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

  await emitAppointmentEvent(
    context,
    "appointment.status.updated",
    {
      appointmentId,
      status: next.status
    },
    organizationId,
    now
  );

  if (nextStatus === "completed") {
    await emitAppointmentEvent(
      context,
      "appointment.completed",
      {
        appointmentId,
        customerId: next.customerId
      },
      organizationId,
      now
    );
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




