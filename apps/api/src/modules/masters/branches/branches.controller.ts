import {
  type BranchCreate,
  branchCreateSchema,
  type BranchListQuery,
  branchListQuerySchema,
  type BranchResponse,
  type BranchUpdate,
  branchUpdateSchema,
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
import { BranchesService } from './branches.service.js';

/** `/api/v1/branches` (spec 02 §3). DELETE deactivates. */
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequirePermission('masters.branch:view')
  list(
    @Query(new ZodValidationPipe(branchListQuerySchema)) query: BranchListQuery,
  ): Promise<Page<BranchResponse>> {
    return this.branches.list(query);
  }

  @Get(':id')
  @RequirePermission('masters.branch:view')
  get(@IdParam() id: string): Promise<BranchResponse> {
    return this.branches.get(id);
  }

  @Post()
  @RequirePermission('masters.branch:create')
  create(
    @Body(new ZodValidationPipe(branchCreateSchema)) body: BranchCreate,
  ): Promise<BranchResponse> {
    return this.branches.create(body);
  }

  @Patch(':id')
  @RequirePermission('masters.branch:edit')
  update(
    @IdParam() id: string,
    @Body(new ZodValidationPipe(branchUpdateSchema)) body: BranchUpdate,
  ): Promise<BranchResponse> {
    return this.branches.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('masters.branch:delete')
  remove(@IdParam() id: string): Promise<void> {
    return this.branches.remove(id);
  }
}
