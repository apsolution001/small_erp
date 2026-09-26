/**
 * The audit log's keyset cursor: the last row's exact `changed_at` (microseconds, UTC, as the
 * database prints it) and `id`, base64url-encoded. The exact text matters: a JS Date keeps only
 * milliseconds, and a truncated timestamp would skip or repeat rows at a page boundary.
 */
export interface AuditCursor {
  readonly changedAt: string;
  readonly id: string;
}

const CHANGED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function encodeAuditCursor(cursor: AuditCursor): string {
  return Buffer.from(`${cursor.changedAt}|${cursor.id}`, 'utf8').toString('base64url');
}

/** The cursor, or undefined when the value was not produced by {@link encodeAuditCursor}. */
export function decodeAuditCursor(value: string): AuditCursor | undefined {
  const [changedAt, id, ...rest] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  if (rest.length > 0 || changedAt === undefined || id === undefined) return undefined;
  if (!CHANGED_AT.test(changedAt) || !UUID.test(id)) return undefined;
  if (Number.isNaN(Date.parse(changedAt))) return undefined;
  return { changedAt, id };
}
