import { pgView, text, uuid } from 'drizzle-orm/pg-core';
import { citext } from '../../../infra/db/base-columns.js';
import { USER_STATUSES } from './users.schema.js';

/**
 * The auth module's read surface for tenant code (ADR 0017): the people who hold a membership in
 * the tenant in context, and only the columns a user list shows. `users` itself stays a platform
 * table; this view is `security_invoker`, so `ekaro_app` reads it under its own column grants and
 * the `tenant_member_read` policy on `users` (a row is visible only while a membership of the
 * current tenant, itself RLS-filtered, points at it). Created by the T-105 security migration.
 */
export const tenantUsers = pgView('tenant_users', {
  id: uuid().notNull(),
  email: citext().notNull(),
  fullName: text().notNull(),
  mobile: text(),
  status: text({ enum: USER_STATUSES }).notNull(),
}).existing();
