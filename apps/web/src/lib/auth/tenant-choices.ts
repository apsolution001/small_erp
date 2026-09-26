import { type TenantChoice, tenantChoiceSchema, type TokenResponse } from '@ekaro/contracts';
import { z } from 'zod';

/**
 * The companies the user may switch between. The API has no "list my companies" endpoint yet,
 * so the list is what login offered (`requiresTenantSelection`), plus the current company. It
 * is kept per tab in sessionStorage so a reload keeps the switcher; it holds names and ids only,
 * never a token. Replace with a query once the API lists memberships (T-150 follow-up).
 */
const STORAGE_KEY = 'ekaro.tenant-choices';
const choicesSchema = z.array(tenantChoiceSchema);

export function loadTenantChoices(): TenantChoice[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = choicesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function saveTenantChoices(choices: readonly TenantChoice[]): void {
  try {
    if (choices.length === 0) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(choices));
  } catch {
    // Storage can be unavailable (private mode); the list then lasts until reload.
  }
}

/** Adds (or refreshes) the session's company in the list, keeping login's order. */
export function withCurrentTenant(
  choices: readonly TenantChoice[],
  session: TokenResponse,
): TenantChoice[] {
  const current: TenantChoice = {
    tenantId: session.tenant.id,
    name: session.tenant.name,
    slug: session.tenant.slug,
    roleName: session.membership.role.name,
  };
  const index = choices.findIndex((c) => c.tenantId === current.tenantId);
  if (index === -1) return [...choices, current];
  return choices.map((c, i) => (i === index ? current : c));
}
