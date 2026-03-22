import { fetchCoreApi } from "./core-api-fetch";

export interface PluginUISlotDescriptor {
  displayName: string;
  layout?: "panel" | "card" | "modal" | "sidebar";
  componentRequired?: boolean;
}

export interface PluginUIMetadata {
  pluginName: string;
  version: string;
  status: "enabled" | "disabled";
  ui?: {
    slots?: Record<string, PluginUISlotDescriptor>;
    entry?: string;
    exposedComponents?: string[];
  };
  uiComponents?: {
    pluginName: string;
    componentNames: string[];
    slots: Array<{
      pluginName: string;
      slotName: string;
      displayName: string;
      layout: "panel" | "card" | "modal" | "sidebar";
      componentRequired: boolean;
    }>;
    componentUrl: string;
    integrity?: string;
  };
}

export async function fetchPluginUIMetadata(pluginName: string): Promise<PluginUIMetadata | null> {
  try {
    const response = await fetchCoreApi(`/api/plugins/${pluginName}/meta`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const normalized: PluginUIMetadata = {
      pluginName: String(data.pluginName ?? data.name ?? pluginName),
      version: String(data.version ?? "0.0.0"),
      status: data.status === "disabled" ? "disabled" : "enabled"
    };

    if (typeof data.ui === "object" && data.ui !== null) {
      normalized.ui = data.ui as NonNullable<PluginUIMetadata["ui"]>;
    }

    if (typeof data.uiComponents === "object" && data.uiComponents !== null) {
      normalized.uiComponents =
        data.uiComponents as NonNullable<PluginUIMetadata["uiComponents"]>;
    }

    return normalized;
  } catch (error) {
    console.error(`Failed to fetch UI metadata for plugin ${pluginName}:`, error);
    return null;
  }
}

export async function fetchAllPluginUIMetadata(): Promise<PluginUIMetadata[]> {
  try {
    const response = await fetchCoreApi("/api/plugins", {
      cache: "no-store"
    });

    if (!response.ok) {
      return [];
    }

    const plugins = (await response.json()) as Array<{
      manifest: { name: string };
      status: "enabled" | "disabled";
    }>;

    const metadata: PluginUIMetadata[] = [];
    for (const plugin of plugins) {
      const uiMeta = await fetchPluginUIMetadata(plugin.manifest.name);
      if (uiMeta) {
        metadata.push(uiMeta);
      }
    }

    return metadata;
  } catch (error) {
    // The dashboard treats plugin UI metadata as best-effort; avoid noisy runtime overlays.
    if (process.env.NODE_ENV !== "production") {
      console.warn("Plugin UI metadata unavailable; continuing without plugin panels.", error);
    }
    return [];
  }
}

export function getPluginUIComponent(
  metadata: PluginUIMetadata | null,
  slotName: string
): boolean {
  if (!metadata?.ui?.slots) return false;
  return slotName in metadata.ui.slots;
}
