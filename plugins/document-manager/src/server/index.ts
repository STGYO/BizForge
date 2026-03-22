import type {
  EventEnvelope,
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

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrganizationId(payload: Record<string, unknown>): string {
  return String(payload.organizationId ?? "org-1");
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

const listRecords: PluginHandler = async () => {
  return {
    plugin: typedManifest.name,
    documents: Array.from(documents.values())
  };
};

const createRecord: PluginHandler = async ({ body }, context) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const document: ManagedDocument = {
    id: makeId("doc"),
    customerId: String(payload.customerId ?? payload.entityId ?? "unlinked"),
    title: String(payload.title ?? "Untitled Document"),
    category: String(payload.category ?? "general"),
    visibility: normalizeVisibility(payload.visibility),
    latestVersion: 1,
    createdAt: now,
    updatedAt: now
  };
  const initialVersion: DocumentVersion = {
    id: makeId("ver"),
    documentId: document.id,
    version: 1,
    title: document.title,
    content: String(payload.content ?? ""),
    uploadedBy: String(payload.uploadedBy ?? "system"),
    createdAt: now
  };

  documents.set(document.id, document);
  versionsByDocument.set(document.id, [initialVersion]);

  const orgId = getOrganizationId(payload);
  await context.eventBus.publish(
    publishEvent(
      "document.created",
      {
        documentId: document.id,
        customerId: document.customerId,
        category: document.category,
        visibility: document.visibility
      },
      orgId,
      now,
      typedManifest.name
    )
  );
  await context.eventBus.publish(
    publishEvent(
      "document.version.created",
      {
        documentId: document.id,
        versionId: initialVersion.id,
        version: 1
      },
      orgId,
      now,
      typedManifest.name
    )
  );

  return {
    created: true,
    document,
    version: initialVersion
  };
};

const getDocument: PluginHandler = async ({ params }) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const documentId = String(routeParams.id ?? "");
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

const addVersion: PluginHandler = async ({ params, body }, context) => {
  const routeParams = (params ?? {}) as Record<string, unknown>;
  const payload = (body ?? {}) as Record<string, unknown>;
  const documentId = String(routeParams.id ?? "");
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

  await context.eventBus.publish(
    publishEvent(
      "document.version.created",
      {
        documentId,
        versionId: version.id,
        version: version.version
      },
      getOrganizationId(payload),
      now,
      typedManifest.name
    )
  );

  if (nextDocument.visibility === "shared") {
    await context.eventBus.publish(
      publishEvent(
        "document.shared",
        {
          documentId,
          customerId: nextDocument.customerId,
          version: nextDocument.latestVersion
        },
        getOrganizationId(payload),
        now,
        typedManifest.name
      )
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




