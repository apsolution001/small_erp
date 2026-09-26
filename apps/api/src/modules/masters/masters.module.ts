import { Module } from '@nestjs/common';
import { ItemCategoriesController } from './item-categories/item-categories.controller.js';
import { ItemCategoriesRepository } from './item-categories/item-categories.repository.js';
import { ItemCategoriesService } from './item-categories/item-categories.service.js';
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
  controllers: [UnitsController, TaxRatesController, ItemCategoriesController],
  providers: [
    UnitsRepository,
    UnitsService,
    TaxRatesRepository,
    TaxRatesService,
    ItemCategoriesRepository,
    ItemCategoriesService,
  ],
  exports: [UnitsService, TaxRatesService, ItemCategoriesService],
})
export class MastersModule {}
