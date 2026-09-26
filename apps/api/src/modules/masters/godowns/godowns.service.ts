import {
  type GodownCreate,
  type GodownListQuery,
  godownRecordSchema,
  type GodownResponse,
  type GodownUpdate,
} from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../common/errors/domain-error.js';
import { assertVersion, changesOf, parseMergedRecord } from '../../../common/record-updates.js';
import { type ConstraintErrors, mapConstraintErrors } from '../../../infra/db/constraint-errors.js';
import { type Page, pageOf } from '../../../infra/db/list-query.js';
import { BranchesService } from '../branches/branches.service.js';
import { toGodownResponse } from './godowns.mapper.js';
import { GodownsRepository } from './godowns.repository.js';
import { type GodownRow } from './godowns.schema.js';

const constraintErrors = (code: string | undefined): ConstraintErrors => ({
  godowns_tenant_code_unique: () =>
    new ConflictError('ALREADY_EXISTS', `A godown with code ${code ?? ''} already exists.`),
  godowns_branch_fk: () => ValidationError.forField('branchId', 'The branch does not exist'),
});

/**
 * Godowns (spec 02 §2–3). An active godown belongs to an active branch: creating one, moving one
 * to another branch or re-activating one needs an active branch (422 on `branchId`). This and
 * the branch's "no deactivation with active godowns" rule share the tenant's branch lock.
 * DELETE deactivates.
 */
@Injectable()
export class GodownsService {
  constructor(
    private readonly godowns: GodownsRepository,
    private readonly branches: BranchesService,
  ) {}

  async list(query: GodownListQuery): Promise<Page<GodownResponse>> {
    const { rows, total } = await this.godowns.list(query);
    return pageOf(rows.map(toGodownResponse), total, query);
  }

  async get(id: string): Promise<GodownResponse> {
    return toGodownResponse(await this.require(id));
  }

  async create(input: GodownCreate): Promise<GodownResponse> {
    await this.branches.lockBranches();
    if (input.isActive) await this.assertActiveBranch(input.branchId);
    const row = await mapConstraintErrors(
      () => this.godowns.insert(input),
      constraintErrors(input.code),
    );
    return toGodownResponse(row);
  }

  async update(id: string, patch: GodownUpdate): Promise<GodownResponse> {
    await this.branches.lockBranches();
    const existing = await this.require(id, { forUpdate: true });
    assertVersion(existing.version, patch.version);
    const changes = changesOf(patch);
    const merged = parseMergedRecord(godownRecordSchema, toGodownResponse(existing), changes);
    const moves = merged.branchId !== existing.branchId;
    if (merged.isActive && (moves || !existing.isActive)) {
      await this.assertActiveBranch(merged.branchId);
    }
    const row = await mapConstraintErrors(
      () => this.godowns.update(id, changes),
      constraintErrors(changes.code),
    );
    return toGodownResponse(row);
  }

  /** Deactivates the godown (masters are never hard deleted once they can be referenced). */
  async remove(id: string): Promise<void> {
    const existing = await this.require(id, { forUpdate: true });
    if (existing.isActive) await this.godowns.update(id, { isActive: false });
  }

  private async assertActiveBranch(branchId: string): Promise<void> {
    if ((await this.branches.findActive(branchId)) === undefined) {
      throw ValidationError.forField('branchId', 'Choose an active branch');
    }
  }

  private async require(id: string, options: { forUpdate?: boolean } = {}): Promise<GodownRow> {
    const row = await this.godowns.findById(id, options);
    if (row === undefined) throw notFound();
    return row;
  }
}

const notFound = (): NotFoundError => new NotFoundError('NOT_FOUND', 'Godown not found.');
