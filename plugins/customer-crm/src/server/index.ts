import type {
  EventEnvelope,
  PluginManifest,
  PluginPermission,
  PluginRegistration,
  PluginHandler
} from "@bizforge/plugin-sdk";
import { createHash, randomUUID } from "node:crypto";
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
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";

function makeId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function toDeterministicUuid(value: string): string {
  const digest = createHash("sha1").update(value).digest("hex").slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

function normalizeUuid(value: unknown, fallback: string): string {
  const candidate = String(value ?? "").trim();
  if (!candidate) {
    return fallback;
  }

  return UUID_PATTERN.test(candidate) ? candidate.toLowerCase() : toDeterministicUuid(candidate);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry))
    .filter((entry) => entry.length > 0);
}

function asIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value ?? new Date().toISOString());
}

function resolveOrganizationId(payload: Record<string, unknown>, headers: unknown): string {
  const source =
    payload.organizationId ??
    (headers as Record<string, unknown> | undefined)?.["x-bizforge-org-id"] ??
    DEFAULT_ORGANIZATION_ID;

  return normalizeUuid(source, DEFAULT_ORGANIZATION_ID);
}

function mapCustomerRecord(row: Record<string, unknown>): CustomerRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    phone: String(row.phone ?? ""),
    email: String(row.email ?? ""),
    tags: asStringArray(row.tags),
    notes: asStringArray(row.notes),
    lastInteractionAt: asIsoString(row.lastInteractionAt),
    createdAt: asIsoString(row.createdAt),
    updatedAt: asIsoString(row.lastInteractionAt)
  };
}

function mapInteractionRecord(row: Record<string, unknown>): InteractionRecord {
  return {
    id: String(row.id),
    customerId: String(row.customerId),
    type: String(row.type ?? "note"),
    message: String(row.message ?? ""),
    createdAt: asIsoString(row.createdAt)
  };
}

async function emitPluginEvent(
  context: Parameters<PluginHandler>[1],
  input: Omit<EventEnvelope, "eventId" | "occurredAt" | "schemaVersion">
): Promise<EventEnvelope> {
  if (context.persistence) {
    return await context.persistence.writeEvent({
      eventType: input.eventType,
      organizationId: input.organizationId,
      sourcePlugin: input.sourcePlugin ?? typedManifest.name,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      payload: input.payload
    });
  }

  const event: EventEnvelope = {
    eventId: makeId("evt"),
    eventType: input.eventType,
    occurredAt: new Date().toISOString(),
    organizationId: input.organizationId,
    sourcePlugin: input.sourcePlugin ?? typedManifest.name,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    schemaVersion: 1,
    payload: input.payload
  };

  await context.eventBus.publish(event);
  return event;
}

