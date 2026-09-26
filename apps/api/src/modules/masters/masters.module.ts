import { Module } from '@nestjs/common';
import { TaxRatesController } from './tax-rates/tax-rates.controller.js';
import { TaxRatesRepository } from './tax-rates/tax-rates.repository.js';
import { TaxRatesService } from './tax-rates/tax-rates.service.js';
import { UnitsController } from './units/units.controller.js';
import { UnitsRepository } from './units/units.repository.js';
import { UnitsService } from './units/units.service.js';

/**
 * Masters (spec 02): the CRUD APIs of the tables the tenant bootstrap seeds, plus the catalog and
 * parties. Every repository works in the request's tenant transaction (`TransactionHost`).
 */
@Module({
  controllers: [UnitsController, TaxRatesController],
  providers: [UnitsRepository, UnitsService, TaxRatesRepository, TaxRatesService],
  exports: [UnitsService, TaxRatesService],
})
export class MastersModule {}
