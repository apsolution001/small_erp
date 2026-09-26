import {
  type BranchCreate,
  type BranchListQuery,
  type BranchRecord,
  branchRecordSchema,
  type BranchResponse,
  type BranchUpdate,
} from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../common/errors/domain-error.js';
import { assertVersion, changesOf, parseMergedRecord } from '../../../common/record-updates.js';
import { type ConstraintErrors, mapConstraintErrors } from '../../../infra/db/constraint-errors.js';
import { type Page, pageOf } from '../../../infra/db/list-query.js';
import { CompanyService } from '../company/company.service.js';
import { toBranchResponse } from './branches.mapper.js';
import { BranchesRepository } from './branches.repository.js';
import { type BranchRow } from './branches.schema.js';

const constraintErrors = (code: string | undefined): ConstraintErrors => ({
  branches_tenant_code_unique: () =>
    new ConflictError('ALREADY_EXISTS', `A branch with code ${code ?? ''} already exists.`),
});

const headOfficeRequired = (message: string): BusinessRuleError =>
  new BusinessRuleError('HEAD_OFFICE_REQUIRED', message);

/**
 * Branches (spec 02 §2–3). Exactly one head office: making a branch the head office moves the flag
 * from the current one, and the head office can be neither unset nor deactivated (422
 * `HEAD_OFFICE_REQUIRED`). A branch GSTIN is registered in the branch's state (contracts) under
 * the company's PAN. A branch with active godowns cannot be deactivated (409
 * `BRANCH_HAS_ACTIVE_GODOWNS`). DELETE deactivates. Every change runs under the tenant's branch
 * lock, which godown activation shares.
 */
@Injectable()
export class BranchesService {
  constructor(
    private readonly branches: BranchesRepository,
    private readonly company: CompanyService,
  ) {}

  async list(query: BranchListQuery): Promise<Page<BranchResponse>> {
    const { rows, total } = await this.branches.list(query);
    return pageOf(rows.map(toBranchResponse), total, query);
  }

  async get(id: string): Promise<BranchResponse> {
    return toBranchResponse(await this.require(id));
  }

  async create(input: BranchCreate): Promise<BranchResponse> {
    await this.branches.lockBranches();
    await this.assertCompanyPan(input.gstin);
    if (input.isHeadOffice) {
      if (!input.isActive) {
        throw ValidationError.forField('isHeadOffice', 'The head office must be active');
      }
      await this.branches.clearHeadOffice();
    }
    const row = await mapConstraintErrors(
      () => this.branches.insert(input),
      constraintErrors(input.code),
    );
    return toBranchResponse(row);
  }

  async update(id: string, patch: BranchUpdate): Promise<BranchResponse> {
    await this.branches.lockBranches();
    const existing = await this.require(id, { forUpdate: true });
    assertVersion(existing.version, patch.version);
    const changes = changesOf(patch);
    const merged = parseMergedRecord(branchRecordSchema, toBranchResponse(existing), changes);
    await this.assertTransition(existing, merged);
    if (changes.gstin !== undefined) await this.assertCompanyPan(merged.gstin);
    if (merged.isHeadOffice && !existing.isHeadOffice) await this.branches.clearHeadOffice();
    const row = await mapConstraintErrors(
      () => this.branches.update(id, changes),
      constraintErrors(changes.code),
    );
    return toBranchResponse(row);
  }

  /** Deactivates the branch, under the same rules as a PATCH with `isActive: false`. */
  async remove(id: string): Promise<void> {
    await this.branches.lockBranches();
    const existing = await this.require(id, { forUpdate: true });
    if (!existing.isActive) return;
    await this.assertTransition(existing, { isHeadOffice: existing.isHeadOffice, isActive: false });
    await this.branches.update(id, { isActive: false });
  }

  /**
   * The branch, if it exists and is active: a godown or series may only start using an active
   * branch. Callers that also change godowns hold the branch lock first ({@link lockBranches}).
   */
  async findActive(id: string): Promise<BranchResponse | undefined> {
    const row = await this.branches.findById(id);
    return row?.isActive === true ? toBranchResponse(row) : undefined;
  }

  /** Takes the tenant's branch lock (see the class comment). */
  lockBranches(): Promise<void> {
    return this.branches.lockBranches();
  }

  private async assertTransition(
    existing: BranchRow,
    next: Pick<BranchRecord, 'isHeadOffice' | 'isActive'>,
  ): Promise<void> {
    if (existing.isHeadOffice && !next.isHeadOffice) {
      throw headOfficeRequired('Make another branch the head office instead.');
    }
    if (next.isHeadOffice && !next.isActive) {
      if (existing.isHeadOffice) throw headOfficeRequired('The head office cannot be deactivated.');
      throw ValidationError.forField('isHeadOffice', 'The head office must be active');
    }
    if (existing.isActive && !next.isActive) {
      const active = await this.branches.countActiveGodowns(existing.id);
      if (active > 0) {
        throw new ConflictError(
          'BRANCH_HAS_ACTIVE_GODOWNS',
          `The branch has ${active} active godown(s). Deactivate or move them first.`,
        );
      }
    }
  }

  /** A branch GSTIN is a registration of the company's PAN (characters 3–12). */
  private async assertCompanyPan(gstin: string | null): Promise<void> {
    if (gstin === null) return;
    const { pan } = await this.company.settings();
    if (pan !== null && gstin.slice(2, 12) !== pan) {
      throw ValidationError.forField(
        'gstin',
        `The GSTIN belongs to PAN ${gstin.slice(2, 12)}, not the company's PAN ${pan}`,
      );
    }
  }

  private async require(id: string, options: { forUpdate?: boolean } = {}): Promise<BranchRow> {
    const row = await this.branches.findById(id, options);
    if (row === undefined) throw notFound();
    return row;
  }
}

const notFound = (): NotFoundError => new NotFoundError('NOT_FOUND', 'Branch not found.');
