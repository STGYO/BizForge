"use client";

import { useMemo } from "react";
import type {
  AutomationAction,
  AutomationCatalog,
  AutomationCondition,
  AutomationRuleUpsertPayload
} from "../lib/automation-api";

interface RuleDraftCondition {
  id: string;
  field: string;
  equals: unknown;
}

interface RuleDraftAction {
  id: string;
  plugin: string;
  actionKey: string;
  input: Record<string, unknown>;
}

export interface RuleDraft {
  triggerEvent: string;
  conditions: RuleDraftCondition[];
  actions: RuleDraftAction[];
  enabled: boolean;
}

interface AutomationRuleBuilderProps {
  catalog: AutomationCatalog;
  draft: RuleDraft;
  onChange: (next: RuleDraft) => void;
  compact?: boolean;
}

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
  default?: unknown;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
}

const CORE_TRIGGER_FIELDS: Record<string, string[]> = {
  "lead.generated": ["source"],
  "customer.created": ["source"]
};

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeSchema(schema: JsonSchema): JsonSchema {
  if (schema.oneOf && schema.oneOf.length > 0) {
    return normalizeSchema(schema.oneOf[0] as JsonSchema);
  }

  if (schema.anyOf && schema.anyOf.length > 0) {
    return normalizeSchema(schema.anyOf[0] as JsonSchema);
  }

  return schema;
}

function inferPrimaryType(schema: JsonSchema): string {
  const normalized = normalizeSchema(schema);
  if (Array.isArray(normalized.type)) {
    return normalized.type[0] ?? "string";
  }

  if (typeof normalized.type === "string") {
    return normalized.type;
  }

  if (normalized.properties) {
    return "object";
  }

  if (normalized.items) {
    return "array";
  }

  if (normalized.enum && normalized.enum.length > 0) {
    return typeof normalized.enum[0] === "number" ? "number" : "string";
  }

  return "string";
}

function cloneDefaultValue(schema: JsonSchema): unknown {
  const normalized = normalizeSchema(schema);

  if (normalized.default !== undefined) {
    return structuredClone(normalized.default);
  }

  const primaryType = inferPrimaryType(normalized);
  if (primaryType === "object") {
    const next: Record<string, unknown> = {};
    const required = new Set(normalized.required ?? []);

    for (const [key, propertySchema] of Object.entries(normalized.properties ?? {})) {
      if (required.has(key)) {
        next[key] = cloneDefaultValue(propertySchema);
      }
    }

    return next;
  }

  if (primaryType === "array") {
    return [];
  }

  if (normalized.enum && normalized.enum.length > 0) {
    return normalized.enum[0];
  }

  if (primaryType === "number") {
    return 0;
  }

  if (primaryType === "boolean") {
    return false;
  }

  return "";
}

function updateObjectValue(
  current: Record<string, unknown>,
  key: string,
  value: unknown
): Record<string, unknown> {
  return {
    ...current,
    [key]: value
  };
}

function schemaFromAction(catalog: AutomationCatalog, action: AutomationAction): JsonSchema {
  const match = catalog.actions.find(
    (item) => item.plugin === action.plugin && item.key === action.actionKey
  );

  if (!match) {
    return { type: "object", properties: {} };
  }

  return (match.inputSchema as JsonSchema) ?? { type: "object", properties: {} };
}

function FieldLabel({ label, required }: { label: string; required: boolean }) {
  return (
    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/55">
      {label}
      {required ? " *" : ""}
    </p>
  );
}

