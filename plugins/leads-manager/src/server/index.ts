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

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrganizationId(payload: Record<string, unknown>): string {
  return String(payload.organizationId ?? "org-1");
}

function normalizeStage(value: unknown): LeadStage {
  const candidate = String(value ?? "new").toLowerCase();
  if (candidate === "contacted" || candidate === "negotiation" || candidate === "closed") {
    return candidate;
  }

  return "new";
}

const listRecords: PluginHandler = async () => {
  return {
    plugin: typedManifest.name,
    leads: Array.from(leads.values())
  };
};

const createRecord: PluginHandler = async ({ body }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const lead: LeadRecord = {
    id: makeId("lead"),
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

  leads.set(lead.id, lead);

  await context.eventBus.publish({
    eventId: makeId("evt"),
    eventType: "lead.generated",
    occurredAt: now,
    organizationId: getOrganizationId(payload),
    sourcePlugin: typedManifest.name,
    schemaVersion: 1,
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

  await context.eventBus.publish({
    eventId: makeId("evt"),
    eventType: "lead.pipeline.updated",
    occurredAt: now,
    organizationId: getOrganizationId(payload),
    sourcePlugin: typedManifest.name,
    schemaVersion: 1,
    payload: {
      leadId,
      stage: nextLead.stage,
      score: nextLead.score
    }
  });

  if (nextLead.stage === "closed") {
    await context.eventBus.publish({
      eventId: makeId("evt"),
      eventType: "lead.converted",
      occurredAt: now,
      organizationId: getOrganizationId(payload),
      sourcePlugin: typedManifest.name,
      schemaVersion: 1,
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

const pluginAction: PluginHandler = async ({ actionInput }) => {
  const payload = (actionInput ?? {}) as Record<string, unknown>;
  const leadId = String(payload.entityId ?? payload.leadId ?? "");
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




