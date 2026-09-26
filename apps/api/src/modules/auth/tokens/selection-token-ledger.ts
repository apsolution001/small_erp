import { Inject, Injectable } from '@nestjs/common';
import { type Redis } from 'ioredis';
import { Clock } from '../../../infra/clock/clock.js';
import { REDIS } from '../../../infra/redis/redis.module.js';
import { type SelectionClaims } from './access-token.service.js';

const KEY_PREFIX = 'ekaro:selection-used:';

/**
 * Makes tenant-selection tokens single-use: the first use records the token id (`SET NX`) until
 * the token expires anyway, and any later use is refused. A replayed or leaked selection token
 * can therefore not start a second session.
 */
@Injectable()
export class SelectionTokenLedger {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly clock: Clock,
  ) {}

  /** True the first time a token is consumed, false on every later attempt. */
  async consume(selection: SelectionClaims): Promise<boolean> {
    const ttlMs = Math.max(1, selection.expiresAt.getTime() - this.clock.now().getTime());
    const set = await this.redis.set(`${KEY_PREFIX}${selection.tokenId}`, '1', 'PX', ttlMs, 'NX');
    return set === 'OK';
  }
}
