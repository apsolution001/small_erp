/** Public surface of the access module (ADR 0015 for the executor-based functions). */
export { type AccessSnapshot, AccessCache } from './access-cache.js';
export { AccessModule } from './access.module.js';
export { ensureOwnerMembership, seedSystemRoles } from './access.seed.js';
export {
  findActiveMembershipsOfUser,
  loadMembershipAccess,
  type MembershipAccess,
  type UserMembership,
} from './memberships/memberships.queries.js';
export { PermissionGuard } from './permission.guard.js';
