import { v7 } from 'uuid';

/** Time-ordered UUIDv7 used for every primary key (ADR 0004). */
export function uuidv7(): string {
  return v7();
}
