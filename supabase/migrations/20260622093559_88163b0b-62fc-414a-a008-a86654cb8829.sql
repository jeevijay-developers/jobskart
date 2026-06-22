
-- Restrict execute on new SECURITY DEFINER fns
REVOKE EXECUTE ON FUNCTION public.get_public_company(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_company(text) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_invite_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_by_token(text) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.accept_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invite(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.slugify(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slugify(text) TO authenticated, service_role;

-- Drop overly-permissive invite update policy; accept goes via accept_invite()
DROP POLICY IF EXISTS "Accepter updates own invite" ON public.employer_invites;
