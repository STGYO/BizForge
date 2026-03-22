"use client";

import { useMemo, useState } from "react";
import {
  type AutomationCatalog,
  type AutomationRule,
  createAutomationRule,
  deleteAutomationRule,
  setAutomationRuleEnabled,
  simulateAutomationRule
} from "../lib/automation-api";

interface AutomationConsoleProps {
  initialRules: AutomationRule[];
  catalog: AutomationCatalog;
}

export function AutomationConsole({ initialRules, catalog }: AutomationConsoleProps) {
  const [rules, setRules] = useState<AutomationRule[]>(initialRules);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulationMessage, setSimulationMessage] = useState<string | null>(null);

  const [triggerEvent, setTriggerEvent] = useState(catalog.triggers[0]?.eventType ?? "");
  const [conditionField, setConditionField] = useState("source");
  const [conditionEquals, setConditionEquals] = useState("web");
  const [actionSelection, setActionSelection] = useState(
    catalog.actions.length > 0 ? `${catalog.actions[0]?.plugin}:${catalog.actions[0]?.key}` : ""
  );
  const [actionInputJson, setActionInputJson] = useState('{"customerId":"cust-1","offsetHours":24}');

  const selectedAction = useMemo(() => {
    const [plugin, actionKey] = actionSelection.split(":");
    return { plugin: plugin ?? "", actionKey: actionKey ?? "" };
  }, [actionSelection]);

  async function handleCreateRule(): Promise<void> {
    setError(null);
    setSimulationMessage(null);

    if (!triggerEvent || !selectedAction.plugin || !selectedAction.actionKey) {
      setError("Choose a trigger and action before creating a rule.");
      return;
    }

    let parsedInput: Record<string, unknown>;
    try {
      const parsed = JSON.parse(actionInputJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Action input must be a JSON object");
      }
      parsedInput = parsed as Record<string, unknown>;
    } catch {
      setError("Action input must be valid JSON object text.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await createAutomationRule({
        triggerEvent,
        enabled: true,
        conditions: [
          {
            field: conditionField,
            equals: conditionEquals
          }
        ],
        actions: [
          {
            plugin: selectedAction.plugin,
            actionKey: selectedAction.actionKey,
            input: parsedInput
          }
        ]
      });

      setRules((current) => [created, ...current]);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create rule");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleEnabled(rule: AutomationRule): Promise<void> {
    setError(null);
    setSimulationMessage(null);

    try {
      const updated = await setAutomationRuleEnabled(rule.id, !rule.enabled);
      setRules((current) => current.map((item) => (item.id === rule.id ? updated : item)));
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Failed to update rule status");
    }
  }

  async function handleDeleteRule(rule: AutomationRule): Promise<void> {
    setError(null);
    setSimulationMessage(null);

    try {
      await deleteAutomationRule(rule.id);
      setRules((current) => current.filter((item) => item.id !== rule.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete rule");
    }
  }

  async function handleSimulateRule(rule: AutomationRule): Promise<void> {
    setError(null);
    setSimulationMessage(null);

    const samplePayload: Record<string, unknown> = {
      source: "web",
      customerId: "cust-1"
    };

    try {
      const result = await simulateAutomationRule(rule.id, samplePayload);
      if (!result.matched) {
        setSimulationMessage(
          result.errors.length > 0
            ? `Simulation failed: ${result.errors.join(", ")}`
            : "Simulation did not match rule conditions."
        );
        return;
      }

      setSimulationMessage(`Simulation matched. ${result.actionsTriggered} action(s) would run.`);
    } catch (simulationError) {
      setError(
        simulationError instanceof Error ? simulationError.message : "Failed to simulate rule"
      );
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <h2 className="font-display text-xl">Create Automation</h2>
        <p className="mt-2 text-sm text-black/70">
          Bootstrap flow for rule creation using trigger, condition, and plugin action.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-black/70">Trigger Event</span>
            <select
              className="w-full rounded-xl border border-black/10 bg-surface px-3 py-2"
              value={triggerEvent}
              onChange={(event) => setTriggerEvent(event.target.value)}
            >
              {catalog.triggers.map((trigger) => (
                <option key={`${trigger.plugin}:${trigger.key}`} value={trigger.eventType}>
                  {trigger.displayName} ({trigger.plugin})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-black/70">Action</span>
            <select
              className="w-full rounded-xl border border-black/10 bg-surface px-3 py-2"
              value={actionSelection}
              onChange={(event) => setActionSelection(event.target.value)}
            >
              {catalog.actions.map((action) => (
                <option key={`${action.plugin}:${action.key}`} value={`${action.plugin}:${action.key}`}>
                  {action.displayName} ({action.plugin})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-black/70">Condition Field</span>
            <input
              className="w-full rounded-xl border border-black/10 bg-surface px-3 py-2"
              value={conditionField}
              onChange={(event) => setConditionField(event.target.value)}
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-black/70">Condition Equals</span>
            <input
              className="w-full rounded-xl border border-black/10 bg-surface px-3 py-2"
              value={conditionEquals}
              onChange={(event) => setConditionEquals(event.target.value)}
            />
          </label>

          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-black/70">Action Input JSON</span>
            <textarea
              className="min-h-24 w-full rounded-xl border border-black/10 bg-surface px-3 py-2"
              value={actionInputJson}
              onChange={(event) => setActionInputJson(event.target.value)}
            />
          </label>
        </div>

        <button
          type="button"
          className="mt-4 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          onClick={() => {
            void handleCreateRule();
          }}
          disabled={submitting}
        >
          {submitting ? "Creating..." : "Create Rule"}
        </button>
      </section>

      {(error || simulationMessage) && (
        <section className="rounded-2xl border border-black/10 bg-white p-4 text-sm">
          {error ? <p className="text-red-700">{error}</p> : null}
          {simulationMessage ? <p className="text-black/80">{simulationMessage}</p> : null}
        </section>
      )}

      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <h2 className="font-display text-xl">Automation Rules</h2>
        {rules.length === 0 ? (
          <p className="mt-3 text-sm text-black/70">No rules found yet for this organization.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {rules.map((rule) => (
              <li key={rule.id} className="rounded-xl border border-black/10 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-semibold">{rule.triggerEvent}</p>
                    <p className="text-xs text-black/60">{rule.id}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-shell px-3 py-1 text-xs font-semibold text-white"
                      onClick={() => {
                        void handleToggleEnabled(rule);
                      }}
                    >
                      {rule.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-black px-3 py-1 text-xs font-semibold text-white"
                      onClick={() => {
                        void handleSimulateRule(rule);
                      }}
                    >
                      Simulate
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white"
                      onClick={() => {
                        void handleDeleteRule(rule);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
