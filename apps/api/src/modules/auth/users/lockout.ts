/** Progressive lockout (spec 01 §1): 5 consecutive failures lock the account for 15 minutes. */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export function lockoutEnd(now: Date): Date {
  return new Date(now.getTime() + LOCKOUT_MINUTES * 60_000);
}

export function isLocked(user: { readonly lockedUntil: Date | null }, now: Date): boolean {
  return user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime();
}
