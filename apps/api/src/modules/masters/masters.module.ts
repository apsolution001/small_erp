import { Module } from '@nestjs/common';
import { BranchesController } from './branches/branches.controller.js';
import { BranchesRepository } from './branches/branches.repository.js';
import { BranchesService } from './branches/branches.service.js';
import { CompanyController } from './company/company.controller.js';
import { CompanyRepository } from './company/company.repository.js';
import { CompanyService } from './company/company.service.js';
import { NoStockPostingsYet, STOCK_POSTINGS } from './company/stock-postings.port.js';
import { DocumentSeriesController } from './document-series/document-series.controller.js';
import { DocumentSeriesRepository } from './document-series/document-series.repository.js';
import { DocumentSeriesService } from './document-series/document-series.service.js';
import { GodownsController } from './godowns/godowns.controller.js';
import { GodownsRepository } from './godowns/godowns.repository.js';
import { GodownsService } from './godowns/godowns.service.js';
import { ItemCategoriesController } from './item-categories/item-categories.controller.js';
import { ItemCategoriesRepository } from './item-categories/item-categories.repository.js';
import { ItemCategoriesService } from './item-categories/item-categories.service.js';
import { ItemsController } from './items/items.controller.js';
import { ItemsRepository } from './items/items.repository.js';
import { ItemsService } from './items/items.service.js';
import { TaxRatesController } from './tax-rates/tax-rates.controller.js';
import { TaxRatesRepository } from './tax-rates/tax-rates.repository.js';
import { TaxRatesService } from './tax-rates/tax-rates.service.js';
import { PartiesController } from './parties/parties.controller.js';
import { PartiesRepository } from './parties/parties.repository.js';
import { PartiesService } from './parties/parties.service.js';
import { UnitsController } from './units/units.controller.js';
import { UnitsRepository } from './units/units.repository.js';
import { UnitsService } from './units/units.service.js';

/**
 * Masters (spec 02): the CRUD APIs of the tables the tenant bootstrap seeds, plus the catalog and
 * parties. Every repository works in the request's tenant transaction (`TransactionHost`).
 * `STOCK_POSTINGS` is bound to "nothing posted yet" until the posting engine exists (Sprint 2).
 */
@Module({
  controllers: [
    CompanyController,
    BranchesController,
    GodownsController,
    DocumentSeriesController,
    UnitsController,
    TaxRatesController,
    ItemCategoriesController,
    ItemsController,
    PartiesController,
  ],
  providers: [
    { provide: STOCK_POSTINGS, useClass: NoStockPostingsYet },
    CompanyRepository,
    CompanyService,
    BranchesRepository,
    BranchesService,
    GodownsRepository,
    GodownsService,
    DocumentSeriesRepository,
    DocumentSeriesService,
    UnitsRepository,
    UnitsService,
    TaxRatesRepository,
    TaxRatesService,
    ItemCategoriesRepository,
    ItemCategoriesService,
    ItemsRepository,
    ItemsService,
    PartiesRepository,
    PartiesService,
  ],
  exports: [
    CompanyService,
    BranchesService,
    GodownsService,
    DocumentSeriesService,
    UnitsService,
    TaxRatesService,
    ItemCategoriesService,
    ItemsService,
    PartiesService,
  ],
})
export class MastersModule {}
