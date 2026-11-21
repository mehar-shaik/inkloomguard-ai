-- InkloomGuard AI — Allow 'admin' Role in users.role CHECK Constraint
-- Safely replaces any existing users.role CHECK constraint (e.g., chk_users_role from 0006
-- or any legacy auto-named users_role_check) so 'reviewer', 'author', and 'admin' are all
-- permitted without modifying or downgrading any existing user records.

DO $$
DECLARE
  constraint_rec RECORD;
BEGIN
  FOR constraint_rec IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'users'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ~* '\yrole\y'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT IF EXISTS %I', constraint_rec.conname);
  END LOOP;

  ALTER TABLE users
    ADD CONSTRAINT chk_users_role CHECK (role IN ('reviewer', 'author', 'admin'));
END $$;
