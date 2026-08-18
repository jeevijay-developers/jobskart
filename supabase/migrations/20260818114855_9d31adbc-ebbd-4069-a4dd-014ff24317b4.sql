-- 1. Phone normalisation helper (immutable, safe in expressions)
CREATE OR REPLACE FUNCTION public.normalize_phone_e164(_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _phone IS NULL OR regexp_replace(_phone, '\D', '', 'g') = '' THEN NULL
    WHEN length(regexp_replace(_phone, '\D', '', 'g')) >= 10
      THEN '+91' || right(regexp_replace(_phone, '\D', '', 'g'), 10)
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.normalize_phone_e164(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_phone_e164(text) TO authenticated, service_role;

-- 2. Normalise existing rows
UPDATE public.profiles
SET mobile = public.normalize_phone_e164(mobile)
WHERE mobile IS NOT NULL
  AND mobile IS DISTINCT FROM public.normalize_phone_e164(mobile);

UPDATE public.candidate_profiles
SET whatsapp_number = public.normalize_phone_e164(whatsapp_number)
WHERE whatsapp_number IS NOT NULL
  AND whatsapp_number IS DISTINCT FROM public.normalize_phone_e164(whatsapp_number);

-- 3. Lookup matches on normalised form regardless of what was passed in
CREATE OR REPLACE FUNCTION public.find_auth_user_by_phone_or_email(_phone text, _email text)
RETURNS TABLE(id uuid, email text, phone text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id, u.email::text, u.phone::text
  FROM auth.users u
  WHERE (
      _phone IS NOT NULL
      AND u.phone IS NOT NULL
      AND right(regexp_replace(u.phone, '\D', '', 'g'), 10)
          = right(regexp_replace(_phone, '\D', '', 'g'), 10)
    )
    OR (_email IS NOT NULL AND lower(u.email) = lower(_email))
  LIMIT 1;
$$;

-- 4. Skills master: admin review flag for AI-generated skills
ALTER TABLE public.skills_master
  ADD COLUMN IF NOT EXISTS pending_review boolean NOT NULL DEFAULT false;

-- 5. Skill suggestions ranked by real employer usage for the given roles
CREATE OR REPLACE FUNCTION public.suggest_skills_for_roles(_roles text[])
RETURNS TABLE(name text, uses bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH role_terms AS (
    SELECT lower(trim(r)) AS term
    FROM unnest(coalesce(_roles, ARRAY[]::text[])) AS r
    WHERE length(trim(r)) >= 2
  ),
  job_skills AS (
    SELECT lower(trim(s)) AS skill
    FROM public.jobs j
    CROSS JOIN unnest(coalesce(j.skills, ARRAY[]::text[])) AS s
    WHERE EXISTS (
      SELECT 1 FROM role_terms rt
      WHERE lower(j.title) LIKE '%' || rt.term || '%'
         OR lower(coalesce(j.role_type, '')) LIKE '%' || rt.term || '%'
    )
  )
  SELECT sm.name, count(js.skill) AS uses
  FROM public.skills_master sm
  JOIN job_skills js ON js.skill = lower(sm.name)
  WHERE sm.is_active AND NOT sm.pending_review
  GROUP BY sm.name
  ORDER BY uses DESC, sm.name ASC
  LIMIT 24;
$$;

REVOKE ALL ON FUNCTION public.suggest_skills_for_roles(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suggest_skills_for_roles(text[]) TO authenticated, service_role;
