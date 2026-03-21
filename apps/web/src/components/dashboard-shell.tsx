const installedPlugins = [
  "Lead Generator",
  "Appointment Manager",
  "CRM",
  "WhatsApp Automation",
  "Invoice Generator",
  "Analytics"
];

export function DashboardShell() {
  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 rounded-3xl bg-white/70 p-4 shadow-lg backdrop-blur md:grid-cols-[260px_1fr] md:p-6">
        <aside className="rounded-2xl bg-shell p-4 text-white">
          <h1 className="font-display text-2xl">BizForge</h1>
          <p className="mt-1 text-sm text-white/70">Installed plugins</p>
          <ul className="mt-5 space-y-2">
            {installedPlugins.map((plugin) => (
              <li key={plugin} className="rounded-xl bg-white/10 px-3 py-2 text-sm">
                {plugin}
              </li>
            ))}
          </ul>
        </aside>

        <section className="space-y-4">
          <header className="rounded-2xl border border-black/10 bg-white p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <input
                className="w-full rounded-xl border border-black/10 bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none md:max-w-sm"
                placeholder="Search contacts, workflows, events"
              />
              <div className="flex gap-2">
                <button className="rounded-xl bg-shell px-4 py-2 text-sm font-semibold text-white">
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
    </div>
  );
}
