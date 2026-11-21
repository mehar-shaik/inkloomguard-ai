import 'dotenv/config';
import {
  initDatabase,
  ensureDemoWorkspaceSeeded,
  closeDatabase,
  DB_ENGINE,
  getDemoOrganizationName,
} from '../server/db.ts';

async function main() {
  console.log(`[db:seed:demo] Ensuring pre-seeded organization (${getDemoOrganizationName()}) on ${DB_ENGINE}...`);
  await initDatabase();
  const result = await ensureDemoWorkspaceSeeded({
    allowInProduction: true,
    onlyWhenEmpty: false,
  });

  if (result.alreadyExists) {
    console.log(
      `[db:seed:demo] Pre-seeded organization already exists (companyId=${result.companyId ?? 'existing'}). No duplicates inserted.`
    );
  } else if (result.seeded) {
    console.log(
      `[db:seed:demo] Pre-seeded organization provisioned cleanly (companyId=${result.companyId ?? 'created'}).`
    );
  } else {
    console.log('[db:seed:demo] Pre-seeded organization skipped.');
  }

  await closeDatabase();
}

main().catch(async (err) => {
  console.error('[db:seed:demo] Failed to seed demo workspace:', err instanceof Error ? err.message : String(err));
  await closeDatabase().catch(() => undefined);
  process.exit(1);
});
