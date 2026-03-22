import { DashboardShell, type DashboardPlugin } from "../components/dashboard-shell";

interface MarketplacePreviewPlugin {
  name: string;
  version: string;
  author: string;
  installed: boolean;
}

async function loadPlugins(): Promise<{ plugins: DashboardPlugin[]; error: string | null }> {
  const baseUrl = process.env.NEXT_PUBLIC_CORE_API_URL ?? "http://localhost:4000";

  try {
    const response = await fetch(`${baseUrl}/api/plugins`, {
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
  const baseUrl = process.env.NEXT_PUBLIC_CORE_API_URL ?? "http://localhost:4000";
  const organizationId = process.env.BIZFORGE_DEFAULT_ORG_ID ?? "org-demo";

  try {
    const response = await fetch(`${baseUrl}/api/marketplace/plugins`, {
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

export default async function Page() {
  const [{ plugins, error }, { plugins: marketplacePlugins, error: marketplaceError }] =
    await Promise.all([loadPlugins(), loadMarketplacePreview()]);

  return (
    <DashboardShell
      plugins={plugins}
      pluginLoadError={error}
      marketplacePreview={marketplacePlugins}
      marketplaceLoadError={marketplaceError}
    />
  );
}
