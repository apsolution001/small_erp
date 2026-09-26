import {
  type InvitationListQuery,
  invitationListQuerySchema,
  type InvitationResponse,
  type PageMeta,
  uuidSchema,
} from '@ekaro/contracts';
import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Query } from '@nestjs/common';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { InvitationsService } from './invitations.service.js';

/**
 * `/api/v1/invitations`: the invitations sent (`POST /users` creates them). Revoking one
 * withdraws a user who never joined, so it takes `access.user:delete`.
 */
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @RequirePermission('access.user:view')
  list(
    @Query(new ZodValidationPipe(invitationListQuerySchema)) query: InvitationListQuery,
  ): Promise<{ data: InvitationResponse[]; meta: PageMeta }> {
    return this.invitations.list(query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('access.user:delete')
  revoke(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<void> {
    return this.invitations.revoke(id);
  }
}
