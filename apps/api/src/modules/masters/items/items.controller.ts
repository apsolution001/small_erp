import {
  type ItemCreate,
  itemCreateSchema,
  type ItemListQuery,
  itemListQuerySchema,
  type ItemResponse,
  type ItemTaxRateCreate,
  itemTaxRateCreateSchema,
  type ItemTaxRateListQuery,
  itemTaxRateListQuerySchema,
  type ItemTaxRateResponse,
  type ItemUpdate,
  itemUpdateSchema,
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
import { ItemsService } from './items.service.js';

/**
 * `/api/v1/items` (spec 02 §3): conversions nested in the payload, effective-dated GST rates as a
 * sub-resource with their own permissions. DELETE deactivates.
 */
@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @RequirePermission('masters.item:view')
  list(
    @Query(new ZodValidationPipe(itemListQuerySchema)) query: ItemListQuery,
  ): Promise<Page<ItemResponse>> {
    return this.items.list(query);
  }

  @Get(':id')
  @RequirePermission('masters.item:view')
  get(@IdParam() id: string): Promise<ItemResponse> {
    return this.items.get(id);
  }

  @Post()
  @RequirePermission('masters.item:create')
  create(@Body(new ZodValidationPipe(itemCreateSchema)) body: ItemCreate): Promise<ItemResponse> {
    return this.items.create(body);
  }

  @Patch(':id')
  @RequirePermission('masters.item:edit')
  update(
    @IdParam() id: string,
    @Body(new ZodValidationPipe(itemUpdateSchema)) body: ItemUpdate,
  ): Promise<ItemResponse> {
    return this.items.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('masters.item:delete')
  remove(@IdParam() id: string): Promise<void> {
    return this.items.remove(id);
  }

  @Get(':id/tax-rates')
  @RequirePermission('masters.item_tax_rate:view')
  taxRates(
    @IdParam() id: string,
    @Query(new ZodValidationPipe(itemTaxRateListQuerySchema)) query: ItemTaxRateListQuery,
  ): Promise<ItemTaxRateResponse[]> {
    return this.items.taxRates(id, query);
  }

  @Post(':id/tax-rates')
  @RequirePermission('masters.item_tax_rate:create')
  addTaxRate(
    @IdParam() id: string,
    @Body(new ZodValidationPipe(itemTaxRateCreateSchema)) body: ItemTaxRateCreate,
  ): Promise<ItemTaxRateResponse> {
    return this.items.addTaxRate(id, body);
  }
}
