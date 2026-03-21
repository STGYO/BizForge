import type {
  PluginManifest,
  PluginPermission,
  PluginRegistration
} from "@bizforge/plugin-sdk";
import manifest from "../../plugin.json" assert { type: "json" };

const typedManifest: PluginManifest = {
  ...manifest,
  permissions: manifest.permissions as PluginPermission[]
};

export const appointmentManagerPlugin: PluginRegistration = {
  manifest: typedManifest,
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
