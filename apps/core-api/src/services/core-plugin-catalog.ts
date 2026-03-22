export const CORE_PLUGIN_IDS = [
  "customer-crm",
  "leads-manager",
  "appointment-manager",
  "automation-engine",
  "messaging-notifications",
  "invoice-billing",
  "task-workflow-manager",
  "analytics-insights",
  "document-manager",
  "plugin-manager"
] as const;

export function isCorePlugin(name: string): boolean {
  return CORE_PLUGIN_IDS.includes(name as (typeof CORE_PLUGIN_IDS)[number]);
}
