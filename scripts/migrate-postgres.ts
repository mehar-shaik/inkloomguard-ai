import 'dotenv/config';
import { initDatabase, closeDatabase, DB_ENGINE } from '../server/db.ts';

async function main() {
  if (DB_ENGINE !== 'postgres') {
    console.error('DATABASE_URL is not set. Set DATABASE_URL to run PostgreSQL migrations.');
    process.exit(1);
  }

  console.log('[db:migrate] Applying safe PostgreSQL migrations from supabase/migrations/...');
  await initDatabase();
  console.log('[db:migrate] PostgreSQL migrations verified and applied cleanly.');
  await closeDatabase();
}

main().catch(async (err) => {
  console.error('[db:migrate] Migration failed:', err);
  await closeDatabase().catch(() => undefined);
  process.exit(1);
});
