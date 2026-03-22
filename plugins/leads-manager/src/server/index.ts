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

type LeadStage = "new" | "contacted" | "negotiation" | "closed";

interface LeadRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  source: string;
  owner: string;
  stage: LeadStage;
  score: number;
  createdAt: string;
  updatedAt: string;
}

const leads = new Map<string, LeadRecord>();
const stageOrder: LeadStage[] = ["new", "contacted", "negotiation", "closed"];
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

function resolveOrganizationId(payload: Record<string, unknown>, headers: unknown): string {
  const source =
    payload.organizationId ??
    (headers as Record<string, unknown> | undefined)?.["x-bizforge-org-id"] ??
    DEFAULT_ORGANIZATION_ID;
  return normalizeUuid(source, DEFAULT_ORGANIZATION_ID);
}

function asIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value ?? new Date().toISOString());
}

function mapLeadRow(row: Record<string, unknown>): LeadRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    email: String(row.email ?? ""),
    phone: String(row.phone ?? ""),
    source: String(row.source ?? "manual"),
    owner: String(row.owner ?? "unassigned"),
    stage: normalizeStage(row.stage),
    score: Number(row.score ?? 0),
    createdAt: asIsoString(row.createdAt),
    updatedAt: asIsoString(row.updatedAt ?? row.createdAt)
  };
}

async function emitLeadEvent(
  context: Parameters<PluginHandler>[1],
  input: Omit<EventEnvelope, "eventId" | "occurredAt" | "schemaVersion">
): Promise<void> {
  if (context.persistence) {
    await context.persistence.writeEvent({
      eventType: input.eventType,
      organizationId: input.organizationId,
      sourcePlugin: input.sourcePlugin ?? typedManifest.name,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      payload: input.payload
    });
    return;
  }

  await context.eventBus.publish({
    eventId: makeId("evt"),
    eventType: input.eventType,
    occurredAt: new Date().toISOString(),
    organizationId: input.organizationId,
    sourcePlugin: input.sourcePlugin ?? typedManifest.name,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    schemaVersion: 1,
    payload: input.payload
  });
}

function normalizeStage(value: unknown): LeadStage {
  const candidate = String(value ?? "new").toLowerCase();
  if (candidate === "contacted" || candidate === "negotiation" || candidate === "closed") {
    return candidate;
  }

  return "new";
}