function SchemaFieldRenderer({
  schema,
  label,
  value,
  onChange,
  required
}: {
  schema: JsonSchema;
  label: string;
  value: unknown;
  onChange: (next: unknown) => void;
  required: boolean;
}) {
  const normalized = normalizeSchema(schema);
  const primaryType = inferPrimaryType(normalized);

  if (normalized.enum && normalized.enum.length > 0) {
    const selectedIndex = normalized.enum.findIndex((entry) => entry === value);

    return (
      <div>
        <FieldLabel label={label} required={required} />
        <select
          className="w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
          value={selectedIndex >= 0 ? String(selectedIndex) : ""}
          onChange={(event) => {
            const index = Number(event.target.value);
            const selected = normalized.enum?.[index];
            onChange(selected ?? "");
          }}
        >
          {normalized.enum.map((entry, index) => (
            <option key={`${label}-${index}`} value={String(index)}>
              {String(entry)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (primaryType === "object") {
    const objectValue =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : ((cloneDefaultValue(normalized) as Record<string, unknown>) ?? {});

    return (
      <div className="space-y-2 rounded-lg border border-black/10 bg-black/[0.02] p-3">
        <FieldLabel label={label} required={required} />
        {Object.entries(normalized.properties ?? {}).map(([key, propertySchema]) => {
          const childSchema = propertySchema as JsonSchema;
          const childRequired = (normalized.required ?? []).includes(key);
          const childValue = objectValue[key] ?? cloneDefaultValue(childSchema);

          return (
            <SchemaFieldRenderer
              key={`${label}.${key}`}
              schema={childSchema}
              label={key}
              required={childRequired}
              value={childValue}
              onChange={(nextChildValue) => {
                onChange(updateObjectValue(objectValue, key, nextChildValue));
              }}
            />
          );
        })}
      </div>
    );
  }

  if (primaryType === "array") {
    const itemSchema = (normalized.items ?? { type: "string" }) as JsonSchema;
    const arrayValue = Array.isArray(value) ? value : [];

    return (
      <div className="space-y-2 rounded-lg border border-black/10 bg-black/[0.02] p-3">
        <div className="flex items-center justify-between">
          <FieldLabel label={label} required={required} />
          <button
            type="button"
            className="rounded-md border border-black/10 px-2 py-1 text-xs"
            onClick={() => {
              onChange([...arrayValue, cloneDefaultValue(itemSchema)]);
            }}
          >
            Add Item
          </button>
        </div>

        {arrayValue.length === 0 ? (
          <p className="text-xs text-black/55">No items</p>
        ) : (
          <div className="space-y-2">
            {arrayValue.map((entry, index) => (
              <div key={`${label}-${index}`} className="rounded-md border border-black/10 bg-white p-2">
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700"
                    onClick={() => {
                      const next = arrayValue.filter((_, arrayIndex) => arrayIndex !== index);
                      onChange(next);
                    }}
                  >
                    Remove
                  </button>
                </div>
                <SchemaFieldRenderer
                  schema={itemSchema}
                  label={`${label}[${index}]`}
                  required={required}
                  value={entry}
                  onChange={(nextEntry) => {
                    const next = arrayValue.map((currentEntry, arrayIndex) =>
                      arrayIndex === index ? nextEntry : currentEntry
                    );
                    onChange(next);
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (primaryType === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </label>
    );
  }

  if (primaryType === "number") {
    return (
      <label className="text-sm">
        <FieldLabel label={label} required={required} />
        <input
          type="number"
          className="w-full rounded-lg border border-black/10 bg-surface px-3 py-2"
          value={typeof value === "number" ? String(value) : ""}
          onChange={(event) => {
            const nextValue = Number(event.target.value);
            onChange(Number.isFinite(nextValue) ? nextValue : 0);
          }}
        />
      </label>
    );
  }

  return (
    <label className="text-sm">
      <FieldLabel label={label} required={required} />
      <input
        type="text"
        className="w-full rounded-lg border border-black/10 bg-surface px-3 py-2"
        value={typeof value === "string" ? value : String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function createDraftFromPayload(
  payload: AutomationRuleUpsertPayload,
  catalog: AutomationCatalog
): RuleDraft {
  const nextActions = payload.actions.map((action) => {
    const actionSchema = schemaFromAction(catalog, action);
    const baseInput = cloneDefaultValue(actionSchema);

    return {
      id: createId("action"),
      plugin: action.plugin,
      actionKey: action.actionKey,
      input:
        action.input && typeof action.input === "object"
          ? {
              ...(typeof baseInput === "object" && baseInput !== null
                ? (baseInput as Record<string, unknown>)
                : {}),
              ...action.input
            }
          : {}
    };
  });

  return {
    triggerEvent: payload.triggerEvent,
    conditions: payload.conditions.map((condition) => ({
      id: createId("condition"),
      field: condition.field,
      equals: condition.equals
    })),
    actions: nextActions,
    enabled: payload.enabled
  };
}

export function serializeDraft(draft: RuleDraft): AutomationRuleUpsertPayload {
  return {
    triggerEvent: draft.triggerEvent,
    conditions: draft.conditions.map((condition) => ({
      field: condition.field,
      equals: condition.equals
    })),
    actions: draft.actions.map((action) => ({
      plugin: action.plugin,
      actionKey: action.actionKey,
      input: action.input
    })),
    enabled: draft.enabled
  };
}

export function createEmptyDraft(catalog: AutomationCatalog): RuleDraft {
  const firstTrigger = catalog.triggers[0]?.eventType ?? "";
  const firstAction = catalog.actions[0];

  const initialActionSchema = firstAction
    ? schemaFromAction(catalog, {
        plugin: firstAction.plugin,
        actionKey: firstAction.key,
        input: {}
      })
    : { type: "object", properties: {} };

  return {
    triggerEvent: firstTrigger,
    conditions: [
      {
        id: createId("condition"),
        field: (CORE_TRIGGER_FIELDS[firstTrigger] ?? ["source"])[0] ?? "source",
        equals: ""
      }
    ],
    actions: firstAction
      ? [
          {
            id: createId("action"),
            plugin: firstAction.plugin,
            actionKey: firstAction.key,
            input: cloneDefaultValue(initialActionSchema) as Record<string, unknown>
          }
        ]
      : [],
    enabled: true
  };
}

export function AutomationRuleBuilder({
  catalog,
  draft,
  onChange,
  compact = false
}: AutomationRuleBuilderProps) {
  const triggerFieldOptions = useMemo(
    () => CORE_TRIGGER_FIELDS[draft.triggerEvent] ?? ["source"],
    [draft.triggerEvent]
  );

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <div className={`grid gap-3 ${compact ? "grid-cols-1" : "md:grid-cols-2"}`}>
          <label className="text-sm">
            <FieldLabel label="Trigger Event" required={true} />
            <select
              className="w-full rounded-lg border border-black/10 bg-surface px-3 py-2"
              value={draft.triggerEvent}
              onChange={(event) => {
                const nextTrigger = event.target.value;
                const nextField = (CORE_TRIGGER_FIELDS[nextTrigger] ?? ["source"])[0] ?? "source";

                onChange({
                  ...draft,
                  triggerEvent: nextTrigger,
                  conditions: draft.conditions.map((condition, index) =>
                    index === 0 && !condition.field
                      ? {
                          ...condition,
                          field: nextField
                        }
                      : condition
                  )
                });
              }}
            >
              {catalog.triggers.map((trigger) => (
                <option key={`${trigger.plugin}:${trigger.key}`} value={trigger.eventType}>
                  {trigger.displayName} ({trigger.plugin})
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-end gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => onChange({ ...draft, enabled: event.target.checked })}
            />
            Rule enabled
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg">Conditions</h3>
          <button
            type="button"
            className="rounded-lg border border-black/10 px-3 py-1 text-xs"
            onClick={() => {
              onChange({
                ...draft,
                conditions: [
                  ...draft.conditions,
                  {
                    id: createId("condition"),
                    field: triggerFieldOptions[0] ?? "source",
                    equals: ""
                  }
                ]
              });
            }}
          >
            Add Condition
          </button>
        </div>

        <div className="space-y-3">
          {draft.conditions.map((condition) => (
            <div key={condition.id} className="rounded-lg border border-black/10 bg-surface/40 p-3">
              <div className={`grid gap-2 ${compact ? "grid-cols-1" : "md:grid-cols-[1fr_1fr_auto]"}`}>
                <label className="text-sm">
                  <FieldLabel label="Field" required={true} />
                  <select
                    className="w-full rounded-lg border border-black/10 bg-white px-3 py-2"
                    value={condition.field}
                    onChange={(event) => {
                      onChange({
                        ...draft,
                        conditions: draft.conditions.map((entry) =>
                          entry.id === condition.id
                            ? {
                                ...entry,
                                field: event.target.value
                              }
                            : entry
                        )
                      });
                    }}
                  >
                    {triggerFieldOptions.map((field) => (
                      <option key={field} value={field}>
                        {field}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm">
                  <FieldLabel label="Equals" required={true} />
                  <input
                    className="w-full rounded-lg border border-black/10 bg-white px-3 py-2"
                    value={typeof condition.equals === "string" ? condition.equals : String(condition.equals ?? "")}
                    onChange={(event) => {
                      onChange({
                        ...draft,
                        conditions: draft.conditions.map((entry) =>
                          entry.id === condition.id
                            ? {
                                ...entry,
                                equals: event.target.value
                              }
                            : entry
                        )
                      });
                    }}
                  />
                </label>

                <button
                  type="button"
                  className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-700"
                  onClick={() => {
                    onChange({
                      ...draft,
                      conditions: draft.conditions.filter((entry) => entry.id !== condition.id)
                    });
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg">Actions</h3>
          <button
            type="button"
            className="rounded-lg border border-black/10 px-3 py-1 text-xs"
            onClick={() => {
              const firstAction = catalog.actions[0];
              if (!firstAction) {
                return;
              }

              const nextSchema = schemaFromAction(catalog, {
                plugin: firstAction.plugin,
                actionKey: firstAction.key,
                input: {}
              });

              onChange({
                ...draft,
                actions: [
                  ...draft.actions,
                  {
                    id: createId("action"),
                    plugin: firstAction.plugin,
                    actionKey: firstAction.key,
                    input: cloneDefaultValue(nextSchema) as Record<string, unknown>
                  }
                ]
              });
            }}
          >
            Add Action
          </button>
        </div>

        <div className="space-y-3">
          {draft.actions.map((action) => {
            const selectedDefinition =
              catalog.actions.find(
                (entry) => entry.plugin === action.plugin && entry.key === action.actionKey
              ) ?? catalog.actions[0];

            const actionSchema = selectedDefinition
              ? schemaFromAction(catalog, {
                  plugin: selectedDefinition.plugin,
                  actionKey: selectedDefinition.key,
                  input: action.input
                })
              : { type: "object", properties: {} };

            return (
              <div key={action.id} className="rounded-lg border border-black/10 bg-surface/40 p-3">
                <div className={`grid gap-2 ${compact ? "grid-cols-1" : "md:grid-cols-[1fr_auto]"}`}>
                  <label className="text-sm">
                    <FieldLabel label="Action" required={true} />
                    <select
                      className="w-full rounded-lg border border-black/10 bg-white px-3 py-2"
                      value={`${action.plugin}:${action.actionKey}`}
                      onChange={(event) => {
                        const [nextPlugin, nextActionKey] = event.target.value.split(":");
                        const nextDefinition = catalog.actions.find(
                          (entry) => entry.plugin === nextPlugin && entry.key === nextActionKey
                        );
                        const nextSchema = nextDefinition
                          ? (nextDefinition.inputSchema as JsonSchema)
                          : { type: "object", properties: {} };

                        onChange({
                          ...draft,
                          actions: draft.actions.map((entry) =>
                            entry.id === action.id
                              ? {
                                  ...entry,
                                  plugin: nextPlugin ?? "",
                                  actionKey: nextActionKey ?? "",
                                  input: cloneDefaultValue(nextSchema) as Record<string, unknown>
                                }
                              : entry
                          )
                        });
                      }}
                    >
                      {catalog.actions.map((catalogAction) => (
                        <option
                          key={`${catalogAction.plugin}:${catalogAction.key}`}
                          value={`${catalogAction.plugin}:${catalogAction.key}`}
                        >
                          {catalogAction.displayName} ({catalogAction.plugin})
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-700"
                    onClick={() => {
                      onChange({
                        ...draft,
                        actions: draft.actions.filter((entry) => entry.id !== action.id)
                      });
                    }}
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-3">
                  <SchemaFieldRenderer
                    schema={actionSchema}
                    label="Action Input"
                    required={true}
                    value={action.input}
                    onChange={(nextValue) => {
                      onChange({
                        ...draft,
                        actions: draft.actions.map((entry) =>
                          entry.id === action.id
                            ? {
                                ...entry,
                                input:
                                  nextValue && typeof nextValue === "object" && !Array.isArray(nextValue)
                                    ? (nextValue as Record<string, unknown>)
                                    : {}
                              }
                            : entry
                        )
                      });
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
