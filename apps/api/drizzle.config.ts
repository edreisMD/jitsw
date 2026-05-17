import type { Config } from 'drizzle-kit';

/**
 * Drizzle Kit config. Run:
 *   - `npm run db:generate` after editing src/store/schema.ts
 *   - `npm run db:migrate`  to apply migrations against $DATABASE_URL
 */
export default {
  schema: './src/store/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://jitsw:jitsw@localhost:5433/jitsw',
  },
} satisfies Config;
