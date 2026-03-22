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

type Visibility = "private" | "internal" | "shared";

interface DocumentVersion {
  id: string;
  documentId: string;
  version: number;
  title: string;
  content: string;
  uploadedBy: string;
  createdAt: string;
}

interface ManagedDocument {
  id: string;
  customerId: string;
  title: string;
  category: string;
  visibility: Visibility;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}

const documents = new Map<string, ManagedDocument>();
const versionsByDocument = new Map<string, DocumentVersion[]>();
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

function normalizeVisibility(value: unknown): Visibility {
  const candidate = String(value ?? "private").toLowerCase();
  if (candidate === "internal" || candidate === "shared") {
    return candidate;
  }

  return "private";
}

function publishEvent(
  type: string,
  payload: Record<string, unknown>,
  organizationId: string,
  occurredAt: string,
  sourcePlugin: string
): EventEnvelope<Record<string, unknown>> {
  return {
    eventId: makeId("evt"),
    eventType: type,
    occurredAt,
    organizationId,
    sourcePlugin,
    schemaVersion: 1,
    payload
  };
}

async function emitDocumentEvent(
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

  await context.eventBus.publish(
    publishEvent(type, payload, organizationId, occurredAt, typedManifest.name)
  );
}

function mapDocumentRow(row: Record<string, unknown>): ManagedDocument {
  return {
    id: String(row.id),
    customerId: String(row.customerId ?? "unlinked"),
    title: String(row.title ?? "Untitled Document"),
    category: String(row.category ?? "general"),
    visibility: normalizeVisibility(row.visibility),
    latestVersion: Number(row.latestVersion ?? 1),
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? new Date().toISOString())
  };
}

function mapVersionRow(row: Record<string, unknown>): DocumentVersion {
  return {
    id: String(row.id),
    documentId: String(row.documentId),
    version: Number(row.version ?? 1),
    title: String(row.title ?? "Untitled Document"),
    content: String(row.content ?? ""),
    uploadedBy: String(row.uploadedBy ?? "system"),
    createdAt: String(row.createdAt ?? new Date().toISOString())
  };
}

