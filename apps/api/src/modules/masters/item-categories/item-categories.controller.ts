import {
  type ItemCategoryCreate,
  itemCategoryCreateSchema,
  type ItemCategoryListQuery,
  itemCategoryListQuerySchema,
  type ItemCategoryResponse,
  type ItemCategoryTreeNode,
  type ItemCategoryUpdate,
  itemCategoryUpdateSchema,
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
import { ItemCategoriesService } from './item-categories.service.js';

/**
 * `/api/v1/item-categories` (spec 02 §3). `?tree=true` returns the whole forest as
 * `ItemCategoryTreeNode[]` (only `active` applies to it); otherwise a page of flat rows.
 */
@Controller('item-categories')
export class ItemCategoriesController {
  constructor(private readonly categories: ItemCategoriesService) {}

  @Get()
  @RequirePermission('masters.item_category:view')
  list(
    @Query(new ZodValidationPipe(itemCategoryListQuerySchema)) query: ItemCategoryListQuery,
  ): Promise<Page<ItemCategoryResponse> | ItemCategoryTreeNode[]> {
    return query.tree === true ? this.categories.tree(query.active) : this.categories.list(query);
  }

  @Get(':id')
  @RequirePermission('masters.item_category:view')
  get(@IdParam() id: string): Promise<ItemCategoryResponse> {
    return this.categories.get(id);
  }

  @Post()
  @RequirePermission('masters.item_category:create')
  create(
    @Body(new ZodValidationPipe(itemCategoryCreateSchema)) body: ItemCategoryCreate,
  ): Promise<ItemCategoryResponse> {
    return this.categories.create(body);
  }

  @Patch(':id')
  @RequirePermission('masters.item_category:edit')
  update(
    @IdParam() id: string,
    @Body(new ZodValidationPipe(itemCategoryUpdateSchema)) body: ItemCategoryUpdate,
  ): Promise<ItemCategoryResponse> {
    return this.categories.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('masters.item_category:delete')
  remove(@IdParam() id: string): Promise<void> {
    return this.categories.remove(id);
  }
}
