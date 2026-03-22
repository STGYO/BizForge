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
  acknowledgeAutomationDeadLetter,
  type AutomationExecutionRecord,
  type AutomationDeadLetterRecord,
  type AutomationRule,
  fetchAutomationDeadLetters,
  createAutomationRule,
  fetchAutomationRuleExecutions,
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
  organizationId: string;
  initialEditId?: string;
}

export function AutomationConsole({
  initialRules,
  catalog,
  organizationId,
  initialEditId
}: AutomationConsoleProps) {
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
  const [simulationPayloadText, setSimulationPayloadText] = useState(
    JSON.stringify({ source: "web", customerId: "cust-1" }, null, 2)
  );
  const [activeHistoryRuleId, setActiveHistoryRuleId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [executionHistory, setExecutionHistory] = useState<AutomationExecutionRecord[]>([]);
  const [activeDeadLetterRuleId, setActiveDeadLetterRuleId] = useState<string | null>(null);
  const [deadLetterLoading, setDeadLetterLoading] = useState(false);
  const [deadLetters, setDeadLetters] = useState<AutomationDeadLetterRecord[]>([]);
  const [acknowledgingDeadLetterId, setAcknowledgingDeadLetterId] = useState<string | null>(null);

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
      const created = await createAutomationRule(payload, organizationId);

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
      const rule = await fetchAutomationRuleById(ruleId, organizationId);
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
      const updated = await setAutomationRuleEnabled(rule.id, !rule.enabled, organizationId);
      setRules((current) => current.map((item) => (item.id === rule.id ? updated : item)));
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Failed to update rule status");
    }
  }

  async function handleDeleteRule(rule: AutomationRule): Promise<void> {
    setError(null);
    setSimulationMessage(null);

    try {
      await deleteAutomationRule(rule.id, organizationId);
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

    let samplePayload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(simulationPayloadText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("Simulation payload must be a JSON object.");
        return;
      }

      samplePayload = parsed as Record<string, unknown>;
    } catch {
      setError("Simulation payload contains invalid JSON.");
      return;
    }

    try {
      const result = await simulateAutomationRule(rule.id, samplePayload, organizationId);
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

  async function handleLoadExecutionHistory(rule: AutomationRule): Promise<void> {
    setError(null);
    setSimulationMessage(null);
    setHistoryLoading(true);

    try {
      const executions = await fetchAutomationRuleExecutions(rule.id, organizationId);
      setExecutionHistory(executions);
      setActiveHistoryRuleId(rule.id);
    } catch (historyError) {
      setError(
        historyError instanceof Error ? historyError.message : "Failed to load execution history"
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleLoadDeadLetters(rule?: AutomationRule): Promise<void> {
    setError(null);
    setSimulationMessage(null);
    setDeadLetterLoading(true);

    try {
      const records = await fetchAutomationDeadLetters(organizationId);
      setDeadLetters(records);
      setActiveDeadLetterRuleId(rule?.id ?? null);
    } catch (deadLetterError) {
      setError(
        deadLetterError instanceof Error ? deadLetterError.message : "Failed to load dead letters"
      );
    } finally {
      setDeadLetterLoading(false);
    }
  }

  useEffect(() => {
    void handleLoadDeadLetters();
  }, [organizationId]);

  async function handleAcknowledgeDeadLetter(deadLetterId: string): Promise<void> {
    setError(null);
    setSimulationMessage(null);
    setAcknowledgingDeadLetterId(deadLetterId);

    try {
      await acknowledgeAutomationDeadLetter(deadLetterId, organizationId);
      setDeadLetters((current) => current.filter((deadLetter) => deadLetter.id !== deadLetterId));
    } catch (acknowledgeError) {
      setError(
        acknowledgeError instanceof Error
          ? acknowledgeError.message
          : "Failed to acknowledge dead letter"
      );
    } finally {
      setAcknowledgingDeadLetterId(null);
    }
  }

  const filteredDeadLetters =
    activeDeadLetterRuleId == null
      ? deadLetters
      : deadLetters.filter((deadLetter) => deadLetter.ruleId === activeDeadLetterRuleId);

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
        <div className="mt-3 rounded-xl border border-black/10 bg-surface p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-black/60">
            Simulation Payload
          </p>
          <p className="mt-1 text-xs text-black/60">
            Used when clicking Simulate on any rule.
          </p>
          <textarea
            className="mt-2 h-36 w-full rounded-lg border border-black/10 bg-white p-2 font-mono text-xs focus:border-accent focus:outline-none"
            value={simulationPayloadText}
            onChange={(event) => {
              setSimulationPayloadText(event.target.value);
            }}
          />
        </div>

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
                      className="rounded-lg border border-black/10 px-3 py-1 text-xs font-semibold"
                      onClick={() => {
                        void handleLoadExecutionHistory(rule);
                      }}
                    >
                      History
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-black/10 px-3 py-1 text-xs font-semibold"
                      onClick={() => {
                        void handleLoadDeadLetters(rule);
                      }}
                    >
                      Dead Letters
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

      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <h2 className="font-display text-xl">Execution History</h2>
        {historyLoading ? (
          <p className="mt-3 text-sm text-black/70">Loading execution history...</p>
        ) : !activeHistoryRuleId ? (
          <p className="mt-3 text-sm text-black/70">
            Select History on a rule to inspect recent executions.
          </p>
        ) : executionHistory.length === 0 ? (
          <p className="mt-3 text-sm text-black/70">No executions found yet for selected rule.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {executionHistory.map((execution) => (
              <li key={execution.id} className="rounded-xl border border-black/10 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-semibold">{execution.triggerEvent}</p>
                    <p className="text-xs text-black/60">{new Date(execution.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded-full px-2 py-1 font-semibold ${
                        execution.status === "success"
                          ? "bg-emerald-100 text-emerald-700"
                          : execution.status === "failed"
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {execution.status}
                    </span>
                    <span className="rounded-full bg-black/5 px-2 py-1 text-black/70">
                      actions: {execution.actionsTriggered}
                    </span>
                    <span className="rounded-full bg-black/5 px-2 py-1 text-black/70">
                      retries: {execution.retryCount}
                    </span>
                    <span className="rounded-full bg-black/5 px-2 py-1 text-black/70">
                      matched: {execution.matched ? "yes" : "no"}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-black/60">
                  <span>trigger id: {execution.triggerEventId ?? "n/a"}</span>
                  <span>actions executed: {execution.actionsExecuted?.length ?? 0}</span>
                  <span>errors: {execution.errors.length}</span>
                </div>
                {execution.conditionsSummary ? (
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-black/5 p-2 text-[11px] text-black/70">
{JSON.stringify(execution.conditionsSummary, null, 2)}
                  </pre>
                ) : null}
                {execution.lastError ? (
                  <p className="mt-2 text-xs text-red-700">{execution.lastError}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h2 className="font-display text-xl">Dead Letters</h2>
          <button
            type="button"
            className="rounded-lg border border-black/10 px-3 py-1 text-xs font-semibold"
            onClick={() => {
              void handleLoadDeadLetters();
            }}
          >
            Refresh
          </button>
        </div>
        {deadLetterLoading ? (
          <p className="mt-3 text-sm text-black/70">Loading dead letters...</p>
        ) : deadLetters.length === 0 ? (
          <p className="mt-3 text-sm text-black/70">No dead letters recorded for this organization.</p>
        ) : filteredDeadLetters.length === 0 ? (
          <p className="mt-3 text-sm text-black/70">No dead letters found for selected rule.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {filteredDeadLetters.map((deadLetter) => (
              <li key={deadLetter.id} className="rounded-xl border border-black/10 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-semibold">{deadLetter.failureReason}</p>
                    <p className="text-xs text-black/60">{new Date(deadLetter.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-black/5 px-2 py-1 text-black/70">
                      rule: {deadLetter.ruleId}
                    </span>
                    <span className="rounded-full bg-black/5 px-2 py-1 text-black/70">
                      retries: {deadLetter.retryAttempts}
                    </span>
                  </div>
                </div>

                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <pre className="overflow-x-auto rounded-lg bg-black/5 p-2 text-[11px] text-black/70">
{JSON.stringify(deadLetter.originalEvent, null, 2)}
                  </pre>
                  <pre className="overflow-x-auto rounded-lg bg-black/5 p-2 text-[11px] text-black/70">
{JSON.stringify(deadLetter.actionConfig, null, 2)}
                  </pre>
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="rounded-lg bg-shell px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                    onClick={() => {
                      void handleAcknowledgeDeadLetter(deadLetter.id);
                    }}
                    disabled={acknowledgingDeadLetterId === deadLetter.id}
                  >
                    {acknowledgingDeadLetterId === deadLetter.id ? "Acknowledging..." : "Acknowledge"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
