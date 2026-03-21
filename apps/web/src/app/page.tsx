import { DashboardShell, type DashboardPlugin } from "../components/dashboard-shell";

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

export default async function Page() {
  const { plugins, error } = await loadPlugins();
  return <DashboardShell plugins={plugins} pluginLoadError={error} />;
}
