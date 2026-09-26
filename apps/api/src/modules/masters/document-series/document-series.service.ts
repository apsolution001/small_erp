import {
  type DocumentSeriesCreate,
  type DocumentSeriesListQuery,
  documentSeriesRecordSchema,
  type DocumentSeriesResponse,
  type DocumentSeriesUpdate,
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
import { BranchesService } from '../branches/branches.service.js';
import { CompanyService } from '../company/company.service.js';
import { toDocumentSeriesResponse } from './document-series.mapper.js';
import { DocumentSeriesRepository } from './document-series.repository.js';
import { familyOf, findOverlappingSeries, type SeriesShape } from './document-series.rules.js';
import { type DocumentSeriesRow } from './document-series.schema.js';

const constraintErrors: ConstraintErrors = {
  document_series_tenant_key_unique: () =>
    new ConflictError(
      'ALREADY_EXISTS',
      'The branch already has a series with this prefix and suffix for this document type and FY.',
    ),
  document_series_branch_fk: () =>
    ValidationError.forField('branchId', 'The branch does not exist'),
};

/** The fields that shape the numbers a series issues. */
const NUMBERING_FIELDS = ['prefix', 'suffix', 'padding', 'nextNumber'] as const;

/**
 * Numbering series (MS-05, spec 02 §2–3, ADR 0010). Beyond the contract's GST rule 46 checks:
 * - the next number only increases (422 `SERIES_NUMBER_DECREASE`);
 * - the numbering fields are fixed once a number is issued (409 `SERIES_NUMBERING_LOCKED`);
 * - no two series of one GSTIN, document family and FY can render the same number (409
 *   `SERIES_NUMBERS_OVERLAP`), checked under a tenant lock;
 * - one default per (branch, document type, FY): making a series the default moves the flag.
 * Series are never deleted. A database trigger backs up the first two rules.
 */
@Injectable()
export class DocumentSeriesService {
  constructor(
    private readonly series: DocumentSeriesRepository,
    private readonly branches: BranchesService,
    private readonly company: CompanyService,
  ) {}

  async list(query: DocumentSeriesListQuery): Promise<Page<DocumentSeriesResponse>> {
    const { rows, total } = await this.series.list(query);
    return pageOf(rows.map(toDocumentSeriesResponse), total, query);
  }

  async get(id: string): Promise<DocumentSeriesResponse> {
    return toDocumentSeriesResponse(await this.require(id));
  }

  async create(input: DocumentSeriesCreate): Promise<DocumentSeriesResponse> {
    await this.series.lockSeries();
    const branch = await this.branches.findActive(input.branchId);
    if (branch === undefined) throw ValidationError.forField('branchId', 'Choose an active branch');
    await this.assertNoOverlap({ ...input, branchGstin: branch.gstin });
    if (input.isDefault) await this.series.clearDefault(input.branchId, input.docType, input.fy);
    const row = await mapConstraintErrors(
      () => this.series.insert({ ...input, nextNumber: BigInt(input.nextNumber) }),
      constraintErrors,
    );
    return toDocumentSeriesResponse(row);
  }

  async update(id: string, patch: DocumentSeriesUpdate): Promise<DocumentSeriesResponse> {
    await this.series.lockSeries();
    const existing = await this.require(id, { forUpdate: true });
    assertVersion(existing.version, patch.version);
    const changes = changesOf(patch);
    const current = toDocumentSeriesResponse(existing);
    const merged = parseMergedRecord(documentSeriesRecordSchema, current, changes);

    const renumbered = NUMBERING_FIELDS.filter(
      (field) => changes[field] !== undefined && String(changes[field]) !== String(current[field]),
    );
    if (renumbered.length > 0 && existing.lastIssuedNumber !== null) {
      throw new ConflictError(
        'SERIES_NUMBERING_LOCKED',
        `Numbers up to ${existing.lastIssuedNumber.toString()} are issued, so the numbering of this series is fixed.`,
      );
    }
    if (changes.nextNumber !== undefined && BigInt(changes.nextNumber) < existing.nextNumber) {
      throw new BusinessRuleError(
        'SERIES_NUMBER_DECREASE',
        `The next number cannot go back below ${existing.nextNumber.toString()}.`,
      );
    }
    if (renumbered.some((field) => field !== 'nextNumber')) {
      const branch = await this.branches.get(existing.branchId);
      await this.assertNoOverlap({ ...merged, id, branchGstin: branch.gstin });
    }
    if (merged.isDefault && !existing.isDefault) {
      await this.series.clearDefault(existing.branchId, existing.docType, existing.fy);
    }
    const { nextNumber, ...rest } = changes;
    const row = await mapConstraintErrors(
      () =>
        this.series.update(id, {
          ...rest,
          ...(nextNumber === undefined ? {} : { nextNumber: BigInt(nextNumber) }),
        }),
      constraintErrors,
    );
    return toDocumentSeriesResponse(row);
  }

  private async assertNoOverlap(candidate: SeriesShape): Promise<void> {
    const { gstin } = await this.company.settings();
    const existing = await this.series.findInFamily(candidate.fy, familyOf(candidate.docType));
    const clash = findOverlappingSeries(candidate, existing, gstin);
    if (clash !== undefined) {
      throw new ConflictError(
        'SERIES_NUMBERS_OVERLAP',
        `Numbers of this series could repeat those of the ${clash.docType} series ` +
          `"${clash.prefix}…${clash.suffix}" (${clash.fy}) issued under the same GSTIN.`,
      );
    }
  }

  private async require(
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<DocumentSeriesRow> {
    const row = await this.series.findById(id, options);
    if (row === undefined) throw notFound();
    return row;
  }
}

const notFound = (): NotFoundError => new NotFoundError('NOT_FOUND', 'Document series not found.');
