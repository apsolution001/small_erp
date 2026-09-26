import { type CompanyResponse, type CompanyUpdate, companyUpdateSchema } from '@ekaro/contracts';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { CompanyService } from './company.service.js';

/** `/api/v1/company` (spec 02 §3): the tenant's single company profile. */
@Controller('company')
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get()
  @RequirePermission('masters.company:view')
  get(): Promise<CompanyResponse> {
    return this.company.get();
  }

  @Patch()
  @RequirePermission('masters.company:edit')
  update(
    @Body(new ZodValidationPipe(companyUpdateSchema)) body: CompanyUpdate,
  ): Promise<CompanyResponse> {
    return this.company.update(body);
  }
}
