"use client";

import { useEffect, useState } from "react";
import {
  AutomationRuleBuilder,
  createDraftFromPayload,
  createEmptyDraft,
  serializeDraft,
  type RuleDraft
} from "./automation-rule-builder";
import {
  type AutomationCatalog,
  type AutomationRule,
  createAutomationRule,
  fetchAutomationRuleById,
  deleteAutomationRule,
  setAutomationRuleEnabled,
  simulateAutomationRule,
  updateAutomationRule
} from "../lib/automation-api";
import {
  createEmptyValidationResult,
  hasValidationErrors,
  listValidationMessages,
  validateRuleDraft,
  type RuleDraftValidation
} from "./automation-rule-validation";

interface AutomationConsoleProps {
  initialRules: AutomationRule[];
  catalog: AutomationCatalog;
  initialEditId?: string;
}

export function AutomationConsole({ initialRules, catalog, initialEditId }: AutomationConsoleProps) {
  const [rules, setRules] = useState<AutomationRule[]>(initialRules);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulationMessage, setSimulationMessage] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(() => createEmptyDraft(catalog));
  const [validation, setValidation] = useState<RuleDraftValidation>(createEmptyValidationResult);
  const [showValidation, setShowValidation] = useState(false);
  const [queryHydrated, setQueryHydrated] = useState(false);

  function syncEditQuery(ruleId?: string): void {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    if (ruleId) {
      url.searchParams.set("edit", ruleId);
    } else {
      url.searchParams.delete("edit");
    }

    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function handleDraftChange(nextDraft: RuleDraft): void {
    setDraft(nextDraft);
    if (showValidation) {
      setValidation(validateRuleDraft(nextDraft, catalog));
    }
  }

  useEffect(() => {
    if (!initialEditId || queryHydrated) {
      return;
    }

    setQueryHydrated(true);
    void beginEditRule(initialEditId, true);
  }, [initialEditId, queryHydrated]);

  async function handleCreateRule(): Promise<void> {
    setError(null);
    setSimulationMessage(null);

    const nextValidation = validateRuleDraft(draft, catalog);
    setValidation(nextValidation);
    setShowValidation(true);
    if (hasValidationErrors(nextValidation)) {
      setError("Please fix validation errors before creating the rule.");
      return;
    }

    const payload = serializeDraft(draft);
    if (!payload.triggerEvent || payload.actions.length === 0) {
      setError("Choose a trigger and at least one action before creating a rule.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await createAutomationRule(payload);

      setRules((current) => [created, ...current]);
      setDraft(createEmptyDraft(catalog));
      setValidation(createEmptyValidationResult());
      setShowValidation(false);
      syncEditQuery();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create rule");
    } finally {
      setSubmitting(false);
    }
  }

  async function beginEditRule(ruleId: string, fromQuery = false): Promise<void> {
    setError(null);
    setSimulationMessage(null);
    setSubmitting(true);

    try {
      const rule = await fetchAutomationRuleById(ruleId);
      setDraft(
        createDraftFromPayload(
          {
            triggerEvent: rule.triggerEvent,
            conditions: rule.conditions,
            actions: rule.actions,
            enabled: rule.enabled
          },
          catalog
        )
      );
      setEditingRuleId(rule.id);
      setEditorMode("edit");
      setValidation(createEmptyValidationResult());
      setShowValidation(false);
      syncEditQuery(rule.id);
    } catch (hydrateError) {
      setError(hydrateError instanceof Error ? hydrateError.message : "Failed to load rule for editing");
      if (fromQuery) {
        setEditorMode("create");
        setEditingRuleId(null);
      }
      syncEditQuery();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateRule(): Promise<void> {
    if (!editingRuleId) {
      return;
    }

    setError(null);
    setSimulationMessage(null);

    const nextValidation = validateRuleDraft(draft, catalog);
    setValidation(nextValidation);
    setShowValidation(true);
    if (hasValidationErrors(nextValidation)) {
      setError("Please fix validation errors before saving changes.");
      return;
    }

    setSubmitting(true);

    try {
      const updated = await updateAutomationRule(editingRuleId, serializeDraft(draft));
      setRules((current) => current.map((rule) => (rule.id === updated.id ? updated : rule)));
      setEditorMode("create");
      setEditingRuleId(null);
      setDraft(createEmptyDraft(catalog));
      setValidation(createEmptyValidationResult());
      setShowValidation(false);
      syncEditQuery();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update rule");
    } finally {
      setSubmitting(false);
    }
  }

  function cancelEdit(): void {
    setEditorMode("create");
    setEditingRuleId(null);
    setDraft(createEmptyDraft(catalog));
    setValidation(createEmptyValidationResult());
    setShowValidation(false);
    setError(null);
    setSimulationMessage(null);
    syncEditQuery();
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
      if (editingRuleId === rule.id) {
        cancelEdit();
      }
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
        <h2 className="font-display text-xl">
          {editorMode === "edit" ? "Edit Automation" : "Create Automation"}
        </h2>
        <p className="mt-2 text-sm text-black/70">
          Compose trigger, conditions, and plugin actions with catalog-driven controls.
        </p>

        <div className="mt-4">
          <AutomationRuleBuilder
            catalog={catalog}
            draft={draft}
            onChange={handleDraftChange}
            validationErrors={showValidation ? validation.fieldErrors : {}}
          />
        </div>

        {showValidation && hasValidationErrors(validation) ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p className="font-semibold">Please resolve the following issues:</p>
            <ul className="mt-2 list-disc pl-5">
              {listValidationMessages(validation).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            onClick={() => {
              if (editorMode === "edit") {
                void handleUpdateRule();
                return;
              }

              void handleCreateRule();
            }}
            disabled={submitting}
          >
            {submitting
              ? editorMode === "edit"
                ? "Saving..."
                : "Creating..."
              : editorMode === "edit"
                ? "Save Changes"
                : "Create Rule"}
          </button>

          {editorMode === "edit" ? (
            <button
              type="button"
              className="rounded-xl border border-black/10 px-4 py-2 text-sm font-semibold"
              onClick={cancelEdit}
              disabled={submitting}
            >
              Cancel Edit
            </button>
          ) : null}
        </div>
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
                      className="rounded-lg border border-black/10 px-3 py-1 text-xs font-semibold"
                      onClick={() => {
                        void beginEditRule(rule.id);
                      }}
                    >
                      Edit
                    </button>
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
