-- ============================================================
-- 038_conversation_assignment_history.sql — audit trail for
-- conversation reassignments
--
-- Why
--
--   `conversations.assigned_agent_id` only ever holds the CURRENT
--   assignee — every previous assignment is overwritten with no
--   record. This adds an append-only log of every change, so "who
--   handled this conversation over time" and "who reassigned it, and
--   when" can be answered.
--
--   Deliberately independent of the `on_conversation_assigned`
--   trigger in 027_notifications.sql (which notifies the new
--   assignee and skips self-assignment): this trigger's job is
--   auditing, not notifying, so it logs every change including
--   self-assignment and unassignment (new_agent_id IS NULL).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- table -------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_assignment_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  previous_agent_id UUID,
  new_agent_id UUID,
  -- Who made the change. NULL means an automation / the system did it
  -- rather than a signed-in teammate.
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_assignment_events_conversation
  ON conversation_assignment_events(conversation_id, created_at DESC);

-- ---- RLS ---------------------------------------------------
ALTER TABLE conversation_assignment_events ENABLE ROW LEVEL SECURITY;

-- Account members can read the history for their account. No client
-- INSERT/UPDATE/DELETE policy — rows are created exclusively by the
-- SECURITY DEFINER trigger below.
DROP POLICY IF EXISTS conversation_assignment_events_select ON conversation_assignment_events;
CREATE POLICY conversation_assignment_events_select ON conversation_assignment_events FOR SELECT
  USING (is_account_member(account_id));

-- ---- TRIGGER — log every assignment change ------------------
CREATE OR REPLACE FUNCTION log_conversation_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO conversation_assignment_events (
    account_id, conversation_id, previous_agent_id, new_agent_id, changed_by
  ) VALUES (
    NEW.account_id,
    NEW.id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.assigned_agent_id ELSE NULL END,
    NEW.assigned_agent_id,
    auth.uid()
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let an audit-log failure block the assignment itself.
  RAISE WARNING 'Failed to log assignment history for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION log_conversation_assignment() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_conversation_assignment_logged ON conversations;
CREATE TRIGGER on_conversation_assignment_logged
  AFTER INSERT OR UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION log_conversation_assignment();

-- ---- realtime ------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'conversation_assignment_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversation_assignment_events;
  END IF;
END $$;
