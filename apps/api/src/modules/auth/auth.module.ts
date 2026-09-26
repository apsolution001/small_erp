import { Module } from '@nestjs/common';
import { DbModule } from '../../infra/db/db.module.js';
import { ThrottlingModule } from '../../infra/throttling/throttling.module.js';
import { AccessModule } from '../access/index.js';
import { PlatformModule } from '../platform/index.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordHasher } from './passwords/password-hasher.js';
import { SessionAccessLoader } from './sessions/session-access.loader.js';
import { SessionService } from './sessions/session.service.js';
import { AccessTokenService } from './tokens/access-token.service.js';
import { UsersRepository } from './users/users.repository.js';

/** Users, sessions and authentication (ADR 0006). `JwtAuthGuard` is registered globally by the app. */
@Module({
  imports: [DbModule, ThrottlingModule, AccessModule, PlatformModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenService,
    JwtAuthGuard,
    PasswordHasher,
    SessionAccessLoader,
    SessionService,
    UsersRepository,
  ],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
