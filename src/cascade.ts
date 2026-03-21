/**
 * Cascade soft delete logic.
 *
 * When a parent record is soft-deleted (e.g., a User), all related child
 * records (e.g., Accounts, Sessions, VerificationTokens) should also be
 * soft-deleted. This mirrors SQL's `ON DELETE CASCADE` behavior but for
 * soft deletes.
 *
 * The cascade runs inside two special contexts:
 * - `withDeleted` — so we can find the parent record even if it's already
 *   been marked as deleted in the same operation
 * - `withCascadeContext` — so the `updateMany` calls that set `deleted`/
 *   `deletedAt` bypass the mutation guard
 */

import { withCascadeContext, withDeleted } from './context.js';
import type { SoftDeleteConfig } from './types.js';

/**
 * Cascade soft delete for a single record's `delete()` operation.
 *
 * Finds the record by its unique `where` clause, then soft-deletes
 * all child records in configured cascade relations.
 *
 * @param client - The Prisma client instance (used to issue updateMany)
 * @param model - PascalCase model name (e.g., "User")
 * @param where - The `where` clause from the original delete operation
 * @param config - Soft delete configuration
 */
export async function cascadeSoftDelete(
  // biome-ignore lint/suspicious/noExplicitAny: Dynamic Prisma client access
  client: any,
  model: string,
  where: Record<string, unknown>,
  config: SoftDeleteConfig,
): Promise<void> {
  const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
  const modelConfig = config.models[modelKey];

  if (!modelConfig?.cascadeRelations?.length) return;

  // Find the parent record to get its primary key value.
  // Use `withDeleted` because the parent might already be filtered out
  // if this cascade runs after the parent's `deleted` flag is set.
  const record = await withDeleted(() => client[modelKey].findFirst({ where }));

  if (!record) return;

  // Soft-delete all child records in each cascade relation.
  // Use `withCascadeContext` so the mutation guard allows setting
  // `deleted` and `deletedAt` on the child records.
  await withCascadeContext(async () => {
    // biome-ignore lint/style/noNonNullAssertion: modelConfig.cascadeRelations is guaranteed to be non-null
    const cascadePromises = modelConfig.cascadeRelations!.map(
      async (relation) => {
        const childConfig = config.models[relation.model];
        if (!childConfig) return;

        await client[relation.model].updateMany({
          where: {
            [relation.foreignKey]: (record as Record<string, unknown>)[
              relation.sourceKey
            ],
            // Only cascade to non-deleted records to avoid
            // unnecessary updates and preserve original deletedAt
            [childConfig.field]: false,
          },
          data: {
            [childConfig.field]: true,
            [childConfig.deletedAtField]: new Date(),
          },
        });
      },
    );

    await Promise.all(cascadePromises);
  });
}

/**
 * Cascade soft delete for a batch `deleteMany()` operation.
 *
 * Finds all records matching the `where` clause, collects their primary
 * key values, then soft-deletes all child records that reference those keys.
 *
 * @param client - The Prisma client instance
 * @param model - PascalCase model name (e.g., "User")
 * @param where - The `where` clause from the original deleteMany operation
 * @param config - Soft delete configuration
 */
export async function cascadeSoftDeleteMany(
  // biome-ignore lint/suspicious/noExplicitAny: Dynamic Prisma client access
  client: any,
  model: string,
  where: Record<string, unknown> | undefined,
  config: SoftDeleteConfig,
): Promise<void> {
  const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
  const modelConfig = config.models[modelKey];

  if (!modelConfig?.cascadeRelations?.length) return;

  // Find all parent records that match the where clause.
  // Use `withDeleted` in case some are already soft-deleted.
  const records = (await withDeleted(() =>
    client[modelKey].findMany({
      where: where ?? {},
      select: Object.fromEntries(
        // biome-ignore lint/style/noNonNullAssertion: modelConfig.cascadeRelations is guaranteed to be non-null
        modelConfig.cascadeRelations!.map((r) => [r.sourceKey, true]),
      ),
    }),
  )) as Record<string, unknown>[];

  if (!records.length) return;

  await withCascadeContext(async () => {
    // biome-ignore lint/style/noNonNullAssertion: modelConfig.cascadeRelations is guaranteed to be non-null
    const cascadePromises = modelConfig.cascadeRelations!.map(
      async (relation) => {
        const childConfig = config.models[relation.model];
        if (!childConfig) return;

        // Collect all parent key values for a batch `IN` query
        const parentKeys = records.map((r) => r[relation.sourceKey]);

        await client[relation.model].updateMany({
          where: {
            [relation.foreignKey]: { in: parentKeys },
            [childConfig.field]: false,
          },
          data: {
            [childConfig.field]: true,
            [childConfig.deletedAtField]: new Date(),
          },
        });
      },
    );

    await Promise.all(cascadePromises);
  });
}
