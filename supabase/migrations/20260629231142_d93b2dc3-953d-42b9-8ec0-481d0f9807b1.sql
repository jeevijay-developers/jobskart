CREATE OR REPLACE FUNCTION public.find_auth_user_by_phone_or_email(_phone text, _email text)
RETURNS TABLE(id uuid, email text, phone text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id, u.email::text, u.phone::text
  FROM auth.users u
  WHERE u.phone = _phone OR u.email = _email
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_auth_user_by_phone_or_email(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_auth_user_by_phone_or_email(text, text) TO service_role;