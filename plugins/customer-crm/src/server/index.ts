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

interface CustomerRecord {
  id: string;
  name: string;
  phone: string;
  email: string;
  tags: string[];
  notes: string[];
  lastInteractionAt: string;
  createdAt: string;
  updatedAt: string;
}

interface InteractionRecord {
  id: string;
  customerId: string;
  type: string;
  message: string;
  createdAt: string;
}

const customers = new Map<string, CustomerRecord>();
const interactionsByCustomer = new Map<string, InteractionRecord[]>();

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrganizationId(payload: Record<string, unknown>): string {
  return String(payload.organizationId ?? "org-1");
}

const listRecords: PluginHandler = async () => {
  return {
    plugin: typedManifest.name,
    customers: Array.from(customers.values())
  };
};

const createRecord: PluginHandler = async ({ body }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const customer: CustomerRecord = {
    id: makeId("cust"),
    name: String(payload.name ?? ""),
    phone: String(payload.phone ?? ""),
    email: String(payload.email ?? ""),
    tags: Array.isArray(payload.tags)
      ? payload.tags.map((entry) => String(entry)).filter((entry) => entry.length > 0)
      : [],
    notes: Array.isArray(payload.notes)
      ? payload.notes.map((entry) => String(entry)).filter((entry) => entry.length > 0)
      : [],
    lastInteractionAt: now,
    createdAt: now,
    updatedAt: now
  };

  customers.set(customer.id, customer);
  interactionsByCustomer.set(customer.id, []);

  await context.eventBus.publish({
    eventId: makeId("evt"),
    eventType: "customer.created",
    occurredAt: now,
    organizationId: getOrganizationId(payload),
    sourcePlugin: typedManifest.name,
    schemaVersion: 1,
    payload: {
      customerId: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone
    }
  });

  return {
    created: true,
    customer
  };
};

const getCustomer: PluginHandler = async ({ params }) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const customerId = String(routeParams.id ?? "");
  const customer = customers.get(customerId);

  if (!customer) {
    return {
      found: false,
      error: "Customer not found"
    };
  }

  return {
    found: true,
    customer,
    interactions: interactionsByCustomer.get(customerId) ?? []
  };
};

const addInteraction: PluginHandler = async ({ params, body }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = (body ?? {}) as Record<string, unknown>;
  const customerId = String(routeParams.id ?? "");
  const customer = customers.get(customerId);

  if (!customer) {
    return {
      added: false,
      error: "Customer not found"
    };
  }

  const interaction: InteractionRecord = {
    id: makeId("int"),
    customerId,
    type: String(payload.type ?? "note"),
    message: String(payload.message ?? ""),
    createdAt: new Date().toISOString()
  };

  const currentInteractions = interactionsByCustomer.get(customerId) ?? [];
  interactionsByCustomer.set(customerId, [interaction, ...currentInteractions]);

  const nextCustomer: CustomerRecord = {
    ...customer,
    lastInteractionAt: interaction.createdAt,
    updatedAt: interaction.createdAt
  };
  customers.set(customerId, nextCustomer);

  await context.eventBus.publish({
    eventId: makeId("evt"),
    eventType: "customer.interacted",
    occurredAt: interaction.createdAt,
    organizationId: getOrganizationId(payload),
    sourcePlugin: typedManifest.name,
    schemaVersion: 1,
    payload: {
      customerId,
      interactionId: interaction.id,
      type: interaction.type
    }
  });

  return {
    added: true,
    interaction,
    customer: nextCustomer
  };
};

const pluginAction: PluginHandler = async ({ actionInput }) => {
  const payload = (actionInput ?? {}) as Record<string, unknown>;
  const customerId = String(payload.entityId ?? payload.customerId ?? "");
  if (!customerId) {
    return {
      ok: false,
      error: "customerId is required"
    };
  }

  const existing = customers.get(customerId);
  const now = new Date().toISOString();
  const next: CustomerRecord = {
    id: existing?.id ?? customerId,
    name: String(payload.name ?? existing?.name ?? "Unknown"),
    phone: String(payload.phone ?? existing?.phone ?? ""),
    email: String(payload.email ?? existing?.email ?? ""),
    tags: Array.isArray(payload.tags)
      ? payload.tags.map((entry) => String(entry)).filter((entry) => entry.length > 0)
      : (existing?.tags ?? []),
    notes: Array.isArray(payload.notes)
      ? payload.notes.map((entry) => String(entry)).filter((entry) => entry.length > 0)
      : (existing?.notes ?? []),
    lastInteractionAt: existing?.lastInteractionAt ?? now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  customers.set(next.id, next);
  if (!interactionsByCustomer.has(next.id)) {
    interactionsByCustomer.set(next.id, []);
  }

  return {
    ok: true,
    plugin: typedManifest.name,
    action: "upsert_customer_profile",
    customer: next
  };
};

export const pluginRegistration: PluginRegistration = {
  manifest: typedManifest,
  handlers: {
    listRecords,
    createRecord,
    getCustomer,
    addInteraction,
    pluginAction
  },
  routes: [
    {
      method: "GET",
      path: "/records",
      handlerName: "listRecords"
    },
    {
      method: "POST",
      path: "/records",
      handlerName: "createRecord"
    },
    {
      method: "GET",
      path: "/customers/:id",
      handlerName: "getCustomer"
    },
    {
      method: "POST",
      path: "/customers/:id/interactions",
      handlerName: "addInteraction"
    }
  ],
  triggers: [
    {
      key: "customer_created",
      displayName: "Customer Created",
      eventType: "customer.created"
    },
    {
      key: "customer_interacted",
      displayName: "Customer Interacted",
      eventType: "customer.interacted"
    }
  ],
  actions: [
    {
      key: "upsert_customer_profile",
      displayName: "Customer CRM Action",
      handlerName: "pluginAction",
      inputSchema: {
        type: "object",
        properties: {
          entityId: { type: "string" },
          note: { type: "string" }
        },
        required: ["entityId"]
      }
    }
  ]
};




