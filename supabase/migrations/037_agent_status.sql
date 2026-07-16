-- ============================================================
-- 037_agent_status.sql — agent operational status (available /
-- busy / paused)
--
-- Why a separate column from member_presence.status
--
--   `member_presence.status` ('online'/'away') is overwritten by
--   the client heartbeat roughly every 30s (see touch_presence in
--   024_member_presence.sql and PresenceHeartbeat on the client) —
--   it reflects tab connectivity, not a deliberate choice by the
--   agent. A manual operational status needs its own column or the
--   next heartbeat would silently revert it within seconds.
--
--   `agent_status` is never touched by touch_presence()/the
--   heartbeat — it only changes when the agent explicitly picks a
--   status from the account menu, via the set_agent_status RPC
--   below.
--
-- Error contract: same as touch_presence (42501 unauthorized,
-- 22023 invalid input).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- column --------------------------------------------------
ALTER TABLE member_presence
  ADD COLUMN IF NOT EXISTS agent_status TEXT NOT NULL DEFAULT 'available'
    CHECK (agent_status IN ('available', 'busy', 'paused'));

-- ---- RPC -------------------------------------------------------
-- Upserts only the caller's agent_status, leaving status/last_seen_at
-- (owned by touch_presence) untouched. SECURITY DEFINER so it can
-- write despite the absence of a client write policy; the account is
-- resolved from the caller's own profile, same as touch_presence.
CREATE OR REPLACE FUNCTION public.set_agent_status(
  p_status TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('available', 'busy', 'paused') THEN
    RAISE EXCEPTION 'Invalid agent status: %', p_status
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  INSERT INTO member_presence (user_id, account_id, agent_status, last_seen_at)
  VALUES (auth.uid(), v_account_id, p_status, now())
  ON CONFLICT (user_id) DO UPDATE
    SET agent_status = excluded.agent_status,
        account_id   = excluded.account_id;
END;
$$;

ALTER FUNCTION public.set_agent_status(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_agent_status(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_agent_status(TEXT) TO authenticated;