const listRecords: PluginHandler = async ({ query, headers }, context) => {
  const payload = (query ?? {}) as Record<string, unknown>;
  const organizationId = resolveOrganizationId(payload, headers);

  if (context.persistence?.isDatabaseAvailable) {
    const result = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         customer_id AS "customerId",
         title,
         category,
         visibility,
         latest_version AS "latestVersion",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM managed_documents
       WHERE organization_id = $1::uuid
       ORDER BY updated_at DESC`,
      organizationId
    );

    return {
      plugin: typedManifest.name,
      documents: result.rows.map((row) => mapDocumentRow(row))
    };
  }

  return {
    plugin: typedManifest.name,
    documents: Array.from(documents.values())
  };
};

const createRecord: PluginHandler = async ({ body, headers }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const organizationId = resolveOrganizationId(payload, headers);
  const document: ManagedDocument = {
    id: randomUUID(),
    customerId: String(payload.customerId ?? payload.entityId ?? "unlinked"),
    title: String(payload.title ?? "Untitled Document"),
    category: String(payload.category ?? "general"),
    visibility: normalizeVisibility(payload.visibility),
    latestVersion: 1,
    createdAt: now,
    updatedAt: now
  };
  const initialVersion: DocumentVersion = {
    id: randomUUID(),
    documentId: document.id,
    version: 1,
    title: document.title,
    content: String(payload.content ?? ""),
    uploadedBy: String(payload.uploadedBy ?? "system"),
    createdAt: now
  };

  if (context.persistence?.isDatabaseAvailable) {
    await context.persistence.queryByOrganization(
      `INSERT INTO managed_documents (
         id,
         organization_id,
         title,
         customer_id,
         category,
         visibility,
         latest_version,
         created_at,
         updated_at
       ) VALUES (
         $2::uuid,
         $1::uuid,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8::timestamptz,
         $9::timestamptz
       )`,
      organizationId,
      [
        document.id,
        document.title,
        document.customerId,
        document.category,
        document.visibility,
        document.latestVersion,
        document.createdAt,
        document.updatedAt
      ]
    );

    await context.persistence.queryByOrganization(
      `INSERT INTO document_versions (
         id,
         document_id,
         version_number,
         title,
         content,
         uploaded_by,
         created_at
       ) VALUES (
         $2::uuid,
         $3::uuid,
         $4,
         $5,
         $6,
         $7,
         $8::timestamptz
       )`,
      organizationId,
      [
        initialVersion.id,
        initialVersion.documentId,
        initialVersion.version,
        initialVersion.title,
        initialVersion.content,
        initialVersion.uploadedBy,
        initialVersion.createdAt
      ]
    );
  } else {
    documents.set(document.id, document);
    versionsByDocument.set(document.id, [initialVersion]);
  }

  await emitDocumentEvent(
    context,
    "document.created",
    {
      documentId: document.id,
      customerId: document.customerId,
      category: document.category,
      visibility: document.visibility
    },
    organizationId,
    now
  );
  await emitDocumentEvent(
    context,
    "document.version.created",
    {
      documentId: document.id,
      versionId: initialVersion.id,
      version: 1
    },
    organizationId,
    now
  );

  return {
    created: true,
    document,
    version: initialVersion
  };
};

const getDocument: PluginHandler = async ({ params, query, headers }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = (query ?? {}) as Record<string, unknown>;
  const documentId = String(routeParams.id ?? "");
  const organizationId = resolveOrganizationId(payload, headers);

  if (context.persistence?.isDatabaseAvailable) {
    const documentRows = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         customer_id AS "customerId",
         title,
         category,
         visibility,
         latest_version AS "latestVersion",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM managed_documents
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
       LIMIT 1`,
      organizationId,
      [documentId]
    );

    const row = documentRows.rows[0];
    if (!row) {
      return {
        found: false,
        error: "Document not found"
      };
    }

    const versionRows = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         v.id::text AS id,
         v.document_id::text AS "documentId",
         v.version_number AS version,
         v.title,
         v.content,
         v.uploaded_by AS "uploadedBy",
         v.created_at AS "createdAt"
       FROM document_versions v
       INNER JOIN managed_documents d ON d.id = v.document_id
       WHERE d.organization_id = $1::uuid
         AND v.document_id = $2::uuid
       ORDER BY v.version_number DESC`,
      organizationId,
      [documentId]
    );

    return {
      found: true,
      document: mapDocumentRow(row),
      versions: versionRows.rows.map((entry) => mapVersionRow(entry))
    };
  }

  const document = documents.get(documentId);

  if (!document) {
    return {
      found: false,
      error: "Document not found"
    };
  }

  return {
    found: true,
    document,
    versions: versionsByDocument.get(documentId) ?? []
  };
};

const addVersion: PluginHandler = async ({ params, body, headers }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = (body ?? {}) as Record<string, unknown>;
  const documentId = String(routeParams.id ?? "");
  const organizationId = resolveOrganizationId(payload, headers);

  if (context.persistence?.isDatabaseAvailable) {
    const documentRows = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT
         id::text AS id,
         customer_id AS "customerId",
         title,
         category,
         visibility,
         latest_version AS "latestVersion",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM managed_documents
       WHERE organization_id = $1::uuid
         AND id = $2::uuid
       LIMIT 1`,
      organizationId,
      [documentId]
    );

    const documentRow = documentRows.rows[0];
    if (!documentRow) {
      return {
        ok: false,
        error: "Document not found"
      };
    }

    const document = mapDocumentRow(documentRow);
    const versionResult = await context.persistence.queryByOrganization<Record<string, unknown>>(
      `SELECT COALESCE(MAX(v.version_number), 0) AS "maxVersion"
       FROM document_versions v
       INNER JOIN managed_documents d ON d.id = v.document_id
       WHERE d.organization_id = $1::uuid
         AND v.document_id = $2::uuid`,
      organizationId,
      [documentId]
    );
    const nextVersionNumber = Number(versionResult.rows[0]?.maxVersion ?? 0) + 1;
    const now = new Date().toISOString();
    const version: DocumentVersion = {
      id: randomUUID(),
      documentId,
      version: nextVersionNumber,
      title: String(payload.title ?? document.title),
      content: String(payload.content ?? ""),
      uploadedBy: String(payload.uploadedBy ?? "system"),
      createdAt: now
    };

    await context.persistence.queryByOrganization(
      `INSERT INTO document_versions (
         id,
         document_id,
         version_number,
         title,
         content,
         uploaded_by,
         created_at
       ) VALUES (
         $2::uuid,
         $3::uuid,
         $4,
         $5,
         $6,
         $7,
         $8::timestamptz
       )`,
      organizationId,
      [
        version.id,
        version.documentId,
        version.version,
        version.title,
        version.content,
        version.uploadedBy,
        version.createdAt
      ]
    );

    const nextDocument: ManagedDocument = {
      ...document,
      title: version.title,
      latestVersion: nextVersionNumber,
      updatedAt: now,
      visibility: normalizeVisibility(payload.visibility ?? document.visibility)
    };

    await context.persistence.queryByOrganization(
      `UPDATE managed_documents
       SET title = $3,
           latest_version = $4,
           visibility = $5,
           updated_at = $6::timestamptz
       WHERE organization_id = $1::uuid
         AND id = $2::uuid`,
      organizationId,
      [
        nextDocument.id,
        nextDocument.title,
        nextDocument.latestVersion,
        nextDocument.visibility,
        nextDocument.updatedAt
      ]
    );

    await emitDocumentEvent(
      context,
      "document.version.created",
      {
        documentId,
        versionId: version.id,
        version: version.version
      },
      organizationId,
      now
    );

    if (nextDocument.visibility === "shared") {
      await emitDocumentEvent(
        context,
        "document.shared",
        {
          documentId,
          customerId: nextDocument.customerId,
          version: nextDocument.latestVersion
        },
        organizationId,
        now
      );
    }

    return {
      ok: true,
      document: nextDocument,
      version
    };
  }

  const document = documents.get(documentId);

  if (!document) {
    return {
      ok: false,
      error: "Document not found"
    };
  }

  const existing = versionsByDocument.get(documentId) ?? [];
  const nextVersionNumber = existing.length + 1;
  const now = new Date().toISOString();
  const version: DocumentVersion = {
    id: makeId("ver"),
    documentId,
    version: nextVersionNumber,
    title: String(payload.title ?? document.title),
    content: String(payload.content ?? ""),
    uploadedBy: String(payload.uploadedBy ?? "system"),
    createdAt: now
  };
  versionsByDocument.set(documentId, [version, ...existing]);

  const nextDocument: ManagedDocument = {
    ...document,
    title: version.title,
    latestVersion: nextVersionNumber,
    updatedAt: now,
    visibility: normalizeVisibility(payload.visibility ?? document.visibility)
  };
  documents.set(documentId, nextDocument);

  await emitDocumentEvent(
    context,
    "document.version.created",
    {
      documentId,
      versionId: version.id,
      version: version.version
    },
    organizationId,
    now
  );

  if (nextDocument.visibility === "shared") {
    await emitDocumentEvent(
      context,
      "document.shared",
      {
        documentId,
        customerId: nextDocument.customerId,
        version: nextDocument.latestVersion
      },
      organizationId,
      now
    );
  }

  return {
    ok: true,
    document: nextDocument,
    version
  };
};

