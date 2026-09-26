import {
  type UnitCreate,
  type UnitListQuery,
  unitRecordSchema,
  type UnitResponse,
  type UnitUpdate,
} from '@ekaro/contracts';
import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../../common/errors/domain-error.js';
import { assertVersion, changesOf, parseMergedRecord } from '../../../common/record-updates.js';
import {
  type ConstraintErrors,
  deleteUnlessReferenced,
  mapConstraintErrors,
} from '../../../infra/db/constraint-errors.js';
import { type Page, pageOf } from '../../../infra/db/list-query.js';
import { toUnitResponse } from './units.mapper.js';
import { UnitsRepository } from './units.repository.js';
import { type UnitRow } from './units.schema.js';

const constraintErrors = (code: string | undefined): ConstraintErrors => ({
  units_tenant_code_unique: () =>
    new ConflictError('ALREADY_EXISTS', `A unit with code ${code ?? ''} already exists.`),
});

/**
 * Units of measure (spec 02 §2–3). The reference implementation of a master (see the
 * new-business-module skill): list with search, sort allow-list and pagination; create; PATCH
 * with optimistic locking and merged-record validation; hard delete only while unreferenced
 * (409 `IN_USE` otherwise, so the user deactivates it instead).
 */
@Injectable()
export class UnitsService {
  constructor(private readonly units: UnitsRepository) {}

  async list(query: UnitListQuery): Promise<Page<UnitResponse>> {
    const { rows, total } = await this.units.list(query);
    return pageOf(rows.map(toUnitResponse), total, query);
  }

  async get(id: string): Promise<UnitResponse> {
    return toUnitResponse(await this.require(id));
  }

  async create(input: UnitCreate): Promise<UnitResponse> {
    const row = await mapConstraintErrors(
      () => this.units.insert(input),
      constraintErrors(input.code),
    );
    return toUnitResponse(row);
  }

  async update(id: string, patch: UnitUpdate): Promise<UnitResponse> {
    const existing = await this.require(id, { forUpdate: true });
    assertVersion(existing.version, patch.version);
    const changes = changesOf(patch);
    parseMergedRecord(unitRecordSchema, toUnitResponse(existing), changes);
    const row = await mapConstraintErrors(
      () => this.units.update(id, changes),
      constraintErrors(changes.code),
    );
    return toUnitResponse(row);
  }

  /** Deletes an unused unit; a unit that items use is 409 `IN_USE` (deactivate it instead). */
  async remove(id: string): Promise<void> {
    const deleted = await deleteUnlessReferenced(() => this.units.delete(id), 'unit');
    if (!deleted) throw notFound();
  }

  /** The active units among `ids`, for masters that start using a unit (items). */
  findActiveIds(ids: readonly string[]): Promise<Set<string>> {
    return this.units.findActiveIds(ids);
  }

  private async require(id: string, options: { forUpdate?: boolean } = {}): Promise<UnitRow> {
    const row = await this.units.findById(id, options);
    if (row === undefined) throw notFound();
    return row;
  }
}

const notFound = (): NotFoundError => new NotFoundError('NOT_FOUND', 'Unit not found.');
