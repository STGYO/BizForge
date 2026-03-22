import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { PluginRegistration } from "@bizforge/plugin-sdk";
import { InMemoryEventBus } from "../services/event-bus";
import { registerPluginRoutes } from "./plugin-routes";
import type { BizForgeRuntime } from "../server";

function buildRuntime(options?: {
  pluginStatus?: "enabled" | "disabled";
  withHandler?: boolean;
  throwFromHandler?: boolean;
}): BizForgeRuntime {
  const pluginStatus = options?.pluginStatus ?? "enabled";
  const withHandler = options?.withHandler ?? true;
  const throwFromHandler = options?.throwFromHandler ?? false;
  const eventBus = new InMemoryEventBus();

  const registration: PluginRegistration = {
    manifest: {
      name: "appointment-manager",
      version: "1.0.0",
      author: "BizForge",
      permissions: ["automation", "calendar"],
      activationEvents: ["onStartup"],
      backendEntry: "dist/server/index.js",
      frontendEntry: "dist/ui/index.js"
    },
    routes: [
      {
        method: "GET",
        path: "/appointments",
        handlerName: "listAppointments"
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
        inputSchema: {}
      }
    ],
    handlers: withHandler
      ? {
          listAppointments: async () => {
            if (throwFromHandler) {
              throw new Error("boom");
            }

            return { appointments: [{ id: "appt-1" }] };
          },
          scheduleFollowUp: async () => ({ ok: true })
        }
      : {}
  };

  return {
    eventBus,
    persistence: "in-memory",
    pluginDatabase: {
      mode: "in-memory",
      isAvailable: false,
      query: async () => {
        throw new Error("plugin database unavailable in test runtime");
      }
    },
    automationEngine: {} as BizForgeRuntime["automationEngine"],
    pluginEngine: {
      list: () => [
        {
          manifest: registration.manifest,
          registration,
          rootPath: "plugins/appointment-manager",
          status: pluginStatus
        }
      ]
    } as BizForgeRuntime["pluginEngine"]
  };
}

test("mounts plugin route and executes handler", async () => {
  const app = Fastify();

  await registerPluginRoutes(app, buildRuntime({ pluginStatus: "enabled" }));

  const response = await app.inject({
    method: "GET",
    url: "/api/plugins/appointment-manager/appointments"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { appointments: Array<{ id: string }> };
  assert.equal(body.appointments.length, 1);
  assert.equal(body.appointments[0]?.id, "appt-1");

  await app.close();
});

test("returns 409 for disabled plugin route", async () => {
  const app = Fastify();

  await registerPluginRoutes(app, buildRuntime({ pluginStatus: "disabled" }));

  const response = await app.inject({
    method: "GET",
    url: "/api/plugins/appointment-manager/appointments"
  });

  assert.equal(response.statusCode, 409);
  const body = response.json() as { error: string; message: string };
  assert.equal(body.error, "plugin_disabled");
  assert.match(body.message, /disabled/i);

  await app.close();
});

test("returns 500 handler_not_found when route handler is missing", async () => {
  const app = Fastify();

  await registerPluginRoutes(app, buildRuntime({ pluginStatus: "enabled", withHandler: false }));

  const response = await app.inject({
    method: "GET",
    url: "/api/plugins/appointment-manager/appointments"
  });

  assert.equal(response.statusCode, 500);
  const body = response.json() as { error: string; message: string };
  assert.equal(body.error, "handler_not_found");
  assert.match(body.message, /not found/i);

  await app.close();
});

test("returns 500 handler_execution_failed when handler throws", async () => {
  const app = Fastify();

  await registerPluginRoutes(app, buildRuntime({ pluginStatus: "enabled", throwFromHandler: true }));

  const response = await app.inject({
    method: "GET",
    url: "/api/plugins/appointment-manager/appointments"
  });

  assert.equal(response.statusCode, 500);
  const body = response.json() as { error: string; message: string };
  assert.equal(body.error, "handler_execution_failed");
  assert.match(body.message, /execution failed/i);

  await app.close();
});

test("exposes plugin metadata with capabilities", async () => {
  const app = Fastify();

  await registerPluginRoutes(app, buildRuntime({ pluginStatus: "enabled" }));

  const response = await app.inject({
    method: "GET",
    url: "/api/plugins/appointment-manager/meta"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    name: string;
    status: string;
    routes: Array<{ path: string }>;
    triggers: Array<{ eventType: string }>;
    actions: Array<{ key: string }>;
  };

  assert.equal(body.name, "appointment-manager");
  assert.equal(body.status, "enabled");
  assert.equal(body.routes.length, 1);
  assert.equal(body.routes[0]?.path, "/appointments");
  assert.equal(body.triggers[0]?.eventType, "appointment.booked");
  assert.equal(body.actions[0]?.key, "schedule_follow_up");

  await app.close();
});
