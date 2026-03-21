/**
 * Helper functions for the soft delete extension.
 *
 * These utilities handle:
 * - Checking if a model participates in soft delete
 * - Injecting `deleted: false` into where clauses
 * - Filtering nested `include`/`select` relations
 * - Guarding against manual mutation of soft delete fields
 */

import { isCascadeOperation } from './context.js';
import type { SoftDeleteConfig } from './types.js';

/**
 * Normalize a Prisma PascalCase model name to the lowercase key
 * used in the soft delete config.
 *
 * Prisma passes model names like "User", "Account" in query extensions.
 * The config uses "user", "account" as keys.
 */
export function normalizeModelName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Check whether a model participates in soft delete.
 *
 * @param model - PascalCase model name from Prisma (e.g., "User")
 * @param config - The soft delete configuration
 */
export function isSoftDeleteModel(
  model: string | undefined,
  config: SoftDeleteConfig,
): boolean {
  if (!model) return false;
  return normalizeModelName(model) in config.models;
}

/**
 * Merge `{ deleted: false }` into a Prisma where clause.
 *
 * Preserves all existing filters and adds the soft delete condition.
 * If the caller already specified a `deleted` filter (unlikely in
 * normal usage), this will override it — by design, since the
 * automatic filter should always win unless bypassed via `withDeleted()`.
 */
export function injectDeletedFilter(
  where: Record<string, unknown> | undefined,
  fieldName: string,
): Record<string, unknown> {
  return {
    ...where,
    [fieldName]: false,
  };
}

/**
 * Walk through `include` and `select` options and inject
 * `deleted: false` filters into nested relation queries.
 *
 * Handles three forms of nested relations:
 *
 * 1. `{ accounts: true }` → converts to `{ accounts: { where: { deleted: false } } }`
 * 2. `{ accounts: { where: { ... }, ... } }` → merges `deleted: false` into existing where
 * 3. `{ accounts: { select: { ... } } }` → adds `where: { deleted: false }` alongside select
 *
 * This ensures that even when eagerly loading relations, soft-deleted
 * child records are automatically excluded.
 */
export function filterNestedRelations(
  args: Record<string, unknown>,
  config: SoftDeleteConfig,
): Record<string, unknown> {
  const result = { ...args };

  if (result.include) {
    result.include = processRelationObject(
      result.include as Record<string, unknown>,
      config,
    );
  }

  if (result.select) {
    result.select = processRelationObject(
      result.select as Record<string, unknown>,
      config,
    );
  }

  return result;
}

/**
 * Process a single level of `include` or `select` to add soft delete
 * filters to any recognized relation fields.
 */
function processRelationObject(
  obj: Record<string, unknown>,
  config: SoftDeleteConfig,
): Record<string, unknown> {
  const result = { ...obj };

  for (const [relationName, value] of Object.entries(result)) {
    // Look up whether this relation field maps to a soft-delete model
    const modelName = config.relationToModel[relationName];
    if (!modelName || !config.models[modelName]) continue;

    const fieldName = config.models[modelName].field;

    if (value === true) {
      // Case 1: `{ accounts: true }` → add a where filter
      result[relationName] = {
        where: { [fieldName]: false },
      };
    } else if (typeof value === 'object' && value !== null) {
      const nested = value as Record<string, unknown>;
      // Case 2 & 3: merge `deleted: false` into existing where
      result[relationName] = {
        ...nested,
        where: injectDeletedFilter(
          nested.where as Record<string, unknown> | undefined,
          fieldName,
        ),
      };
    }
    // If value is `false` or `undefined`, the relation is excluded — skip
  }

  return result;
}

/**
 * Guard that prevents manual updates to soft delete fields (`deleted`, `deletedAt`).
 *
 * This is called on `update`, `updateMany`, and `upsert` operations to ensure
 * that the only way to change these fields is through the `delete()` method
 * (which the extension rewrites to a soft delete) or through the internal
 * cascade mechanism.
 *
 * @throws Error if `data` contains `deleted` or `deletedAt` keys
 */
export function assertNoSoftDeleteFieldMutation(
  data: Record<string, unknown> | undefined,
  model: string,
  config: SoftDeleteConfig,
): void {
  // Allow internal cascade operations to modify these fields
  if (isCascadeOperation()) return;

  if (!data) return;

  const modelKey = normalizeModelName(model);
  const modelConfig = config.models[modelKey];
  if (!modelConfig) return;

  const { field, deletedAtField } = modelConfig;

  if (field in data || deletedAtField in data) {
    throw new Error(
      `Direct modification of soft delete fields ("${field}", "${deletedAtField}") ` +
        `is not allowed on ${model}. Use the delete() method for soft deletion ` +
        `or the restore() method to recover soft-deleted records.`,
    );
  }
}
