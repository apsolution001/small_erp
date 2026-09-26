import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type ClsService } from 'nestjs-cls';
import { describe, expect, it } from 'vitest';
import { type RequestContext } from '../../infra/tenancy/request-context.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { type SessionAccessLoader } from './sessions/session-access.loader.js';
import { type AccessTokenService } from './tokens/access-token.service.js';

describe('JwtAuthGuard', () => {
  it('denies non-HTTP contexts before looking at anything else', async () => {
    const guard = new JwtAuthGuard(
      new Reflector(),
      {} as ClsService<RequestContext>,
      {} as AccessTokenService,
      {} as SessionAccessLoader,
    );
    for (const type of ['rpc', 'ws']) {
      const context = { getType: () => type } as unknown as ExecutionContext;
      expect(await guard.canActivate(context)).toBe(false);
    }
  });
});
