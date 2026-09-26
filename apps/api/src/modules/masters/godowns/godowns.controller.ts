import {
  type GodownCreate,
  godownCreateSchema,
  type GodownListQuery,
  godownListQuerySchema,
  type GodownResponse,
  type GodownUpdate,
  godownUpdateSchema,
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
import { GodownsService } from './godowns.service.js';

/** `/api/v1/godowns` (spec 02 §3), filterable by `?branchId=`. DELETE deactivates. */
@Controller('godowns')
export class GodownsController {
  constructor(private readonly godowns: GodownsService) {}

  @Get()
  @RequirePermission('masters.godown:view')
  list(
    @Query(new ZodValidationPipe(godownListQuerySchema)) query: GodownListQuery,
  ): Promise<Page<GodownResponse>> {
    return this.godowns.list(query);
  }

  @Get(':id')
  @RequirePermission('masters.godown:view')
  get(@IdParam() id: string): Promise<GodownResponse> {
    return this.godowns.get(id);
  }

  @Post()
  @RequirePermission('masters.godown:create')
  create(
    @Body(new ZodValidationPipe(godownCreateSchema)) body: GodownCreate,
  ): Promise<GodownResponse> {
    return this.godowns.create(body);
  }

  @Patch(':id')
  @RequirePermission('masters.godown:edit')
  update(
    @IdParam() id: string,
    @Body(new ZodValidationPipe(godownUpdateSchema)) body: GodownUpdate,
  ): Promise<GodownResponse> {
    return this.godowns.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('masters.godown:delete')
  remove(@IdParam() id: string): Promise<void> {
    return this.godowns.remove(id);
  }
}