const listRecords: PluginHandler = async ({ query, headers }, context) => {
  const payload = (query ?? {}) as Record<string, unknown>;
  const organizationId = resolveOrganizationId(payload, headers);

  if (context.persistence?.isDatabaseAvailable) {
    const result = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         full_name AS name,
         COALESCE(phone, '') AS phone,
         COALESCE(email, '') AS email,
         tags,
         notes,
         last_interaction_at AS "lastInteractionAt",
         created_at AS "createdAt"
       FROM customer_crm_customers
       WHERE organization_id = $1::uuid
       ORDER BY created_at DESC`,
      organizationId
    );

    return {
      plugin: typedManifest.name,
      customers: result.rows.map((row) => mapCustomerRecord(row))
    };
  }

  return {
    plugin: typedManifest.name,
    customers: Array.from(customers.values())
  };
};

const createRecord: PluginHandler = async ({ body }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const organizationId = resolveOrganizationId(payload, undefined);
  const customer: CustomerRecord = {
    id: randomUUID(),
    name: String(payload.name ?? ""),
    phone: String(payload.phone ?? ""),
    email: String(payload.email ?? ""),
    tags: asStringArray(payload.tags),
    notes: asStringArray(payload.notes),
    lastInteractionAt: now,
    createdAt: now,
    updatedAt: now
  };

  if (context.persistence?.isDatabaseAvailable) {
    await context.persistence.queryByOrganization(
      `INSERT INTO customer_crm_customers (
         id,
         organization_id,
         full_name,
         phone,
         email,
         tags,
         notes,
         last_interaction_at,
         created_at
       ) VALUES (
         $2::uuid,
         $1::uuid,
         $3,
         NULLIF($4, ''),
         NULLIF($5, ''),
         $6::jsonb,
         $7::jsonb,
         $8::timestamptz,
         $9::timestamptz
       )`,
      organizationId,
      [
        customer.id,
        customer.name,
        customer.phone,
        customer.email,
        JSON.stringify(customer.tags),
        JSON.stringify(customer.notes),
        customer.lastInteractionAt,
        customer.createdAt
      ]
    );
  } else {
    customers.set(customer.id, customer);
    interactionsByCustomer.set(customer.id, []);
  }

  await emitPluginEvent(context, {
    eventType: "customer.created",
    organizationId,
    sourcePlugin: typedManifest.name,
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

const getCustomerWithContext: PluginHandler = async ({ params, query, headers }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = (query ?? {}) as Record<string, unknown>;
  const customerId = String(routeParams.id ?? "");
  const normalizedCustomerId = normalizeUuid(customerId, randomUUID());
  const organizationId = resolveOrganizationId(payload, headers);

  if (context.persistence?.isDatabaseAvailable) {
    const customerResult = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         full_name AS name,
         COALESCE(phone, '') AS phone,
         COALESCE(email, '') AS email,
         tags,
         notes,
         last_interaction_at AS "lastInteractionAt",
         created_at AS "createdAt"
       FROM customer_crm_customers
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
       LIMIT 1`,
      organizationId,
      [normalizedCustomerId]
    );

    const customerRow = customerResult.rows[0];
    if (!customerRow) {
      return {
        found: false,
        error: "Customer not found"
      };
    }

    const interactionsResult = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         customer_id::text AS "customerId",
         interaction_type AS type,
         message,
         created_at AS "createdAt"
       FROM customer_crm_interactions
       WHERE organization_id = $1::uuid
         AND customer_id = $2::uuid
       ORDER BY created_at DESC`,
      organizationId,
      [normalizedCustomerId]
    );

    return {
      found: true,
      customer: mapCustomerRecord(customerRow),
      interactions: interactionsResult.rows.map((row) => mapInteractionRecord(row))
    };
  }

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

const addInteraction: PluginHandler = async ({ params, body, headers }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = (body ?? {}) as Record<string, unknown>;
  const customerId = String(routeParams.id ?? "");
  const normalizedCustomerId = normalizeUuid(customerId, randomUUID());
  const organizationId = resolveOrganizationId(payload, headers);

  if (context.persistence?.isDatabaseAvailable) {
    const existingResult = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         full_name AS name,
         COALESCE(phone, '') AS phone,
         COALESCE(email, '') AS email,
         tags,
         notes,
         last_interaction_at AS "lastInteractionAt",
         created_at AS "createdAt"
       FROM customer_crm_customers
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
       LIMIT 1`,
      organizationId,
      [normalizedCustomerId]
    );

    const customerRow = existingResult.rows[0];
    if (!customerRow) {
      return {
        added: false,
        error: "Customer not found"
      };
    }

    const interaction: InteractionRecord = {
      id: randomUUID(),
      customerId: normalizedCustomerId,
      type: String(payload.type ?? "note"),
      message: String(payload.message ?? ""),
      createdAt: new Date().toISOString()
    };

    await context.persistence.queryByOrganization(
      `INSERT INTO customer_crm_interactions (
         id,
         organization_id,
         customer_id,
         interaction_type,
         message,
         created_at
       ) VALUES (
         $2::uuid,
         $1::uuid,
         $3::uuid,
         $4,
         $5,
         $6::timestamptz
       )`,
      organizationId,
      [
        interaction.id,
        interaction.customerId,
        interaction.type,
        interaction.message,
        interaction.createdAt
      ]
    );

    await context.persistence.queryByOrganization(
      `UPDATE customer_crm_customers
       SET last_interaction_at = $3::timestamptz
       WHERE organization_id = $1::uuid
         AND id = $2::uuid`,
      organizationId,
      [interaction.customerId, interaction.createdAt]
    );

    const updatedCustomer = mapCustomerRecord({
      ...customerRow,
      lastInteractionAt: interaction.createdAt
    });

    await emitPluginEvent(context, {
      eventType: "customer.interacted",
      organizationId,
      sourcePlugin: typedManifest.name,
      payload: {
        customerId: interaction.customerId,
        interactionId: interaction.id,
        type: interaction.type
      }
    });

    return {
      added: true,
      interaction,
      customer: updatedCustomer
    };
  }

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

  await emitPluginEvent(context, {
    eventType: "customer.interacted",
    organizationId,
    sourcePlugin: typedManifest.name,
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

const pluginActionWithContext: PluginHandler = async ({ actionInput, headers }, context) => {
  const payload = (actionInput ?? {}) as Record<string, unknown>;
  const rawCustomerId = payload.entityId ?? payload.customerId;
  const organizationId = resolveOrganizationId(payload, headers);

  if (!rawCustomerId) {
    return {
      ok: false,
      error: "customerId is required"
    };
  }

  if (!context.persistence?.isDatabaseAvailable) {
    return await pluginAction(
      {
        body: undefined,
        query: undefined,
        params: undefined,
        headers,
        actionInput: payload
      },
      context
    );
  }

  const customerId = normalizeUuid(rawCustomerId, randomUUID());
  const existingResult = await context.persistence.queryByOrganization<Record<string, unknown>>(
    `SELECT
       id::text AS id,
       full_name AS name,
       COALESCE(phone, '') AS phone,
       COALESCE(email, '') AS email,
       tags,
       notes,
       last_interaction_at AS "lastInteractionAt",
       created_at AS "createdAt"
     FROM customer_crm_customers
     WHERE organization_id = $1::uuid
       AND id = $2::uuid
     LIMIT 1`,
    organizationId,
    [customerId]
  );
  const existing = existingResult.rows[0];
  const now = new Date().toISOString();

  const next: CustomerRecord = {
    id: customerId,
    name: String(payload.name ?? existing?.name ?? "Unknown"),
    phone: String(payload.phone ?? existing?.phone ?? ""),
    email: String(payload.email ?? existing?.email ?? ""),
    tags: Array.isArray(payload.tags) ? asStringArray(payload.tags) : asStringArray(existing?.tags),
    notes: Array.isArray(payload.notes) ? asStringArray(payload.notes) : asStringArray(existing?.notes),
    lastInteractionAt: asIsoString(existing?.lastInteractionAt ?? now),
    createdAt: asIsoString(existing?.createdAt ?? now),
    updatedAt: now
  };

  await context.persistence.queryByOrganization(
    `INSERT INTO customer_crm_customers (
       id,
       organization_id,
       full_name,
       phone,
       email,
       tags,
       notes,
       last_interaction_at,
       created_at
     ) VALUES (
       $2::uuid,
       $1::uuid,
       $3,
       NULLIF($4, ''),
       NULLIF($5, ''),
       $6::jsonb,
       $7::jsonb,
       $8::timestamptz,
       $9::timestamptz
     )
     ON CONFLICT (id) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           phone = EXCLUDED.phone,
           email = EXCLUDED.email,
           tags = EXCLUDED.tags,
           notes = EXCLUDED.notes,
           last_interaction_at = EXCLUDED.last_interaction_at`,
    organizationId,
    [
      next.id,
      next.name,
      next.phone,
      next.email,
      JSON.stringify(next.tags),
      JSON.stringify(next.notes),
      next.lastInteractionAt,
      next.createdAt
    ]
  );

  return {
    ok: true,
    plugin: typedManifest.name,
    action: "upsert_customer_profile",
    customer: next
  };
};

const getCustomerHandler: PluginHandler = async (input, context) => {
  return await getCustomerWithContext(input, context);
};

const pluginActionHandler: PluginHandler = async (input, context) => {
  return await pluginActionWithContext(input, context);
};

export const pluginRegistration: PluginRegistration = {
  manifest: typedManifest,
  handlers: {
    listRecords,
    createRecord,
    getCustomer: getCustomerHandler,
    addInteraction,
    pluginAction: pluginActionHandler
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




