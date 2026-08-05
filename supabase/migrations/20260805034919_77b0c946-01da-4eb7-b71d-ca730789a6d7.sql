DO $$
DECLARE f text;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- Public (unauthenticated) surfaces
GRANT EXECUTE ON FUNCTION public.get_public_candidate(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_company(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_profile_views(text) TO anon, authenticated;

-- Helpers used inside RLS policies
GRANT EXECUTE ON FUNCTION public.has_company_membership(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_company_role(uuid, uuid, employer_role) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_platform_role(uuid, app_platform_role) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_job_responses(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_companies(uuid) TO anon, authenticated;

-- Signed-in only surfaces
GRANT EXECUTE ON FUNCTION public.accept_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_invite_by_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_company_with_owner(text, text, company_size, text, text, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_private(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_member_role(uuid, uuid, employer_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_download(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_whatsapp_send(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_verification(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_launch_state(text) TO authenticated;