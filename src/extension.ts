/**
 * Core Prisma client extension for soft delete.
 *
 * This extension transparently modifies Prisma's query behavior so that:
 *
 * 1. **Read operations** (`findUnique`, `findFirst`, `findMany`, `count`,
 *    `aggregate`, `groupBy`) automatically exclude records where
 *    `deleted = true`, unless bypassed with `withDeleted()`.
 *
 * 2. **Delete operations** (`delete`, `deleteMany`) are rewritten to
 *    `update`/`updateMany` calls that set `deleted = true` and
 *    `deletedAt = now()`, with cascade to related models.
 *
 * 3. **Write operations** (`update`, `updateMany`, `upsert`) are guarded
 *    to prevent manual changes to `deleted`/`deletedAt` fields and
 *    automatically scope updates to non-deleted records.
 *
 * 4. A `restore()` model method is provided for undoing soft deletes.
 *
 * ## Architecture
 *
 * The extension uses **per-operation query overrides** on `$allModels`
 * rather than `$allOperations`. This gives full type safety on the `args`
 * parameter for each operation and avoids runtime string matching.
 *
 * ## `findUnique` Special Case
 *
 * Prisma's `findUnique` requires the `where` clause to exactly match a
 * `@id` or `@@unique` constraint. Adding `deleted: false` to the where
 * clause would violate this constraint and cause a type error. The
 * workaround is to rewrite `findUnique` as `findFirst` with the same
 * filters plus `deleted: false`. For `findUniqueOrThrow`, we throw an
 * error if no result is found.
 *
 * ## Extension Ordering
 *
 * This extension should be applied BEFORE other extensions (like
 * pagination) so that their internal queries automatically go through
 * the soft delete filter.
 */

import { Prisma } from '@prisma/client/extension';
import { cascadeSoftDelete, cascadeSoftDeleteMany } from './cascade.js';
import {
  shouldApplyFilter,
  withCascadeContext,
  withDeleted,
} from './context.js';
import {
  assertNoSoftDeleteFieldMutation,
  filterNestedRelations,
  injectDeletedFilter,
  isSoftDeleteModel,
  normalizeModelName,
} from './filters.js';
import type { SoftDeleteConfig, SoftDeleteModelConfig } from './types.js';

/**
 * Operation callback shape — Prisma passes { model, args, query }
 * to each per-operation override. We type this generically since
 * the library has no generated client to infer from.
 */
// biome-ignore lint/suspicious/noExplicitAny: Generic Prisma operation args
type OperationParams = { model?: string; args: any; query: (args: any) => any };

/**
 * Get the soft delete config for a model.
 * Called only after `isSoftDeleteModel` has confirmed the model exists.
 */
function getModelConfig(
  model: string,
  config: SoftDeleteConfig,
): SoftDeleteModelConfig {
  const modelKey = normalizeModelName(model);
  // biome-ignore lint/style/noNonNullAssertion: guaranteed by isSoftDeleteModel check
  return config.models[modelKey]!;
}

/**
 * Creates the soft delete Prisma extension.
 *
 * @param config - Configuration specifying which models participate in
 *                 soft delete, their field names, cascade relations, and
 *                 relation-to-model mappings for nested query filtering.
 * @returns A Prisma extension to be used with `$extends()`
 *
 * @example
 * ```ts
 * import { softDeleteExtension } from 'prisma-soft-delete';
 *
 * const db = new PrismaClient()
 *   .$extends(softDeleteExtension({
 *     models: {
 *       user: {
 *         field: 'deleted',
 *         deletedAtField: 'deletedAt',
 *         cascadeRelations: [
 *           { model: 'post', foreignKey: 'authorId', sourceKey: 'id' },
 *         ],
 *       },
 *       post: { field: 'deleted', deletedAtField: 'deletedAt' },
 *     },
 *     relationToModel: { posts: 'post', author: 'user' },
 *   }));
 * ```
 */
