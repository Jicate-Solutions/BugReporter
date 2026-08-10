-- 20260810_fix_bug_display_id_overflow.sql
-- Unwedge bug report submission. Every INSERT into bug_reports has been dying at
-- the statement timeout (SQLSTATE 57014) since the table reached 999 rows.
--
-- The cause is the display_id generator, which built its candidate like this:
--
--   SELECT COUNT(*) + 1 INTO count FROM bug_reports;   -- 999 + 1 = 1000
--   new_id := 'BUG-' || LPAD(count::TEXT, 3, '0');
--   WHILE EXISTS (SELECT 1 FROM bug_reports WHERE display_id = new_id) LOOP
--     count := count + 1;
--     new_id := 'BUG-' || LPAD(count::TEXT, 3, '0');
--   END LOOP;
--
-- lpad() does not only pad — it TRUNCATES when the value is longer than the
-- target width. lpad('1000', 3, '0') is '100', and so is lpad('1001', 3, '0'),
-- and lpad('999999', 3, '0'). Past 999 rows every iteration recomputes the exact
-- same already-taken 'BUG-100', so the uniqueness loop has no exit and spins
-- until statement_timeout kills the whole INSERT. Reads, UPDATEs and DELETEs
-- were unaffected throughout, which is why this looked like an API bug.
--
-- Three things are wrong there and all three are fixed below:
--   1. the width truncation, which turns overflow into a silent infinite loop;
--   2. COUNT(*) as an ID source — O(rows), and racy under concurrent inserts,
--      since two transactions both see the same count;
--   3. an unbounded WHILE, which can only ever express failure as a hang.
--
-- Replaced with a sequence (O(1), collision-free under concurrency) plus a
-- bounded retry that RAISEs instead of spinning. A loud failure is recoverable;
-- an 8-second hang on every submission is not.

-- ── 1. the counter ───────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.bug_display_id_seq AS bigint;

-- Seed past the highest number already issued. GREATEST against the sequence's
-- own last_value keeps this re-runnable: a second run can never walk the counter
-- backwards into numbers that have already been handed out.
--
-- The regex deliberately matches only the plain BUG-<digits> form. Six rows from
-- 2025-11-14 carry an app-generated fallback shape (BUG-<epoch_ms>-<random>);
-- those must not be read as a counter value.
SELECT setval(
  'public.bug_display_id_seq',
  GREATEST(
    (SELECT last_value FROM public.bug_display_id_seq),
    COALESCE(
      (SELECT MAX((regexp_match(display_id, '^BUG-(\d+)$'))[1]::bigint)
         FROM public.bug_reports),
      0),
    1)
);

-- nextval() is an object privilege, and the generator below runs with the rights
-- of whoever is inserting — not the sequence's owner. Without this grant the
-- 8-second hang would simply be traded for "permission denied for sequence".
-- Explicit rather than relying on ALTER DEFAULT PRIVILEGES having been set for
-- whichever role happens to run this migration.
GRANT USAGE, SELECT ON SEQUENCE public.bug_display_id_seq
  TO anon, authenticated, service_role;

-- ── 2. the generator ─────────────────────────────────────────────────────────
-- A new name on purpose: the old generate_bug_display_id() is declared
-- RETURNS TEXT, and Postgres refuses to CREATE OR REPLACE a function with a
-- different return type. Renaming sidesteps that without a risky DROP CASCADE.
CREATE OR REPLACE FUNCTION public.fn_set_bug_display_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE
  n         bigint;
  candidate text;
BEGIN
  IF NEW.display_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- The sequence alone is already collision-free. This bounded retry exists only
  -- to survive display_ids introduced outside it — hand-written rows, restored
  -- dumps, the 2025-11-14 fallback ids. Bounded, so the failure mode is an error
  -- with a diagnosable message rather than the hang this migration is undoing.
  --
  -- Deliberately NOT security definer, so this EXISTS runs under the caller's
  -- RLS. That means it can miss a colliding row the caller cannot see — but the
  -- sequence, not this check, is what actually guarantees uniqueness, and the
  -- UNIQUE constraint catches anything that slips past. A missed collision
  -- surfaces as a unique violation, which is recoverable; elevating privileges
  -- to tighten a backstop that is already redundant is not worth it.
  FOR i IN 1..50 LOOP
    n := nextval('public.bug_display_id_seq');

    -- Zero-pad only while the number still fits in three digits. Beyond that the
    -- number is printed whole: BUG-999 is followed by BUG-1000, not by a
    -- truncated collision.
    candidate := 'BUG-' || CASE
      WHEN n < 1000 THEN lpad(n::text, 3, '0')
      ELSE n::text
    END;

    IF NOT EXISTS (
      SELECT 1 FROM public.bug_reports WHERE display_id = candidate
    ) THEN
      NEW.display_id := candidate;
      RETURN NEW;
    END IF;
  END LOOP;

  RAISE EXCEPTION
    'bug_reports.display_id: no free identifier after 50 attempts (sequence at %)', n;
END;
$$;

COMMENT ON FUNCTION public.fn_set_bug_display_id() IS
  'Assigns bug_reports.display_id from bug_display_id_seq. Replaces the COUNT(*)+lpad(...,3) generator, which looped forever once the table passed 999 rows because lpad truncates rather than widens.';

-- ── 3. rebind the trigger ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_bug_display_id ON public.bug_reports;

CREATE TRIGGER set_bug_display_id
  BEFORE INSERT ON public.bug_reports
  FOR EACH ROW
  WHEN (NEW.display_id IS NULL)
  EXECUTE FUNCTION public.fn_set_bug_display_id();

-- The old generator is intentionally left in place rather than dropped: it is
-- no longer reachable from any trigger, and leaving it makes this migration
-- trivially reversible if anything downstream turns out to call it by name.
