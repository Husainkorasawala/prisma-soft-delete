/**
 * Type definitions for the custom soft delete Prisma extension.
 *
 * These types configure which models participate in soft delete,
 * how cascade relationships are handled, and how relation field
 * names map to their corresponding model names.
 */

/** Defines a cascade relationship from a parent model to a child model. */
export type CascadeRelation = {
  /** Lowercase Prisma model name of the child (e.g., "account") */
  model: string;
  /** Foreign key field on the child model (e.g., "userId") */
  foreignKey: string;
  /** Primary key field on the parent model (e.g., "id") */
  sourceKey: string;
};

/** Configuration for a single soft-deletable model. */
export type SoftDeleteModelConfig = {
  /** The boolean flag field name — always "deleted" */
  field: string;
  /** The timestamp field name — always "deletedAt" */
  deletedAtField: string;
  /**
   * Relations that should be cascade soft-deleted when this model
   * is soft-deleted. Mirrors the behavior of SQL `ON DELETE CASCADE`
   * but for soft deletes.
   */
  cascadeRelations?: CascadeRelation[];
};

/**
 * Top-level configuration for the soft delete extension.
 *
 * @example
 * ```ts
 * const config: SoftDeleteConfig = {
 *   models: {
 *     user: {
 *       field: 'deleted',
 *       deletedAtField: 'deletedAt',
 *       cascadeRelations: [
 *         { model: 'account', foreignKey: 'userId', sourceKey: 'id' },
 *       ],
 *     },
 *     account: { field: 'deleted', deletedAtField: 'deletedAt' },
 *   },
 *   relationToModel: {
 *     accounts: 'account',
 *     user: 'user',
 *   },
 * };
 * ```
 */
export type SoftDeleteConfig = {
  /** Maps lowercase model names to their soft delete configuration. */
  models: Record<string, SoftDeleteModelConfig>;
  /**
   * Maps Prisma relation field names (as they appear in `include`/`select`)
   * to their lowercase model names. Used for filtering nested relations.
   *
   * Example: `{ accounts: "account", sessions: "session" }`
   */
  relationToModel: Record<string, string>;
};
