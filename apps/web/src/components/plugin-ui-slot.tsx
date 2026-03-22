import React, { useCallback, useEffect, useRef, useState } from "react";
import type { PluginUIMetadata } from "../lib/plugin-ui-metadata";

interface PluginUISlotProps {
  slotName: string;
  layout?: "panel" | "card" | "modal" | "sidebar";
  plugins: PluginUIMetadata[];
  organizationId: string;
}

interface PluginUIFrameProps {
  pluginName: string;
  componentUrl: string;
  organizationId: string;
  onError: (error: string) => void;
}

const PluginUIFrame: React.FC<PluginUIFrameProps> = ({ pluginName, componentUrl, organizationId, onError }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const iframe = document.createElement("iframe");
    iframe.src = componentUrl;
    iframe.sandbox.add(
      "allow-scripts",
      "allow-same-origin",
      "allow-popups",
      "allow-popups-to-escape-sandbox"
    );
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";

    const handleLoad = () => {
      setLoading(false);
      // Send org context to iframe
      iframe.contentWindow?.postMessage(
        {
          type: "plugin_context",
          organizationId,
          pluginName
        },
        "*"
      );
    };

    const handleError = () => {
      setLoading(false);
      setFailed(true);
      onError(`Failed to load component from ${componentUrl}`);
    };

    iframe.onload = handleLoad;
    iframe.onerror = handleError;

    containerRef.current.appendChild(iframe);

    return () => {
      if (containerRef.current?.contains(iframe)) {
        containerRef.current.removeChild(iframe);
      }
    };
  }, [componentUrl, organizationId, pluginName, onError]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-black/5 rounded-lg p-4">
        <p className="text-sm text-black/60">Loading {pluginName}...</p>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">Failed to load {pluginName} UI</p>
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: "100%", height: "400px" }} />;
};

export const PluginUISlot: React.FC<PluginUISlotProps> = ({
  slotName,
  layout = "panel",
  plugins,
  organizationId
}) => {
  const [frameErrors, setFrameErrors] = useState<Record<string, string>>({});

  const handleFrameError = useCallback((pluginName: string, error: string) => {
    setFrameErrors((prev) => ({ ...prev, [pluginName]: error }));
  }, []);

  const pluginsForSlot = plugins.filter((plugin) => {
    if (!plugin.ui?.slots) return false;
    return slotName in plugin.ui.slots;
  });

  if (pluginsForSlot.length === 0) {
    return null;
  }

  const gridClass = layout === "sidebar" ? "grid-cols-1" : layout === "modal" ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2";

  return (
    <div className={`grid gap-4 ${gridClass}`}>
      {pluginsForSlot.map((plugin) => {
        const slotConfig = plugin.ui?.slots?.[slotName];
        if (!slotConfig) return null;

        return (
          <div
            key={plugin.pluginName}
            className={`rounded-2xl border border-black/10 bg-white p-4 ${
              frameErrors[plugin.pluginName] ? "bg-red-50" : ""
            }`}
          >
            <h3 className="font-display text-sm mb-3">{slotConfig.displayName || plugin.pluginName}</h3>
            {frameErrors[plugin.pluginName] ? (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                <p className="text-xs text-red-700">{frameErrors[plugin.pluginName]}</p>
              </div>
            ) : plugin.uiComponents?.componentUrl ? (
              <PluginUIFrame
                pluginName={plugin.pluginName}
                componentUrl={plugin.uiComponents.componentUrl}
                organizationId={organizationId}
                onError={(error) => handleFrameError(plugin.pluginName, error)}
              />
            ) : (
              <div className="text-xs text-black/50 p-4 bg-black/5 rounded">
                Plugin UI not available
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