const pluginAction: PluginHandler = async ({ actionInput }, context) => {
  const payload = (actionInput ?? {}) as Record<string, unknown>;
  const result = (await createRecord(
    {
      body: {
        ...payload,
        customerId: payload.entityId ?? payload.customerId,
        visibility: payload.visibility ?? "internal"
      },
      query: {},
      params: {},
      headers: {}
    },
    context
  )) as Record<string, unknown>;

  return {
    ok: true,
    plugin: typedManifest.name,
    action: "attach_document_to_customer",
    document: result.document
  };
};

export const pluginRegistration: PluginRegistration = {
  manifest: typedManifest,
  handlers: {
    listRecords,
    createRecord,
    getDocument,
    addVersion,
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
      path: "/documents/:id",
      handlerName: "getDocument"
    },
    {
      method: "POST",
      path: "/documents/:id/versions",
      handlerName: "addVersion"
    }
  ],
  triggers: [
    {
      key: "document_created",
      displayName: "Document Created",
      eventType: "document.created"
    },
    {
      key: "document_version_created",
      displayName: "Document Manager Updated",
      eventType: "document.version.created"
    },
    {
      key: "document_shared",
      displayName: "Document Shared",
      eventType: "document.shared"
    }
  ],
  actions: [
    {
      key: "attach_document_to_customer",
      displayName: "Document Manager Action",
      handlerName: "pluginAction",
      inputSchema: {
        type: "object",
        properties: {
          entityId: { type: "string" },
          title: { type: "string" },
          content: { type: "string" },
          category: { type: "string" },
          visibility: {
            type: "string",
            enum: ["private", "internal", "shared"]
          }
        },
        required: ["entityId", "title"]
      }
    }
  ]
};




