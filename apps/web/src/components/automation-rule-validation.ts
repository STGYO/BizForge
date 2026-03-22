import type { AutomationCatalog } from "../lib/automation-api";
import type { RuleDraft } from "./automation-rule-builder";

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
}

export interface RuleDraftValidation {
  globalErrors: string[];
  fieldErrors: Record<string, string[]>;
}

function emptyValidation(): RuleDraftValidation {
  return {
    globalErrors: [],
    fieldErrors: {}
  };
}

function addFieldError(target: RuleDraftValidation, path: string, message: string): void {
  const existing = target.fieldErrors[path] ?? [];
  target.fieldErrors[path] = [...existing, message];
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

function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length === 0;
  }

  return false;
}

function validateRequiredSchemaFields(
  schema: JsonSchema,
  value: unknown,
  basePath: string,
  target: RuleDraftValidation
): void {
  const normalized = normalizeSchema(schema);

  if (normalized.enum && normalized.enum.length > 0) {
    if (!normalized.enum.some((entry) => entry === value)) {
      addFieldError(target, basePath, "Select one of the available values.");
    }
    return;
  }

  const isObjectLike =
    (Array.isArray(normalized.type) && normalized.type.includes("object")) ||
    normalized.type === "object" ||
    Boolean(normalized.properties);

  if (isObjectLike) {
    const objectValue =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    const requiredKeys = normalized.required ?? [];
    for (const key of requiredKeys) {
      const keyPath = `${basePath}.${key}`;
      const childValue = objectValue[key];
      if (isMissing(childValue)) {
        addFieldError(target, keyPath, "This field is required.");
      }
    }

    for (const [key, propertySchema] of Object.entries(normalized.properties ?? {})) {
      const childValue = objectValue[key];
      if (childValue === undefined) {
        continue;
      }

      validateRequiredSchemaFields(propertySchema, childValue, `${basePath}.${key}`, target);
    }

    return;
  }

  const isArrayLike =
    (Array.isArray(normalized.type) && normalized.type.includes("array")) ||
    normalized.type === "array" ||
    Boolean(normalized.items);

  if (isArrayLike) {
    if (!Array.isArray(value)) {
      addFieldError(target, basePath, "This field must be an array.");
      return;
    }

    const itemSchema = normalized.items;
    if (!itemSchema) {
      return;
    }

    value.forEach((item, index) => {
      validateRequiredSchemaFields(itemSchema, item, `${basePath}.${index}`, target);
    });
  }
}

export function validateRuleDraft(
  draft: RuleDraft,
  catalog: AutomationCatalog
): RuleDraftValidation {
  const validation = emptyValidation();

  if (!draft.triggerEvent.trim()) {
    addFieldError(validation, "triggerEvent", "Trigger event is required.");
  }

  if (draft.conditions.length === 0) {
    validation.globalErrors.push("At least one condition is required.");
  }

  draft.conditions.forEach((condition, index) => {
    if (!condition.field.trim()) {
      addFieldError(validation, `conditions.${index}.field`, "Condition field is required.");
    }

    if (isMissing(condition.equals)) {
      addFieldError(validation, `conditions.${index}.equals`, "Condition value is required.");
    }
  });

  if (draft.actions.length === 0) {
    validation.globalErrors.push("At least one action is required.");
  }

  draft.actions.forEach((action, index) => {
    if (!action.plugin.trim()) {
      addFieldError(validation, `actions.${index}.plugin`, "Action plugin is required.");
    }

    if (!action.actionKey.trim()) {
      addFieldError(validation, `actions.${index}.actionKey`, "Action key is required.");
    }

    const actionDefinition = catalog.actions.find(
      (entry) => entry.plugin === action.plugin && entry.key === action.actionKey
    );

    if (!actionDefinition) {
      addFieldError(validation, `actions.${index}.actionKey`, "Selected action is not available.");
      return;
    }

    validateRequiredSchemaFields(
      actionDefinition.inputSchema as JsonSchema,
      action.input,
      `actions.${index}.input`,
      validation
    );
  });

  return validation;
}

export function hasValidationErrors(validation: RuleDraftValidation): boolean {
  return (
    validation.globalErrors.length > 0 ||
    Object.values(validation.fieldErrors).some((messages) => messages.length > 0)
  );
}

export function listValidationMessages(validation: RuleDraftValidation): string[] {
  const fieldMessages = Object.entries(validation.fieldErrors).flatMap(([path, messages]) =>
    messages.map((message) => `${path}: ${message}`)
  );

  return [...validation.globalErrors, ...fieldMessages];
}

export function createEmptyValidationResult(): RuleDraftValidation {
  return emptyValidation();
}
