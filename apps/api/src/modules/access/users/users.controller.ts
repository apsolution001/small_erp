import {
  type InvitationResponse,
  type PageMeta,
  type UserInvite,
  userInviteSchema,
  type UserListQuery,
  userListQuerySchema,
  type UserResponse,
  type UserUpdate,
  userUpdateSchema,
  uuidSchema,
} from '@ekaro/contracts';
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { InvitationsService } from '../invitations/invitations.service.js';
import { UsersService } from './users.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);

/** `/api/v1/users`: the tenant's users, i.e. memberships (spec 01 §3.3). `:id` is the membership. */
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get()
  @RequirePermission('access.user:view')
  list(
    @Query(new ZodValidationPipe(userListQuerySchema)) query: UserListQuery,
  ): Promise<{ data: UserResponse[]; meta: PageMeta }> {
    return this.users.list(query);
  }

  @Get(':id')
  @RequirePermission('access.user:view')
  get(@Param('id', idPipe) id: string): Promise<UserResponse> {
    return this.users.get(id);
  }

  /** Adding a user sends an invitation; the membership exists once it is accepted. */
  @Post()
  @RequirePermission('access.user:create')
  invite(
    @Body(new ZodValidationPipe(userInviteSchema)) body: UserInvite,
  ): Promise<InvitationResponse> {
    return this.invitations.invite(body);
  }

  @Patch(':id')
  @RequirePermission('access.user:edit')
  update(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(userUpdateSchema)) body: UserUpdate,
  ): Promise<UserResponse> {
    return this.users.update(id, body);
  }
}
