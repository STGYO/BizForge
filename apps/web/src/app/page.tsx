import { DashboardShell, type DashboardPlugin } from "../components/dashboard-shell";
import type { AutomationCatalog } from "../lib/automation-api";
import { fetchCoreApi } from "../lib/core-api-fetch";
import { getDefaultOrganizationId } from "../lib/organization";

interface RuntimeDeadLetter {
  id: string;
  eventType: string;
  eventId: string;
  organizationId: string;
  handlerId: string;
  errorMessage: string;
  failedAt: string;
}

interface RuntimeDiagnostics {
  persistence: string;
  pluginLoad: unknown;
  eventDelivery: {
    publishedCount: number;
    deliveredCount: number;
    failedDeliveryCount: number;
    subscriberCount: number;
    subscribersByEventType: Record<string, number>;
    deadLetters: RuntimeDeadLetter[];
  } | null;
}

interface MarketplacePreviewPlugin {
  name: string;
  version: string;
  author: string;
  installed: boolean;
}

async function loadPlugins(): Promise<{ plugins: DashboardPlugin[]; error: string | null }> {
  try {
    const response = await fetchCoreApi("/api/plugins", {
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        plugins: [],
        error: `Unable to load plugins (${response.status})`
      };
    }

    const data = (await response.json()) as Array<{
      manifest: { name: string; version: string };
      status: "enabled" | "disabled";
    }>;

    return {
      plugins: data.map((item) => ({
        name: item.manifest.name,
        version: item.manifest.version,
        status: item.status
      })),
      error: null
    };
  } catch {
    return {
      plugins: [],
      error: "Unable to connect to core API"
    };
  }
}

async function loadMarketplacePreview(): Promise<{
  plugins: MarketplacePreviewPlugin[];
  error: string | null;
}> {
  const organizationId = getDefaultOrganizationId();

  try {
    const response = await fetchCoreApi("/api/marketplace/plugins", {
      cache: "no-store",
      headers: {
        "x-bizforge-org-id": organizationId
      }
    });

    if (!response.ok) {
      return {
        plugins: [],
        error: `Unable to load marketplace (${response.status})`
      };
    }

    const data = (await response.json()) as Array<{
      name: string;
      version: string;
      author: string;
      installed: boolean;
    }>;

    return {
      plugins: data,
      error: null
    };
  } catch {
    return {
      plugins: [],
      error: "Unable to connect to core API"
    };
  }
}

async function loadAutomationCatalog(): Promise<{
  catalog: AutomationCatalog | null;
  error: string | null;
}> {
  try {
    const response = await fetchCoreApi("/api/automation/catalog", {
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        catalog: null,
        error: `Unable to load automation catalog (${response.status})`
      };
    }

    const data = (await response.json()) as AutomationCatalog;
    return {
      catalog: data,
      error: null
    };
  } catch {
    return {
      catalog: null,
      error: "Unable to connect to core API"
    };
  }
}

async function loadRuntimeDiagnostics(): Promise<{
  diagnostics: RuntimeDiagnostics | null;
  error: string | null;
}> {
  try {
    const response = await fetchCoreApi("/api/runtime/diagnostics", {
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        diagnostics: null,
        error: `Unable to load runtime diagnostics (${response.status})`
      };
    }

    const data = (await response.json()) as RuntimeDiagnostics;
    return {
      diagnostics: data,
      error: null
    };
  } catch {
    return {
      diagnostics: null,
      error: "Unable to connect to core API"
    };
  }
}

export default async function Page() {
  const organizationId = getDefaultOrganizationId();
  const [
    { plugins, error },
    { plugins: marketplacePlugins, error: marketplaceError },
    { catalog: automationCatalog, error: automationCatalogError },
    { diagnostics: runtimeDiagnostics, error: runtimeDiagnosticsError }
  ] = await Promise.all([
    loadPlugins(),
    loadMarketplacePreview(),
    loadAutomationCatalog(),
    loadRuntimeDiagnostics()
  ]);

  return (
    <DashboardShell
      organizationId={organizationId}
      plugins={plugins}
      pluginLoadError={error}
      marketplacePreview={marketplacePlugins}
      marketplaceLoadError={marketplaceError}
      automationCatalog={automationCatalog}
      automationCatalogLoadError={automationCatalogError}
      runtimeDiagnostics={runtimeDiagnostics}
      runtimeDiagnosticsLoadError={runtimeDiagnosticsError}
    />
  );
}
