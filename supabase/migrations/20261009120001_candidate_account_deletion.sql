-- Candidate self-service account deletion: a candidate requests deletion from
-- Settings, confirms via a one-time emailed link (src/routes/delete-account.$token.tsx),
-- and only then is the auth.users row (and everything cascading from it) removed.
-- See CLAUDE.md: schema changes land only as new migration files.

CREATE TABLE IF NOT EXISTS public.candidate_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  confirmed_at timestamptz
);

ALTER TABLE public.candidate_deletion_requests ENABLE ROW LEVEL SECURITY;
-- No direct client SELECT/INSERT policies: all access goes through the
-- SECURITY DEFINER functions below, same pattern as employer_invites' token flow.

-- Candidate requests deletion: supersede any of their own unconfirmed
-- requests (so only the newest emailed link works), then insert a fresh one.
CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS TABLE(id uuid, token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.candidate_deletion_requests%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE public.candidate_deletion_requests
    SET expires_at = now()
    WHERE user_id = _uid AND confirmed_at IS NULL;

  INSERT INTO public.candidate_deletion_requests (user_id)
    VALUES (_uid)
    RETURNING * INTO _row;

  RETURN QUERY SELECT _row.id, _row.token;
END; $$;

-- Lets the public confirm page (src/routes/delete-account.$token.tsx) show
-- state (valid / already-used / expired) without exposing user_id.
CREATE OR REPLACE FUNCTION public.get_account_deletion_request_by_token(_token text)
RETURNS TABLE(expires_at timestamptz, confirmed_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT expires_at, confirmed_at
  FROM public.candidate_deletion_requests
  WHERE token = _token;
$$;

-- Atomic claim: marks the request confirmed and returns the user_id to
-- delete, or raises if the token is invalid/expired/already used. Prevents
-- a double-click or two open tabs from both proceeding to delete.
CREATE OR REPLACE FUNCTION public.claim_account_deletion(_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid;
BEGIN
  UPDATE public.candidate_deletion_requests
    SET confirmed_at = now()
    WHERE token = _token AND confirmed_at IS NULL AND expires_at > now()
    RETURNING user_id INTO _uid;

  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Deletion link is invalid, expired, or already used';
  END IF;

  RETURN _uid;
END; $$;
