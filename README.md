# prisma-soft-delete

[![npm version](https://img.shields.io/npm/v/prisma-soft-delete.svg)](https://www.npmjs.com/package/prisma-soft-delete)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Transparent soft deletes for [Prisma](https://www.prisma.io/)** using the official `$extends` client extension API. After you attach the extension, reads ignore deleted rows, deletes become updates that set your flags, and you get helpers for bypassing filters and restoring rows—without wrapping every call site in manual `where` clauses.

## Features

- **Automatic query filtering** — `findMany`, `findFirst`, `count`, `aggregate`, `groupBy`, and nested reads exclude soft-deleted rows by default.
- **Deletes become soft deletes** — `delete` / `deleteMany` are rewritten to updates that set your configured fields (e.g. `deleted`, `deletedAt`).
- **Optional cascade** — Configure related models to soft-delete in sync with a parent.
- **Escape hatch** — `withDeleted()` runs a callback where filters are not applied (e.g. admin or auditing).
- **Restore** — Per-model `restore()` for undoing a soft delete.
- **TypeScript-first** — Typed config and extension integration with `@prisma/client`.

## Requirements

- **Node.js** 18+.
- **Prisma** 5+ (`@prisma/client` as a peer dependency).

### ESM and CommonJS

The published package includes **both** an ESM build (`import`) and a CommonJS build (`require`). Use whichever matches your project:

**ESM** (`"type": "module"` or bundlers):

```ts
import { softDeleteExtension, withDeleted } from 'prisma-soft-delete';
import type { SoftDeleteConfig } from 'prisma-soft-delete';
```

**CommonJS**:

```js
const { softDeleteExtension, withDeleted } = require('prisma-soft-delete');
```

The repo uses `"type": "module"` so **local source** is authored as ESM; that does not restrict consumers—Node and TypeScript resolve the correct file via [`package.json` `exports`](https://nodejs.org/api/packages.html#exports).

## Installation

```bash
npm install prisma-soft-delete
```

```bash
pnpm add prisma-soft-delete
```

```bash
yarn add prisma-soft-delete
```

```bash
bun add prisma-soft-delete
```

Ensure `@prisma/client` is installed in your app (it is not bundled here):

```bash
npm install @prisma/client
```

## Schema setup

Add the fields your extension will use on each soft-deleted model (names can differ; configure them in code). Example:

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  deleted   Boolean  @default(false)
  deletedAt DateTime? @map("deleted_at")

  posts Post[]

  @@index([deleted])
}

model Post {
  id       String @id @default(cuid())
  title    String
  authorId String
  deleted   Boolean  @default(false)
  deletedAt DateTime? @map("deleted_at")

  author User @relation(fields: [authorId], references: [id])

  @@index([deleted])
}
```

Run `prisma generate` after changing the schema.

## Quick start

```ts
import { PrismaClient } from '@prisma/client';
import { softDeleteExtension } from 'prisma-soft-delete';
import type { SoftDeleteConfig } from 'prisma-soft-delete';

const softDeleteConfig: SoftDeleteConfig = {
  models: {
    user: {
      field: 'deleted',
      deletedAtField: 'deletedAt',
      cascadeRelations: [
        { model: 'post', foreignKey: 'authorId', sourceKey: 'id' },
      ],
    },
    post: { field: 'deleted', deletedAtField: 'deletedAt' },
  },
  relationToModel: {
    posts: 'post',
    author: 'user',
  },
};

const db = new PrismaClient().$extends(softDeleteExtension(softDeleteConfig));

// Reads exclude soft-deleted rows automatically
const activeUsers = await db.user.findMany();

// Include deleted rows when needed
import { withDeleted } from 'prisma-soft-delete';

const allUsers = await withDeleted(() => db.user.findMany());

// Restore a soft-deleted row
await db.user.restore({ where: { id: '...' } });
```

## Configuration (`SoftDeleteConfig`)

- **`models`** — Map each **Prisma model name** (camelCase delegate name, e.g. `user` for `User`) to:
  - **`field`** — Boolean column used as the soft-delete flag.
  - **`deletedAtField`** — Optional `DateTime?` column updated on delete/restore.
  - **`cascadeRelations`** *(optional)* — Related models to soft-delete when this row is deleted.
- **`relationToModel`** — Maps **relation field names** on your models to **delegate names** (e.g. `posts` → `post`) so nested queries and cascades resolve correctly.

Apply **`softDeleteExtension` before other extensions** (pagination, logging, etc.) so their internal queries still pass through the soft-delete layer.

## Limitations & caveats

- **`$queryRaw` / `$executeRaw`** bypass client extensions. Add `deleted = false` (or your equivalent) manually in raw SQL.
- **Unique constraints** still see soft-deleted rows unless you use partial unique indexes (e.g. `WHERE deleted = false`) at the database level.
- **Extension order** matters; put this extension first in the `$extends` chain when combining with other plugins.

## Development

Clone the repo and install dependencies with **`npm install`** (this repo keeps a **`package-lock.json`** for reproducible installs and CI—Bun is optional locally, but `bun.lock` is not tracked).

**Published npm tarball:** Only the built `dist/` output is listed in `package.json` [`files`](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#files); npm also ships `package.json`, `README.md`, and `LICENSE` by default. Source, lockfiles, and config are not published.

| Script | Description |
|--------|-------------|
| `npm run build` | ESM (`dist/index.js`) + CJS (`dist/index.cjs`) via esbuild; declarations with `tsc`; copy `index.d.ts` → `index.d.cts` for `require` typings |
| `npm run typecheck` | Typecheck without emit |
| `npm run lint` | Run Biome on `src/` |

Publishing runs `prepublishOnly` → `npm run build` automatically.

## License

[MIT](./LICENSE)
