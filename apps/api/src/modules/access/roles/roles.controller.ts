import {
  type PageMeta,
  type RoleClone,
  roleCloneSchema,
  type RoleCreate,
  roleCreateSchema,
  type RoleListQuery,
  roleListQuerySchema,
  type RoleResponse,
  type RoleUpdate,
  roleUpdateSchema,
  uuidSchema,
} from '@ekaro/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { RolesService } from './roles.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);

/** `/api/v1/roles` (spec 01 §3.3). */
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('access.role:view')
  list(
    @Query(new ZodValidationPipe(roleListQuerySchema)) query: RoleListQuery,
  ): Promise<{ data: RoleResponse[]; meta: PageMeta }> {
    return this.roles.list(query);
  }

  @Get(':id')
  @RequirePermission('access.role:view')
  get(@Param('id', idPipe) id: string): Promise<RoleResponse> {
    return this.roles.get(id);
  }

  @Post()
  @RequirePermission('access.role:create')
  create(@Body(new ZodValidationPipe(roleCreateSchema)) body: RoleCreate): Promise<RoleResponse> {
    return this.roles.create(body);
  }

  @Patch(':id')
  @RequirePermission('access.role:edit')
  update(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(roleUpdateSchema)) body: RoleUpdate,
  ): Promise<RoleResponse> {
    return this.roles.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('access.role:delete')
  delete(@Param('id', idPipe) id: string): Promise<void> {
    return this.roles.delete(id);
  }

  @Post(':id/clone')
  @RequirePermission('access.role:create')
  clone(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(roleCloneSchema)) body: RoleClone,
  ): Promise<RoleResponse> {
    return this.roles.clone(id, body);
  }
}
