-- Permanently deletes ONE company and everything that belongs to it.
-- Run on the VPS as the owner:
--   docker compose -f docker-compose.prod.yml exec -T db psql -U fieldserve -d fieldserve -v name="wq" -f - < docs/delete-company.sql
-- Always do step 1 first and check it is the right company.

SELECT set_config('app.name', :'name', false);

-- STEP 1 (look first)
SELECT c.id, c.name, c.email, (SELECT count(*) FROM "User" u WHERE u."companyId" = c.id) AS users
FROM "Company" c WHERE c.name = :'name';

-- STEP 2 (delete). Tables are cleared child-first by retrying until no foreign key blocks.
DO $$
DECLARE
  cid text;
  t record;
  pass int;
  left_over int;
BEGIN
  SELECT id INTO cid FROM "Company" WHERE name = current_setting('app.name');
  IF cid IS NULL THEN RAISE EXCEPTION 'Company not found'; END IF;
  IF (SELECT count(*) FROM "Company" WHERE name = current_setting('app.name')) > 1 THEN
    RAISE EXCEPTION 'More than one company has this name; delete by id instead';
  END IF;

  FOR pass IN 1..30 LOOP
    -- rows tied to the company's users (tokens, sessions, ...)
    FOR t IN SELECT table_name FROM information_schema.columns
             WHERE table_schema='public' AND column_name='userId' AND table_name NOT IN ('User') LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE "userId" IN (SELECT id FROM "User" WHERE "companyId" = %L)', t.table_name, cid);
      EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    END LOOP;
    -- rows tied to the company itself
    FOR t IN SELECT table_name FROM information_schema.columns
             WHERE table_schema='public' AND column_name='companyId' AND table_name NOT IN ('Company') LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE "companyId" = %L', t.table_name, cid);
      EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    END LOOP;
    BEGIN
      DELETE FROM "Company" WHERE id = cid;
      EXIT;
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  END LOOP;

  SELECT count(*) INTO left_over FROM "Company" WHERE id = cid;
  IF left_over > 0 THEN RAISE EXCEPTION 'Could not delete: rows still reference the company'; END IF;
  RAISE NOTICE 'Company % deleted', cid;
END $$;
