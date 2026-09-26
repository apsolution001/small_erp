import {
  type PartyCreate,
  partyCreateSchema,
  type PartyListQuery,
  partyListQuerySchema,
  type PartyResponse,
  type PartyUpdate,
  partyUpdateSchema,
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
import { PartiesService } from './parties.service.js';

/** `/api/v1/parties` (spec 02 §3): addresses nested in the payload. DELETE deactivates. */
@Controller('parties')
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  @Get()
  @RequirePermission('masters.party:view')
  list(
    @Query(new ZodValidationPipe(partyListQuerySchema)) query: PartyListQuery,
  ): Promise<Page<PartyResponse>> {
    return this.parties.list(query);
  }

  @Get(':id')
  @RequirePermission('masters.party:view')
  get(@IdParam() id: string): Promise<PartyResponse> {
    return this.parties.get(id);
  }

  @Post()
  @RequirePermission('masters.party:create')
  create(
    @Body(new ZodValidationPipe(partyCreateSchema)) body: PartyCreate,
  ): Promise<PartyResponse> {
    return this.parties.create(body);
  }

  @Patch(':id')
  @RequirePermission('masters.party:edit')
  update(
    @IdParam() id: string,
    @Body(new ZodValidationPipe(partyUpdateSchema)) body: PartyUpdate,
  ): Promise<PartyResponse> {
    return this.parties.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('masters.party:delete')
  remove(@IdParam() id: string): Promise<void> {
    return this.parties.remove(id);
  }
}
