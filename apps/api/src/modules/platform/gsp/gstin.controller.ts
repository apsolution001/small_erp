import {
  type GstinLookupParams,
  gstinLookupParamsSchema,
  type GstinLookupResponse,
} from '@ekaro/contracts';
import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { GstinThrottles } from '../../../infra/throttling/throttling.module.js';
import { lookupGstinOrUnavailable } from './gsp-lookup.js';
import { GSP_PROVIDER, type GspProvider } from './gsp-provider.js';

@Controller('platform/gstin')
@UseGuards(ThrottlerGuard)
@GstinThrottles()
export class GstinController {
  constructor(@Inject(GSP_PROVIDER) private readonly gsp: GspProvider) {}

  /** Registration details for the signup form's auto-fill (spec 01 §3.1). 503 when the GSP fails. */
  @Get(':gstin')
  // Justification: used on the signup form before any account exists; limited per IP.
  @Public()
  lookup(
    @Param(new ZodValidationPipe(gstinLookupParamsSchema)) params: GstinLookupParams,
  ): Promise<GstinLookupResponse> {
    return lookupGstinOrUnavailable(this.gsp, params.gstin);
  }
}
