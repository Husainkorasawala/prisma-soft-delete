/**
 * AsyncLocalStorage-based context for controlling soft delete behavior.
 *
 * Two independent stores manage different bypass scenarios:
 *
 * 1. `softDeleteStore` — Allows callers to opt out of the automatic
 *    `deleted: false` filter via `withDeleted()`. Used for admin views,
 *    restore operations, or any case where you need to see soft-deleted records.
 *
 * 2. `cascadeStore` — Internal flag that allows the cascade soft delete
 *    logic to set `deleted`/`deletedAt` fields without triggering the
 *    mutation guard that blocks manual updates to those fields.
 *
 * AsyncLocalStorage propagates correctly through async/await, Promises,
 * and Prisma's `$transaction`, making it safe for concurrent requests.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

// ── Soft Delete Filter Bypass ──────────────────────────────────────────

type SoftDeleteStoreValue = { includeDeleted: boolean };

const softDeleteStore = new AsyncLocalStorage<SoftDeleteStoreValue>();

/**
 * Execute a callback with soft-deleted records included in query results.
 *
 * By default, all find operations automatically exclude records where
 * `deleted = true`. Wrapping a query in `withDeleted` disables this filter.
 *
 * @example
 * ```ts
 * // Returns ALL users, including soft-deleted ones
 * const allUsers = await withDeleted(() => db.user.findMany());
 *
 * // Works with any Prisma operation
 * const deletedUser = await withDeleted(() =>
 *   db.user.findUnique({ where: { id: 'some-id' } })
 * );
 * ```
 */
export function withDeleted<T>(fn: () => T): T {
  return softDeleteStore.run({ includeDeleted: true }, fn);
}

/**
 * Check whether the current execution context should apply the
 * `deleted: false` filter. Returns `true` when we ARE inside a
 * `withDeleted()` callback (meaning we should NOT filter).
 */
export function isIncludeDeletedContext(): boolean {
  return softDeleteStore.getStore()?.includeDeleted === true;
}

/**
 * Returns `true` when the soft delete filter should be applied.
 * This is the inverse of `isIncludeDeletedContext` — it returns
 * `true` in normal operation and `false` inside `withDeleted()`.
 */
export function shouldApplyFilter(): boolean {
  return !isIncludeDeletedContext();
}

// ── Cascade Operation Bypass ───────────────────────────────────────────

type CascadeStoreValue = { isCascade: boolean };

const cascadeStore = new AsyncLocalStorage<CascadeStoreValue>();

/**
 * Execute a callback in "cascade mode", allowing internal soft delete
 * operations to modify the `deleted` and `deletedAt` fields directly.
 *
 * This bypasses the mutation guard that normally prevents manual updates
 * to soft delete fields. Only used internally by the cascade logic.
 */
export function withCascadeContext<T>(fn: () => T): T {
  return cascadeStore.run({ isCascade: true }, fn);
}

/**
 * Check whether the current execution is an internal cascade operation.
 * When `true`, the mutation guard allows setting `deleted`/`deletedAt`.
 */
export function isCascadeOperation(): boolean {
  return cascadeStore.getStore()?.isCascade === true;
}
