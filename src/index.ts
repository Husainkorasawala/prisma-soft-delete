/**
 * prisma-soft-delete
 *
 * A transparent soft delete extension for Prisma that integrates with
 * Prisma's `$extends` API. Once applied, all queries automatically
 * exclude soft-deleted records and all delete operations become soft deletes.
 *
 * ## Installation
 *
 * ```bash
 * npm install prisma-soft-delete
 * ```
 *
 * ## Prerequisites
 *
 * Add `deleted` and `deletedAt` fields to every model that should
 * participate in soft delete:
 *
 * ```prisma
 * model User {
 *   // ... your fields ...
 *   deleted   Boolean   @default(false)
 *   deletedAt DateTime? @map("deleted_at")
 *   @@index([deleted])
 * }
 * ```
 *
 * ## Quick Start
 *
 * ```ts
 * import { softDeleteExtension } from 'prisma-soft-delete';
 * import type { SoftDeleteConfig } from 'prisma-soft-delete';
 *
 * const softDeleteConfig: SoftDeleteConfig = {
 *   models: {
 *     user: {
 *       field: 'deleted',
 *       deletedAtField: 'deletedAt',
 *       cascadeRelations: [
 *         { model: 'post', foreignKey: 'authorId', sourceKey: 'id' },
 *       ],
 *     },
 *     post: { field: 'deleted', deletedAtField: 'deletedAt' },
 *   },
 *   relationToModel: {
 *     posts: 'post',
 *     author: 'user',
 *   },
 * };
 *
 * const db = new PrismaClient()
 *   .$extends(softDeleteExtension(softDeleteConfig));
 * ```
 *
 * ## Querying Deleted Records
 *
 * ```ts
 * import { withDeleted } from 'prisma-soft-delete';
 *
 * // Include soft-deleted records in results
 * const allUsers = await withDeleted(() => db.user.findMany());
 * ```
 *
 * ## Restoring Records
 *
 * ```ts
 * const user = await db.user.restore({ where: { id: 'some-id' } });
 * ```
 *
 * ## Important Notes
 *
 * - Apply this extension BEFORE other extensions (like pagination) so
 *   their internal queries go through the soft delete filter.
 * - `$queryRaw` and `$executeRaw` bypass all extensions — you must manually
 *   add `WHERE deleted = false` in raw queries.
 * - Soft-deleted records still occupy unique indexes. If you need to re-use
 *   a unique value (e.g., email), consider adding a partial unique index
 *   via raw SQL: `CREATE UNIQUE INDEX ... ON users(email) WHERE deleted = false`.
 */

export { withDeleted } from './context.js';
export { softDeleteExtension } from './extension.js';
export type {
  CascadeRelation,
  SoftDeleteConfig,
  SoftDeleteModelConfig,
} from './types.js';
