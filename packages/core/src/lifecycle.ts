/**
 * The shared lifecycle of transactional documents (BRD §9.4, ADR 0010). Services enforce it with
 * `assertTransition`, and a DB check constraint mirrors `DOC_STATUSES`.
 */
export const DOC_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'posted',
  'cancelled',
] as const;

export type DocStatus = (typeof DOC_STATUSES)[number];

const TRANSITIONS: Readonly<Record<DocStatus, readonly DocStatus[]>> = {
  draft: ['submitted'],
  submitted: ['approved', 'rejected'],
  // A rejected document goes back to draft to be corrected and resubmitted.
  rejected: ['draft'],
  // An approved document that will never be acted on is cancelled; nothing needs reversing.
  approved: ['posted', 'cancelled'],
  // Cancelling a posted document writes a reversal; the original stays for audit.
  posted: ['cancelled'],
  cancelled: [],
};

/** Raised on an illegal status change. The API maps `code` to a 409 problem. */
export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION';

  constructor(
    readonly from: DocStatus,
    readonly to: DocStatus,
  ) {
    super(`Cannot move a document from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function isDocStatus(value: string): value is DocStatus {
  return (DOC_STATUSES as readonly string[]).includes(value);
}

export function allowedTransitions(from: DocStatus): readonly DocStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: DocStatus, to: DocStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: DocStatus, to: DocStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/** Only a draft can be deleted. Anything later is cancelled, never deleted. */
export function canDelete(status: DocStatus): boolean {
  return status === 'draft';
}
