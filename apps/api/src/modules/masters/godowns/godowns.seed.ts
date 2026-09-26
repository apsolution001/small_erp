import { type NewGodownRow } from './godowns.schema.js';

export const MAIN_GODOWN_CODE = 'MAIN';

/** The "Main" godown of the head office. */
export function buildMainGodown(branchId: string): NewGodownRow {
  return { branchId, code: MAIN_GODOWN_CODE, name: 'Main' };
}