const listRecords: PluginHandler = async ({ query, headers }, context) => {
  const payload = (query ?? {}) as Record<string, unknown>;
  const organizationId = resolveOrganizationId(payload, headers);

  if (context.persistence?.isDatabaseAvailable) {
    const result = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         full_name AS name,
         COALESCE(email, '') AS email,
         COALESCE(phone, '') AS phone,
         source,
         owner_name AS owner,
         stage,
         score,
         created_at AS "createdAt",
         created_at AS "updatedAt"
       FROM leads_manager_leads
       WHERE organization_id = $1::uuid
       ORDER BY created_at DESC`,
      organizationId
    );

    return {
      plugin: typedManifest.name,
      leads: result.rows.map((row) => mapLeadRow(row))
    };
  }

  return {
    plugin: typedManifest.name,
    leads: Array.from(leads.values())
  };
};

const createRecord: PluginHandler = async ({ body, headers }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const organizationId = resolveOrganizationId(payload, headers);
  const lead: LeadRecord = {
    id: randomUUID(),
    name: String(payload.name ?? ""),
    email: String(payload.email ?? ""),
    phone: String(payload.phone ?? ""),
    source: String(payload.source ?? "manual"),
    owner: String(payload.owner ?? "unassigned"),
    stage: normalizeStage(payload.stage),
    score: Number(payload.score ?? 0),
    createdAt: now,
    updatedAt: now
  };

  if (context.persistence?.isDatabaseAvailable) {
    await context.persistence.queryByOrganization(
      `INSERT INTO leads_manager_leads (
         id,
         organization_id,
         full_name,
         email,
         phone,
         source,
         owner_name,
         stage,
         score,
         created_at
       ) VALUES (
         $2::uuid,
         $1::uuid,
         $3,
         NULLIF($4, ''),
         NULLIF($5, ''),
         $6,
         $7,
         $8,
         $9,
         $10::timestamptz
       )`,
      organizationId,
      [
        lead.id,
        lead.name,
        lead.email,
        lead.phone,
        lead.source,
        lead.owner,
        lead.stage,
        lead.score,
        lead.createdAt
      ]
    );
  } else {
    leads.set(lead.id, lead);
  }

  await emitLeadEvent(context, {
    eventType: "lead.generated",
    organizationId,
    sourcePlugin: typedManifest.name,
    payload: {
      leadId: lead.id,
      stage: lead.stage,
      score: lead.score,
      source: lead.source
    }
  });

  return {
    created: true,
    lead
  };
};

const advanceLeadStage: PluginHandler = async ({ actionInput, body }, context) => {
  const payload = ((actionInput ?? body) ?? {}) as Record<string, unknown>;
  const leadId = String(payload.entityId ?? payload.leadId ?? "");
  const organizationId = resolveOrganizationId(payload, undefined);

  if (context.persistence?.isDatabaseAvailable) {
    const normalizedLeadId = normalizeUuid(leadId, randomUUID());
    const leadResult = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         full_name AS name,
         COALESCE(email, '') AS email,
         COALESCE(phone, '') AS phone,
         source,
         owner_name AS owner,
         stage,
         score,
         created_at AS "createdAt",
         created_at AS "updatedAt"
       FROM leads_manager_leads
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
       LIMIT 1`,
      organizationId,
      [normalizedLeadId]
    );

    const currentRow = leadResult.rows[0];
    if (!currentRow) {
      return {
        ok: false,
        error: "Lead not found"
      };
    }

    const current = mapLeadRow(currentRow);
    const desiredStage = payload.stage ? normalizeStage(payload.stage) : null;
    const currentIndex = stageOrder.indexOf(current.stage);
    const nextStage =
      desiredStage ?? stageOrder[Math.min(currentIndex + 1, stageOrder.length - 1)] ?? "closed";
    const now = new Date().toISOString();
    const nextLead: LeadRecord = {
      ...current,
      stage: nextStage,
      updatedAt: now
    };

    await context.persistence.queryByOrganization(
      `UPDATE leads_manager_leads
       SET stage = $3,
           score = $4
       WHERE organization_id = $1::uuid
         AND id = $2::uuid`,
      organizationId,
      [normalizedLeadId, nextLead.stage, nextLead.score]
    );

    await context.persistence.queryByOrganization(
      `INSERT INTO leads_manager_stage_history (
         id,
         organization_id,
         lead_id,
         previous_stage,
         next_stage,
         changed_at
       ) VALUES (
         $2::uuid,
         $1::uuid,
         $3::uuid,
         $4,
         $5,
         $6::timestamptz
       )`,
      organizationId,
      [randomUUID(), normalizedLeadId, current.stage, nextLead.stage, now]
    );

    await emitLeadEvent(context, {
      eventType: "lead.pipeline.updated",
      organizationId,
      sourcePlugin: typedManifest.name,
      payload: {
        leadId: normalizedLeadId,
        stage: nextLead.stage,
        score: nextLead.score
      }
    });

    if (nextLead.stage === "closed") {
      await emitLeadEvent(context, {
        eventType: "lead.converted",
        organizationId,
        sourcePlugin: typedManifest.name,
        payload: {
          leadId: normalizedLeadId,
          customerHint: {
            name: nextLead.name,
            email: nextLead.email,
            phone: nextLead.phone
          }
        }
      });
    }

    return {
      ok: true,
      lead: nextLead
    };
  }

  if (!leadId || !leads.has(leadId)) {
    return {
      ok: false,
      error: "Lead not found"
    };
  }

  const current = leads.get(leadId) as LeadRecord;
  const desiredStage = payload.stage ? normalizeStage(payload.stage) : null;
  const currentIndex = stageOrder.indexOf(current.stage);
  const nextStage =
    desiredStage ?? stageOrder[Math.min(currentIndex + 1, stageOrder.length - 1)] ?? "closed";
  const now = new Date().toISOString();
  const nextLead: LeadRecord = {
    ...current,
    stage: nextStage,
    updatedAt: now
  };

  leads.set(leadId, nextLead);

  await emitLeadEvent(context, {
    eventType: "lead.pipeline.updated",
    organizationId,
    sourcePlugin: typedManifest.name,
    payload: {
      leadId,
      stage: nextLead.stage,
      score: nextLead.score
    }
  });

  if (nextLead.stage === "closed") {
    await emitLeadEvent(context, {
      eventType: "lead.converted",
      organizationId,
      sourcePlugin: typedManifest.name,
      payload: {
        leadId,
        customerHint: {
          name: nextLead.name,
          email: nextLead.email,
          phone: nextLead.phone
        }
      }
    });
  }

  return {
    ok: true,
    lead: nextLead
  };
};