export function softDeleteExtension(config: SoftDeleteConfig) {
  return Prisma.defineExtension({
    name: 'softDelete',

    query: {
      $allModels: {
        // ── Read Operations ──────────────────────────────────────────
        //
        // Each read operation injects `deleted: false` into the where
        // clause and filters nested relations in include/select.

        async findFirst({ model, args, query }: OperationParams) {
          if (
            model &&
            isSoftDeleteModel(model, config) &&
            shouldApplyFilter()
          ) {
            const mc = getModelConfig(model, config);
            args.where = injectDeletedFilter(args.where, mc.field);
            args = filterNestedRelations(args, config);
          }
          return query(args);
        },

        async findFirstOrThrow({ model, args, query }: OperationParams) {
          if (
            model &&
            isSoftDeleteModel(model, config) &&
            shouldApplyFilter()
          ) {
            const mc = getModelConfig(model, config);
            args.where = injectDeletedFilter(args.where, mc.field);
            args = filterNestedRelations(args, config);
          }
          return query(args);
        },

        async findMany({ model, args, query }: OperationParams) {
          if (
            model &&
            isSoftDeleteModel(model, config) &&
            shouldApplyFilter()
          ) {
            const mc = getModelConfig(model, config);
            args.where = injectDeletedFilter(args.where, mc.field);
            args = filterNestedRelations(args, config);
          }
          return query(args);
        },

        /**
         * findUnique requires special handling because Prisma validates
         * that the `where` clause matches a @id or @@unique constraint.
         * Adding `deleted: false` would break this validation.
         *
         * Solution: Rewrite to `findFirst` with the same where clause
         * plus the soft delete filter. The `findFirst` operation accepts
         * arbitrary where conditions.
         */
        async findUnique(
          this: unknown,
          { model, args, query }: OperationParams,
        ) {
          if (
            model &&
            isSoftDeleteModel(model, config) &&
            shouldApplyFilter()
          ) {
            const modelKey = normalizeModelName(model);
            const mc = getModelConfig(model, config);

            // Access the model delegate on the Prisma client to call findFirst.
            // `this` in a Prisma query extension refers to the current client.
            // biome-ignore lint/suspicious/noExplicitAny: Prisma extension client type
            const client = this as any;
            const filteredArgs = filterNestedRelations(args, config);

            return client[modelKey].findFirst({
              ...filteredArgs,
              where: injectDeletedFilter(
                filteredArgs.where as Record<string, unknown> | undefined,
                mc.field,
              ),
            });
          }
          return query(args);
        },

        /**
         * Same findFirst rewrite as findUnique, but throws an error
         * if no result is found — matching the behavior of the
         * original `findUniqueOrThrow`.
         */
        async findUniqueOrThrow(
          this: unknown,
          { model, args, query }: OperationParams,
        ) {
          if (
            model &&
            isSoftDeleteModel(model, config) &&
            shouldApplyFilter()
          ) {
            const modelKey = normalizeModelName(model);
            const mc = getModelConfig(model, config);

            // biome-ignore lint/suspicious/noExplicitAny: Prisma extension client type
            const client = this as any;
            const filteredArgs = filterNestedRelations(args, config);

            const result = await client[modelKey].findFirst({
              ...filteredArgs,
              where: injectDeletedFilter(
                filteredArgs.where as Record<string, unknown> | undefined,
                mc.field,
              ),
            });

            if (!result) {
              throw new Error(
                `No ${model} found (soft delete filtered). [P2025]`,
              );
            }

            return result;
          }
          return query(args);
        },

        async count({ model, args, query }: OperationParams) {
          if (
            model &&
            isSoftDeleteModel(model, config) &&
            shouldApplyFilter()
          ) {
            const mc = getModelConfig(model, config);
            args.where = injectDeletedFilter(args.where, mc.field);
          }
          return query(args);
        },

        async aggregate({ model, args, query }: OperationParams) {
          if (
            model &&
            isSoftDeleteModel(model, config) &&
            shouldApplyFilter()
          ) {
            const mc = getModelConfig(model, config);
            args.where = injectDeletedFilter(args.where, mc.field);
          }
          return query(args);
        },

        async groupBy({ model, args, query }: OperationParams) {
          if (
            model &&
            isSoftDeleteModel(model, config) &&
            shouldApplyFilter()
          ) {
            const mc = getModelConfig(model, config);
            args.where = injectDeletedFilter(args.where, mc.field);
          }
          return query(args);
        },

        // ── Delete Operations ────────────────────────────────────────
        //
        // Instead of issuing a SQL DELETE, these operations rewrite to
        // UPDATE calls that set `deleted = true` and `deletedAt = now()`.
        // Cascade relations are soft-deleted before the parent.

        /**
         * Converts `delete()` to an `update()` that marks the record
         * as soft-deleted. Cascades to configured child relations.
         *
         * The original `query()` callback is NOT called — it would
         * issue a hard DELETE. Instead, we use the client's model
         * delegate to perform an update.
         */
        async delete(
          this: unknown,
          { model, args, query: _query }: OperationParams,
        ) {
          if (!model || !isSoftDeleteModel(model, config)) return _query(args);

          const modelKey = normalizeModelName(model);
          const mc = getModelConfig(model, config);

          // biome-ignore lint/suspicious/noExplicitAny: Prisma extension client type
          const client = this as any;

          // Cascade soft-delete to child relations first
          await cascadeSoftDelete(client, model, args.where, config);

          // Soft-delete the parent record by updating it.
          // Use `withCascadeContext` to bypass the mutation guard since
          // we're setting `deleted` and `deletedAt` internally.
          return withCascadeContext(() =>
            client[modelKey].update({
              ...args,
              data: {
                [mc.field]: true,
                [mc.deletedAtField]: new Date(),
              },
            }),
          );
        },

        /**
         * Converts `deleteMany()` to `updateMany()` with cascade.
         *
         * Returns a `BatchPayload` (`{ count: number }`) matching the
         * original `deleteMany` return type.
         */
        async deleteMany(
          this: unknown,
          { model, args, query: _query }: OperationParams,
        ) {
          if (!model || !isSoftDeleteModel(model, config)) return _query(args);

          const modelKey = normalizeModelName(model);
          const mc = getModelConfig(model, config);

          // biome-ignore lint/suspicious/noExplicitAny: Prisma extension client type
          const client = this as any;

          // Cascade first
          await cascadeSoftDeleteMany(client, model, args.where, config);

          // Soft-delete all matching parent records
          return withCascadeContext(() =>
            client[modelKey].updateMany({
              where: args.where,
              data: {
                [mc.field]: true,
                [mc.deletedAtField]: new Date(),
              },
            }),
          );
        },

        // ── Write Operations ─────────────────────────────────────────
        //
        // These guard against manual changes to `deleted`/`deletedAt`
        // and scope updates to non-deleted records only.

        async update({ model, args, query }: OperationParams) {
          if (model && isSoftDeleteModel(model, config)) {
            assertNoSoftDeleteFieldMutation(args.data, model, config);

            // Only update non-deleted records
            if (shouldApplyFilter()) {
              const mc = getModelConfig(model, config);
              args.where = { ...args.where, [mc.field]: false };
            }
          }
          return query(args);
        },

        async updateMany({ model, args, query }: OperationParams) {
          if (model && isSoftDeleteModel(model, config)) {
            assertNoSoftDeleteFieldMutation(args.data, model, config);

            if (shouldApplyFilter()) {
              const mc = getModelConfig(model, config);
              args.where = injectDeletedFilter(args.where, mc.field);
            }
          }
          return query(args);
        },

        async upsert({ model, args, query }: OperationParams) {
          if (model && isSoftDeleteModel(model, config)) {
            assertNoSoftDeleteFieldMutation(args.update, model, config);

            if (shouldApplyFilter()) {
              const mc = getModelConfig(model, config);
              args.where = { ...args.where, [mc.field]: false };
            }
          }
          return query(args);
        },
      },
    },

    // ── Model Methods ──────────────────────────────────────────────────
    //
    // Custom methods added to every model for soft delete management.

    model: {
      $allModels: {
        /**
         * Restore a soft-deleted record by setting `deleted = false`
         * and `deletedAt = null`.
         *
         * This method bypasses the normal mutation guard that prevents
         * manual updates to soft delete fields. It also uses `withDeleted`
         * internally so it can find records that are already soft-deleted.
         *
         * @example
         * ```ts
         * // Restore a single user
         * const user = await db.user.restore({ where: { id: 'some-id' } });
         *
         * // The user is now queryable again
         * const found = await db.user.findUnique({ where: { id: user.id } });
         * ```
         */
        async restore<
          T extends {
            [K: symbol]: {
              // biome-ignore lint/suspicious/noExplicitAny: Dynamic model context
              types: { operations: { update: { args: { where: any } } } };
            };
          },
        >(
          this: T,
          args: { where: Prisma.Args<T, 'update'>['where'] },
        ): Promise<
          Prisma.Result<
            T,
            { where: Prisma.Args<T, 'update'>['where'] },
            'update'
          >
        > {
          // biome-ignore lint/suspicious/noExplicitAny: Dynamic model context
          const context = Prisma.getExtensionContext(this) as any;
          const modelName = context.name as string;
          const modelKey = normalizeModelName(modelName);
          const modelConfig = config.models[modelKey];

          if (!modelConfig) {
            throw new Error(
              `Model "${modelName}" is not configured for soft delete.`,
            );
          }

          // Use both bypass contexts:
          // - withDeleted: so we can find the soft-deleted record
          // - withCascadeContext: so we can update the deleted/deletedAt fields
          return withDeleted(() =>
            withCascadeContext(() =>
              context.update({
                where: args.where,
                data: {
                  [modelConfig.field]: false,
                  [modelConfig.deletedAtField]: null,
                },
              }),
            ),
          );
        },
      },
    },
  });
}
