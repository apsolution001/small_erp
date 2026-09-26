import {
  type DocumentSeriesCreate,
  documentSeriesCreateSchema,
  type DocumentSeriesListQuery,
  documentSeriesListQuerySchema,
  type DocumentSeriesResponse,
  type DocumentSeriesUpdate,
  documentSeriesUpdateSchema,
} from '@ekaro/contracts';
import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { IdParam } from '../../../common/decorators/id-param.decorator.js';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { type Page } from '../../../infra/db/list-query.js';
import { DocumentSeriesService } from './document-series.service.js';

/** `/api/v1/document-series` (spec 02 §3): no DELETE, series are never removed. */
@Controller('document-series')
export class DocumentSeriesController {
  constructor(private readonly series: DocumentSeriesService) {}

  @Get()
  @RequirePermission('masters.series:view')
  list(
    @Query(new ZodValidationPipe(documentSeriesListQuerySchema)) query: DocumentSeriesListQuery,
  ): Promise<Page<DocumentSeriesResponse>> {
    return this.series.list(query);
  }

  @Get(':id')
  @RequirePermission('masters.series:view')
  get(@IdParam() id: string): Promise<DocumentSeriesResponse> {
    return this.series.get(id);
  }

  @Post()
  @RequirePermission('masters.series:create')
  create(
    @Body(new ZodValidationPipe(documentSeriesCreateSchema)) body: DocumentSeriesCreate,
  ): Promise<DocumentSeriesResponse> {
    return this.series.create(body);
  }

  @Patch(':id')
  @RequirePermission('masters.series:edit')
  update(
    @IdParam() id: string,
    @Body(new ZodValidationPipe(documentSeriesUpdateSchema)) body: DocumentSeriesUpdate,
  ): Promise<DocumentSeriesResponse> {
    return this.series.update(id, body);
  }
}
