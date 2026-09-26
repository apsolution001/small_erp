import {
  type TaxRateCreate,
  taxRateCreateSchema,
  type TaxRateListQuery,
  taxRateListQuerySchema,
  type TaxRateResponse,
  type TaxRateUpdate,
  taxRateUpdateSchema,
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
import { TaxRatesService } from './tax-rates.service.js';

/** `/api/v1/tax-rates` (spec 02 §3). PATCH changes only `name` and `isActive`. */
@Controller('tax-rates')
export class TaxRatesController {
  constructor(private readonly taxRates: TaxRatesService) {}

  @Get()
  @RequirePermission('masters.tax_rate:view')
  list(
    @Query(new ZodValidationPipe(taxRateListQuerySchema)) query: TaxRateListQuery,
  ): Promise<Page<TaxRateResponse>> {
    return this.taxRates.list(query);
  }

  @Get(':id')
  @RequirePermission('masters.tax_rate:view')
  get(@IdParam() id: string): Promise<TaxRateResponse> {
    return this.taxRates.get(id);
  }

  @Post()
  @RequirePermission('masters.tax_rate:create')
  create(
    @Body(new ZodValidationPipe(taxRateCreateSchema)) body: TaxRateCreate,
  ): Promise<TaxRateResponse> {
    return this.taxRates.create(body);
  }

  @Patch(':id')
  @RequirePermission('masters.tax_rate:edit')
  update(
    @IdParam() id: string,
    @Body(new ZodValidationPipe(taxRateUpdateSchema)) body: TaxRateUpdate,
  ): Promise<TaxRateResponse> {
    return this.taxRates.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('masters.tax_rate:delete')
  remove(@IdParam() id: string): Promise<void> {
    return this.taxRates.remove(id);
  }
}
