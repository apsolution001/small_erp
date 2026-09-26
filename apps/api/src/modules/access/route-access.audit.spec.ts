import { Controller, Get, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { Authenticated } from '../../common/decorators/authenticated.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { RouteAccessAudit } from './route-access.audit.js';

@Controller('fine')
class FineController {
  @Get('open')
  // Justification (test fixture): public route.
  @Public()
  open(): string {
    return 'open';
  }

  @Get('me')
  // Justification (test fixture): session-only route.
  @Authenticated()
  me(): string {
    return 'me';
  }

  @Get('view')
  @RequirePermission('masters.item:view')
  view(): string {
    return 'view';
  }

  /** Not a route: never checked. */
  helper(): string {
    return 'helper';
  }
}

@Controller('bad')
class ConflictingController {
  @Get('public-and-permission')
  // Justification (test fixture): the conflict under test.
  @Public()
  @RequirePermission('masters.item:view')
  both(): string {
    return 'both';
  }
}

@Controller('bad-class')
@RequirePermission('masters.item:edit')
class ClassLevelConflictController {
  @Get('me')
  // Justification (test fixture): contradicts the controller's permission.
  @Authenticated()
  me(): string {
    return 'me';
  }
}

async function boot(...controllers: (new () => object)[]): Promise<void> {
  @Module({ imports: [DiscoveryModule], controllers, providers: [RouteAccessAudit] })
  class ProbeModule {}
  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  await moduleRef.init();
  await moduleRef.close();
}

describe('RouteAccessAudit', () => {
  it('boots when every route declares exactly one kind of access', async () => {
    await expect(boot(FineController)).resolves.toBeUndefined();
  });

  it('refuses to boot on @Public() or @Authenticated() combined with @RequirePermission()', async () => {
    await expect(boot(FineController, ConflictingController, ClassLevelConflictController)).rejects
      .toThrow(`Routes with conflicting access declarations (use exactly one):
  ConflictingController.both: @Public() + @RequirePermission()
  ClassLevelConflictController.me: @Authenticated() + @RequirePermission()`);
  });
});
