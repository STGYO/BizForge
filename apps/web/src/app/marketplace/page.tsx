import Link from "next/link";
import { revalidatePath } from "next/cache";
import { fetchCoreApi } from "../../lib/core-api-fetch";
import { getDefaultOrganizationId } from "../../lib/organization";

interface MarketplacePlugin {
  name: string;
  version: string;
  author: string;
  description?: string;
  status: "enabled" | "disabled";
  permissions: string[];
  installed: boolean;
}

async function loadMarketplace(): Promise<{ plugins: MarketplacePlugin[]; error: string | null }> {
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

    const plugins = (await response.json()) as MarketplacePlugin[];
    return { plugins, error: null };
  } catch {
    return { plugins: [], error: "Unable to connect to core API" };
  }
}

async function installPlugin(formData: FormData): Promise<void> {
  "use server";

  const pluginName = formData.get("pluginName");
  if (typeof pluginName !== "string" || pluginName.length === 0) {
    return;
  }

  const organizationId = getDefaultOrganizationId();

  await fetchCoreApi(`/api/marketplace/plugins/${pluginName}/install`, {
    method: "POST",
    headers: {
      "x-bizforge-org-id": organizationId
    }
  });

  revalidatePath("/");
  revalidatePath("/marketplace");
}

async function uninstallPlugin(formData: FormData): Promise<void> {
  "use server";

  const pluginName = formData.get("pluginName");
  if (typeof pluginName !== "string" || pluginName.length === 0) {
    return;
  }

  const organizationId = getDefaultOrganizationId();

  await fetchCoreApi(`/api/marketplace/plugins/${pluginName}/uninstall`, {
    method: "POST",
    headers: {
      "x-bizforge-org-id": organizationId
    }
  });

  revalidatePath("/");
  revalidatePath("/marketplace");
}

export default async function MarketplacePage() {
  const { plugins, error } = await loadMarketplace();

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-4 rounded-3xl bg-white/70 p-4 shadow-lg backdrop-blur md:p-6">
        <header className="flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="font-display text-2xl">Marketplace</h1>
            <p className="text-sm text-black/70">
              Discover local BizForge plugins and manage organization installs.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold"
          >
            Back To Dashboard
          </Link>
        </header>

        {error ? (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        ) : plugins.length === 0 ? (
          <p className="rounded-xl bg-black/5 px-4 py-3 text-sm text-black/70">
            No marketplace plugins available.
          </p>
        ) : (
          <section className="grid gap-4 md:grid-cols-2">
            {plugins.map((plugin) => (
              <article key={plugin.name} className="rounded-2xl border border-black/10 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg">{plugin.name}</h2>
                    <p className="text-sm text-black/60">
                      v{plugin.version} by {plugin.author}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      plugin.status === "enabled"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    runtime: {plugin.status}
                  </span>
                </div>

                <p className="mt-3 text-sm text-black/70">
                  {plugin.description ?? "No description provided by plugin author."}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {plugin.permissions.map((permission) => (
                    <span
                      key={`${plugin.name}-${permission}`}
                      className="rounded-full bg-black/5 px-2 py-0.5 text-xs text-black/70"
                    >
                      {permission}
                    </span>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <span className="text-sm text-black/60">
                    {plugin.installed ? "Installed for this organization" : "Not installed"}
                  </span>

                  {plugin.installed ? (
                    <form action={uninstallPlugin}>
                      <input type="hidden" name="pluginName" value={plugin.name} />
                      <button
                        type="submit"
                        className="rounded-xl border border-black/10 px-4 py-2 text-sm font-semibold"
                      >
                        Uninstall
                      </button>
                    </form>
                  ) : (
                    <form action={installPlugin}>
                      <input type="hidden" name="pluginName" value={plugin.name} />
                      <button
                        type="submit"
                        className="rounded-xl bg-shell px-4 py-2 text-sm font-semibold text-white"
                      >
                        Install
                      </button>
                    </form>
                  )}
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
