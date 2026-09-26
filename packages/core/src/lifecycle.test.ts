import { describe, expect, it } from 'vitest';
import {
  DOC_STATUSES,
  InvalidTransitionError,
  allowedTransitions,
  assertTransition,
  canDelete,
  canTransition,
  isDocStatus,
  type DocStatus,
} from './lifecycle.js';

// The full matrix from BRD §9.4 and ADR 0010. Every pair not listed is illegal.
const LEGAL: readonly (readonly [DocStatus, DocStatus])[] = [
  ['draft', 'submitted'],
  ['submitted', 'approved'],
  ['submitted', 'rejected'],
  ['rejected', 'draft'],
  ['approved', 'posted'],
  ['approved', 'cancelled'],
  ['posted', 'cancelled'],
];

describe('document lifecycle', () => {
  it('has the six statuses', () => {
    expect(DOC_STATUSES).toEqual([
      'draft',
      'submitted',
      'approved',
      'rejected',
      'posted',
      'cancelled',
    ]);
  });

  it('allows exactly the legal transitions', () => {
    for (const from of DOC_STATUSES) {
      for (const to of DOC_STATUSES) {
        const legal = LEGAL.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(legal);
      }
    }
  });

  it('lists the next statuses for a status', () => {
    expect(allowedTransitions('draft')).toEqual(['submitted']);
    expect(allowedTransitions('submitted')).toEqual(['approved', 'rejected']);
    expect(allowedTransitions('approved')).toEqual(['posted', 'cancelled']);
    expect(allowedTransitions('cancelled')).toEqual([]);
  });

  it('assertTransition passes on legal moves and throws a typed error otherwise', () => {
    expect(() => {
      assertTransition('approved', 'posted');
    }).not.toThrow();
    try {
      assertTransition('posted', 'draft');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      const e = error as InvalidTransitionError;
      expect(e.code).toBe('INVALID_TRANSITION');
      expect(e.from).toBe('posted');
      expect(e.to).toBe('draft');
      expect(e.message).toBe('Cannot move a document from posted to draft');
    }
  });

  it('only allows deleting drafts', () => {
    expect(DOC_STATUSES.filter(canDelete)).toEqual(['draft']);
  });

  it('recognises status strings', () => {
    expect(isDocStatus('posted')).toBe(true);
    expect(isDocStatus('deleted')).toBe(false);
    expect(isDocStatus('Posted')).toBe(false);
  });
});
