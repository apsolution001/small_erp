import {
  type AcceptInvitation,
  type AcceptInvitationResponse,
  acceptInvitationSchema,
  type InvitationPreview,
  type InvitationToken,
  invitationTokenSchema,
  type Login,
  type LoginResponse,
  loginSchema,
  type MeResponse,
  type SelectTenant,
  selectTenantSchema,
  type Signup,
  signupSchema,
  type SwitchTenant,
  switchTenantSchema,
  type TokenResponse,
} from '@ekaro/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { type Request, type Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { Authenticated } from '../../common/decorators/authenticated.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { UnauthorizedError } from '../../common/errors/domain-error.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { type Env } from '../../config/env.js';
import { InjectEnv } from '../../config/env.module.js';
import { currentPrincipal } from '../../infra/tenancy/current-principal.js';
import { AuthThrottles } from '../../infra/throttling/throttling.module.js';
import { type Principal, type RequestContext } from '../../infra/tenancy/request-context.js';
import { AuthService, type SessionGrant } from './auth.service.js';
import { InvitationAcceptanceService } from './invitations/invitation-acceptance.service.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './sessions/refresh-cookie.js';
import { type SessionMeta } from './sessions/session.service.js';

const USER_AGENT_MAX = 512;

/**
 * `/api/v1/auth` (spec 01 §3.1–3.2). Every route is rate limited per IP, and signup and login
 * also per email. The refresh token only ever travels in the httpOnly cookie.
 */
@Controller('auth')
@UseGuards(ThrottlerGuard)
@AuthThrottles()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly invitations: InvitationAcceptanceService,
    private readonly cls: ClsService<RequestContext>,
    @InjectEnv() private readonly env: Env,
  ) {}

  @Post('signup')
  // Justification: creates the account, so there is no session yet.
  @Public()
  async signup(
    @Body(new ZodValidationPipe(signupSchema)) body: Signup,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    return this.respond(res, await this.auth.signup(body, metaOf(req)));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Justification: exchanges credentials for a session.
  @Public()
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: Login,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const outcome = await this.auth.login(body, metaOf(req));
    return outcome.kind === 'session' ? this.respond(res, outcome.grant) : outcome.body;
  }

  @Post('select-tenant')
  @HttpCode(HttpStatus.OK)
  // Justification: second login step, authenticated by the signed selection token in the body.
  @Public()
  async selectTenant(
    @Body(new ZodValidationPipe(selectTenantSchema)) body: SelectTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    return this.respond(res, await this.auth.selectTenant(body, metaOf(req)));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  // Justification: authenticated by the refresh cookie; the access token may have expired.
  @Public()
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    const token = readRefreshCookie(req);
    if (token === undefined) {
      throw new UnauthorizedError('UNAUTHENTICATED', 'Sign in to continue.');
    }
    try {
      return this.respond(res, await this.auth.refresh(token, metaOf(req)));
    } catch (error) {
      // A refresh that fails leaves nothing usable in the cookie.
      clearRefreshCookie(res, this.env);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  // Justification: must work with an expired access token; it only ends the cookie's session.
  @Public()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(req));
    clearRefreshCookie(res, this.env);
  }

  @Post('switch-tenant')
  @HttpCode(HttpStatus.OK)
  // Justification: acts on the caller's own session; the target membership is checked instead.
  @Authenticated()
  async switchTenant(
    @Body(new ZodValidationPipe(switchTenantSchema)) body: SwitchTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    const grant = await this.auth.switchTenant(this.principal(), body.tenantId, metaOf(req));
    return this.respond(res, grant);
  }

  @Post('invitations/preview')
  @HttpCode(HttpStatus.OK)
  // Justification: the invitee has no session yet; the 256-bit token in the body is the credential.
  @Public()
  previewInvitation(
    @Body(new ZodValidationPipe(invitationTokenSchema)) body: InvitationToken,
  ): Promise<InvitationPreview> {
    return this.invitations.preview(body.token);
  }

  @Post('accept-invitation')
  @HttpCode(HttpStatus.OK)
  // Justification: the invitee has no session yet; the 256-bit token in the body is the credential.
  @Public()
  acceptInvitation(
    @Body(new ZodValidationPipe(acceptInvitationSchema)) body: AcceptInvitation,
  ): Promise<AcceptInvitationResponse> {
    return this.invitations.accept(body);
  }

  @Get('me')
  // Justification: every signed-in user may read their own session and permissions.
  @Authenticated()
  me(): Promise<MeResponse> {
    return this.auth.me(this.principal());
  }

  private respond(res: Response, grant: SessionGrant): TokenResponse {
    setRefreshCookie(res, this.env, grant.refresh);
    return grant.body;
  }

  private principal(): Principal {
    return currentPrincipal(this.cls);
  }
}

function metaOf(req: Request): SessionMeta {
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, USER_AGENT_MAX) ?? null,
  };
}
