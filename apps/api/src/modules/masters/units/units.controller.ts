import {
  type UnitCreate,
  unitCreateSchema,
  type UnitListQuery,
  unitListQuerySchema,
  type UnitResponse,
  type UnitUpdate,
  unitUpdateSchema,
} from '@ekaro/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IdParam } from '../../../common/decorators/id-param.decorator.js';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { type Page } from '../../../infra/db/list-query.js';
import { UnitsService } from './units.service.js';

/** `/api/v1/units` (spec 02 §3). HTTP only: validate with the contracts, call the service. */
@Controller('units')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  @RequirePermission('masters.unit:view')
  list(
    @Query(new ZodValidationPipe(unitListQuerySchema)) query: UnitListQuery,
  ): Promise<Page<UnitResponse>> {
    return this.units.list(query);
  }

  @Get(':id')
  @RequirePermission('masters.unit:view')
  get(@IdParam() id: string): Promise<UnitResponse> {
    return this.units.get(id);
  }

  @Post()
  @RequirePermission('masters.unit:create')
  create(@Body(new ZodValidationPipe(unitCreateSchema)) body: UnitCreate): Promise<UnitResponse> {
    return this.units.create(body);
  }

  @Patch(':id')
  @RequirePermission('masters.unit:edit')
  update(
    @IdParam() id: string,
    @Body(new ZodValidationPipe(unitUpdateSchema)) body: UnitUpdate,
  ): Promise<UnitResponse> {
    return this.units.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('masters.unit:delete')
  remove(@IdParam() id: string): Promise<void> {
    return this.units.remove(id);
  }
}
