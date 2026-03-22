export const FALLBACK_ORG_ID = "org-demo";

export function getDefaultOrganizationId(): string {
  return (
    process.env.BIZFORGE_DEFAULT_ORG_ID ??
    process.env.NEXT_PUBLIC_BIZFORGE_DEFAULT_ORG_ID ??
    FALLBACK_ORG_ID
  );
}