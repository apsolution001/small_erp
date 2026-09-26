import { Module } from '@nestjs/common';
import { DbModule } from '../../infra/db/db.module.js';
import { RedisModule } from '../../infra/redis/redis.module.js';
import { ThrottlingModule } from '../../infra/throttling/throttling.module.js';
import { AccessModule } from '../access/index.js';
import { PlatformModule } from '../platform/index.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordHasher } from './passwords/password-hasher.js';
import { Pseudonymizer } from './security/pseudonymizer.js';
import { SecurityEventLog } from './security/security-events.js';
import { SessionAccessLoader } from './sessions/session-access.loader.js';
import { SessionService } from './sessions/session.service.js';
import { AccessTokenService } from './tokens/access-token.service.js';
import { SelectionTokenLedger } from './tokens/selection-token-ledger.js';
import { LoginLockout } from './users/login-lockout.js';
import { UsersRepository } from './users/users.repository.js';

/** Users, sessions and authentication (ADR 0006). `JwtAuthGuard` is registered globally by the app. */
@Module({
  imports: [DbModule, RedisModule, ThrottlingModule, AccessModule, PlatformModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenService,
    JwtAuthGuard,
    LoginLockout,
    PasswordHasher,
    Pseudonymizer,
    SecurityEventLog,
    SelectionTokenLedger,
    SessionAccessLoader,
    SessionService,
    UsersRepository,
  ],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
