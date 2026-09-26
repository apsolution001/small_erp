import { Module } from '@nestjs/common';
import { UnitsController } from './units/units.controller.js';
import { UnitsRepository } from './units/units.repository.js';
import { UnitsService } from './units/units.service.js';

/**
 * Masters (spec 02): the CRUD APIs of the tables the tenant bootstrap seeds, plus the catalog and
 * parties. Every repository works in the request's tenant transaction (`TransactionHost`).
 */
@Module({
  controllers: [UnitsController],
  providers: [UnitsRepository, UnitsService],
  exports: [UnitsService],
})
export class MastersModule {}
