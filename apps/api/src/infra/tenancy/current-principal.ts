import { type ClsService } from 'nestjs-cls';
import { UnauthorizedError } from '../../common/errors/domain-error.js';
import { type Principal, type RequestContext } from './request-context.js';

/** The authenticated caller of the current request; a 401 when there is none. */
export function currentPrincipal(cls: ClsService<RequestContext>): Principal {
  const principal = cls.isActive() ? cls.get('principal') : undefined;
  if (principal === undefined) {
    throw new UnauthorizedError('UNAUTHENTICATED', 'Sign in to continue.');
  }
  return principal;
}
