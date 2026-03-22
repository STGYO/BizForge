"use client";

import Link from "next/link";
import { useState } from "react";

export interface DashboardPlugin {
  name: string;
  version: string;
  status: "enabled" | "disabled";
}

interface MarketplacePreviewPlugin {
  name: string;
  version: string;
  author: string;
  installed: boolean;
}

interface DashboardShellProps {
  plugins: DashboardPlugin[];
  pluginLoadError: string | null;
  marketplacePreview: MarketplacePreviewPlugin[];
  marketplaceLoadError: string | null;
}

export function DashboardShell({
  plugins,
  pluginLoadError,
  marketplacePreview,
  marketplaceLoadError
}: DashboardShellProps) {
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 rounded-3xl bg-white/70 p-4 shadow-lg backdrop-blur md:grid-cols-[260px_1fr] md:p-6">
        <aside className="rounded-2xl bg-shell p-4 text-white">
          <h1 className="font-display text-2xl">BizForge</h1>
          <p className="mt-1 text-sm text-white/70">Installed plugins</p>
          {pluginLoadError ? (
            <p className="mt-5 rounded-xl bg-red-500/20 px-3 py-2 text-sm text-red-100">
              {pluginLoadError}
            </p>
          ) : plugins.length === 0 ? (
            <p className="mt-5 rounded-xl bg-white/10 px-3 py-2 text-sm text-white/80">
              No plugins loaded.
            </p>
          ) : (
            <ul className="mt-5 space-y-2">
              {plugins.map((plugin) => (
                <li key={plugin.name} className="rounded-xl bg-white/10 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span>{plugin.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        plugin.status === "enabled"
                          ? "bg-emerald-400/30 text-emerald-100"
                          : "bg-amber-400/30 text-amber-100"
                      }`}
                    >
                      {plugin.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="space-y-4">
          <header className="rounded-2xl border border-black/10 bg-white p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <input
                className="w-full rounded-xl border border-black/10 bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none md:max-w-sm"
                placeholder="Search contacts, workflows, events"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setMarketplaceOpen(true)}
                  className="rounded-xl bg-shell px-4 py-2 text-sm font-semibold text-white"
                >
                  Marketplace
                </button>
                <button className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white">
                  New Automation
                </button>
              </div>
            </div>
          </header>

          <main className="grid gap-4 md:grid-cols-2">
            <article className="rounded-2xl border border-black/10 bg-white p-4">
              <h2 className="font-display text-lg">Plugin Workspace</h2>
              <p className="mt-2 text-sm text-black/70">
                Plugin UIs render here through dynamic extension slots registered by plugin manifests.
              </p>
            </article>
            <article className="rounded-2xl border border-black/10 bg-white p-4">
              <h2 className="font-display text-lg">Automation Engine</h2>
              <p className="mt-2 text-sm text-black/70">
                Build rules with trigger, condition, and action chains that invoke plugin capabilities.
              </p>
            </article>
          </main>
        </section>
      </div>

      {marketplaceOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl">Marketplace Preview</h2>
              <button
                onClick={() => setMarketplaceOpen(false)}
                className="rounded-lg border border-black/10 px-3 py-1 text-sm"
              >
                Close
              </button>
            </div>

            {marketplaceLoadError ? (
              <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                {marketplaceLoadError}
              </p>
            ) : marketplacePreview.length === 0 ? (
              <p className="mt-4 rounded-xl bg-black/5 px-3 py-2 text-sm text-black/70">
                No marketplace plugins available.
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {marketplacePreview.map((plugin) => (
                  <li key={plugin.name} className="rounded-xl border border-black/10 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{plugin.name}</p>
                        <p className="text-xs text-black/60">
                          v{plugin.version} by {plugin.author}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          plugin.installed
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {plugin.installed ? "installed" : "available"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 flex justify-end">
              <Link
                href="/marketplace"
                className="rounded-xl bg-shell px-4 py-2 text-sm font-semibold text-white"
              >
                Open Full Marketplace
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