const pluginAction: PluginHandler = async ({ actionInput }, context) => {
  const payload = (actionInput ?? {}) as Record<string, unknown>;
  const leadId = String(payload.entityId ?? payload.leadId ?? "");
  const organizationId = resolveOrganizationId(payload, undefined);

  if (context.persistence?.isDatabaseAvailable) {
    const normalizedLeadId = normalizeUuid(leadId, randomUUID());
    const result = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         full_name AS name,
         COALESCE(email, '') AS email,
         COALESCE(phone, '') AS phone,
         source,
         owner_name AS owner,
         stage,
         score,
         created_at AS "createdAt",
         created_at AS "updatedAt"
       FROM leads_manager_leads
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
       LIMIT 1`,
      organizationId,
      [normalizedLeadId]
    );

    const currentRow = result.rows[0];
    if (!currentRow) {
      return {
        ok: false,
        error: "Lead not found"
      };
    }

    const current = mapLeadRow(currentRow);
    const nextScore = Number(payload.scoreDelta ?? 5) + current.score;
    const updated: LeadRecord = {
      ...current,
      score: nextScore,
      updatedAt: new Date().toISOString()
    };

    await context.persistence.queryByOrganization(
      `UPDATE leads_manager_leads
       SET score = $3
       WHERE organization_id = $1::uuid
         AND id = $2::uuid`,
      organizationId,
      [normalizedLeadId, updated.score]
    );

    return {
      ok: true,
      plugin: typedManifest.name,
      action: "advance_lead_stage",
      lead: updated
    };
  }

  if (!leadId || !leads.has(leadId)) {
    return {
      ok: false,
      error: "Lead not found"
    };
  }

  const lead = leads.get(leadId) as LeadRecord;
  const nextScore = Number(payload.scoreDelta ?? 5) + lead.score;
  const updated: LeadRecord = {
    ...lead,
    score: nextScore,
    updatedAt: new Date().toISOString()
  };
  leads.set(leadId, updated);

  return {
    ok: true,
    plugin: typedManifest.name,
    action: "advance_lead_stage",
    lead: updated
  };
};

export const pluginRegistration: PluginRegistration = {
  manifest: typedManifest,
  handlers: {
    listRecords,
    createRecord,
    advanceLeadStage,
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
      method: "POST",
      path: "/leads/advance",
      handlerName: "advanceLeadStage"
    }
  ],
  triggers: [
    {
      key: "lead_generated",
      displayName: "Lead Generated",
      eventType: "lead.generated"
    },
    {
      key: "lead_pipeline_updated",
      displayName: "Lead Pipeline Updated",
      eventType: "lead.pipeline.updated"
    },
    {
      key: "lead_converted",
      displayName: "Lead Converted",
      eventType: "lead.converted"
    }
  ],
  actions: [
    {
      key: "advance_lead_stage",
      displayName: "Leads Manager Action",
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




