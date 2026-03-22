export interface AutomationCondition {
  field: string;
  equals: unknown;
}

export interface AutomationAction {
  plugin: string;
  actionKey: string;
  input: Record<string, unknown>;
}

export interface AutomationRule {
  id: string;
  organizationId: string;
  triggerEvent: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  enabled: boolean;
}

export interface AutomationRuleUpsertPayload {
  triggerEvent: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  enabled: boolean;
}

export interface AutomationCatalogTrigger {
  plugin: string;
  key: string;
  displayName: string;
  eventType: string;
}

export interface AutomationCatalogAction {
  plugin: string;
  key: string;
  displayName: string;
  inputSchema: Record<string, unknown>;
}

export interface AutomationCatalog {
  triggers: AutomationCatalogTrigger[];
  actions: AutomationCatalogAction[];
}

export interface SimulationResult {
  matched: boolean;
  actionsTriggered: number;
  errors: string[];
}

export const DEFAULT_ORG_ID = "org-1";

function getCoreApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_CORE_API_URL ?? "http://localhost:4000";
}

async function parseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // noop
  }

  return `Request failed with status ${response.status}`;
}

export async function fetchAutomationRules(
  organizationId: string = DEFAULT_ORG_ID
): Promise<AutomationRule[]> {
  const response = await fetch(`${getCoreApiBaseUrl()}/api/automation/rules`, {
    cache: "no-store",
    headers: {
      "x-bizforge-org-id": organizationId
    }
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as AutomationRule[];
}

export async function fetchAutomationCatalog(): Promise<AutomationCatalog> {
  const response = await fetch(`${getCoreApiBaseUrl()}/api/automation/catalog`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as AutomationCatalog;
}

export async function createAutomationRule(
  payload: AutomationRuleUpsertPayload
): Promise<AutomationRule> {
  const response = await fetch(`${getCoreApiBaseUrl()}/api/automation/rules`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bizforge-org-id": DEFAULT_ORG_ID
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as AutomationRule;
}

export async function fetchAutomationRuleById(
  ruleId: string,
  organizationId: string = DEFAULT_ORG_ID
): Promise<AutomationRule> {
  const response = await fetch(`${getCoreApiBaseUrl()}/api/automation/rules/${ruleId}`, {
    cache: "no-store",
    headers: {
      "x-bizforge-org-id": organizationId
    }
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as AutomationRule;
}

export async function updateAutomationRule(
  ruleId: string,
  payload: Partial<AutomationRuleUpsertPayload>,
  organizationId: string = DEFAULT_ORG_ID
): Promise<AutomationRule> {
  const response = await fetch(`${getCoreApiBaseUrl()}/api/automation/rules/${ruleId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-bizforge-org-id": organizationId
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as AutomationRule;
}

export async function setAutomationRuleEnabled(ruleId: string, enabled: boolean): Promise<AutomationRule> {
  const endpoint = enabled ? "enable" : "disable";
  const response = await fetch(`${getCoreApiBaseUrl()}/api/automation/rules/${ruleId}/${endpoint}`, {
    method: "POST",
    headers: {
      "x-bizforge-org-id": DEFAULT_ORG_ID
    }
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as AutomationRule;
}

export async function deleteAutomationRule(ruleId: string): Promise<void> {
  const response = await fetch(`${getCoreApiBaseUrl()}/api/automation/rules/${ruleId}`, {
    method: "DELETE",
    headers: {
      "x-bizforge-org-id": DEFAULT_ORG_ID
    }
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }
}

export async function simulateAutomationRule(
  ruleId: string,
  samplePayload: Record<string, unknown>
): Promise<SimulationResult> {
  const response = await fetch(`${getCoreApiBaseUrl()}/api/automation/rules/${ruleId}/simulate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bizforge-org-id": DEFAULT_ORG_ID
    },
    body: JSON.stringify({ samplePayload })
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as SimulationResult;
}
