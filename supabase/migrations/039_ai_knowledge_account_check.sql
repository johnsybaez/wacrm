-- ============================================================
-- 039_ai_knowledge_account_check.sql — close cross-tenant read on
-- the AI knowledge base RPCs
--
-- Bug
--
--   match_ai_knowledge_fts / match_ai_knowledge_semantic (030) are
--   SECURITY DEFINER and only filter `WHERE c.account_id = p_account_id`
--   — they never check that the caller actually belongs to that
--   account. Both are GRANTed to `authenticated`, so any signed-in
--   user could call them via PostgREST with an arbitrary p_account_id
--   and read another account's knowledge base chunks.
--
-- Fix
--
--   Require `is_account_member(p_account_id)` to pass — but only
--   when the caller is a real user (auth.uid() IS NOT NULL). The
--   auto-reply bot invokes these functions with the service_role key
--   (see the GRANT below and the comment in 030), which has no
--   auth.uid() — is_account_member would always evaluate false for
--   that path and silently break auto-reply. Service-role calls
--   already resolve p_account_id server-side from the conversation's
--   own account, so they stay trusted as before; only the
--   `authenticated`-role path (the actual vulnerable one) gets the
--   membership check enforced.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, rank real) AS $$
  SELECT c.id,
         c.content,
         ts_rank(c.fts, plainto_tsquery('simple', p_query)) AS rank
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND (auth.uid() IS NULL OR is_account_member(p_account_id))
    AND c.fts @@ plainto_tsquery('simple', p_query)
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_semantic(
  p_account_id      uuid,
  p_query_embedding text,
  p_match_count     integer
)
RETURNS TABLE (id uuid, content text, distance real) AS $$
  SELECT c.id,
         c.content,
         (c.embedding <=> p_query_embedding::vector(1536)) AS distance
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND (auth.uid() IS NULL OR is_account_member(p_account_id))
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- GRANT/REVOKE unchanged from 030 — restated here only because
-- CREATE OR REPLACE FUNCTION does not reset privileges, this is a
-- no-op safety net in case a future migration ever drops them.
REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer) TO authenticated, service_role;
