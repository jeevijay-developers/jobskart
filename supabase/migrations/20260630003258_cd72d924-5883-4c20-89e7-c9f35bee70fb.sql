GRANT EXECUTE ON FUNCTION public.has_company_membership(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_company_role(uuid, uuid, public.employer_role) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_companies(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_auth_user_by_phone_or_email(text, text) TO anon, authenticated;