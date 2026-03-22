import { AutomationConsole } from "../../components/automation-console";
import {
  DEFAULT_ORG_ID,
  fetchAutomationCatalog,
  fetchAutomationRules
} from "../../lib/automation-api";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const [catalogResult, rulesResult] = await Promise.allSettled([
    fetchAutomationCatalog(),
    fetchAutomationRules(DEFAULT_ORG_ID)
  ]);

  const catalog =
    catalogResult.status === "fulfilled"
      ? catalogResult.value
      : {
          triggers: [],
          actions: []
        };

  const rules = rulesResult.status === "fulfilled" ? rulesResult.value : [];
  const loadError =
    catalogResult.status === "rejected"
      ? catalogResult.reason instanceof Error
        ? catalogResult.reason.message
        : "Unable to load automation catalog"
      : rulesResult.status === "rejected"
        ? rulesResult.reason instanceof Error
          ? rulesResult.reason.message
          : "Unable to load automation rules"
        : null;

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-4 rounded-3xl bg-white/75 p-4 shadow-lg backdrop-blur md:p-6">
        <header className="rounded-2xl border border-black/10 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-black/60">Automation Studio</p>
          <h1 className="mt-1 font-display text-3xl">Rules and Simulation</h1>
          <p className="mt-2 text-sm text-black/70">
            Organization context: {DEFAULT_ORG_ID} (temporary static mapping)
          </p>
        </header>

        {loadError ? (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {loadError}
          </section>
        ) : null}

        <AutomationConsole initialRules={rules} catalog={catalog} />
      </div>
    </div>
  );
}
