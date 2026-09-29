-- ============================================================
-- Fix: PostgREST embeds + RLS for team/activity actor profiles
-- ============================================================
--
-- team.tsx and activity.tsx embed `profiles!*_fkey(full_name, email)` off
-- employer_members.user_id and employer_activity.actor_id, but both columns
-- only carry an FK to auth.users(id) — never one to public.profiles(id) — so
-- PostgREST has no relationship to embed and every such query errors with
-- "could not find the relation between X and profiles". Same pattern already
-- fixed once for applications.candidate_id in 20260915063243; repeating it
-- here for employer_members.user_id and employer_activity.actor_id.
--
-- Even with the relationship fixed, profiles RLS only allows a user to read
-- their own row (plus the applicant-visibility policy from 20260915063243),
-- so a recruiter still couldn't see a teammate's name/email. Add a policy
-- scoped to "shares an employer_members row in the same company".

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employer_members_user_id_profiles_fkey') THEN
    ALTER TABLE public.employer_members
      ADD CONSTRAINT employer_members_user_id_profiles_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employer_activity_actor_id_profiles_fkey') THEN
    ALTER TABLE public.employer_activity
      ADD CONSTRAINT employer_activity_actor_id_profiles_fkey
      FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

DROP POLICY IF EXISTS "Teammates can view each other's profile" ON public.profiles;
CREATE POLICY "Teammates can view each other's profile" ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.employer_members me
      JOIN public.employer_members them
        ON them.company_id = me.company_id
      WHERE me.user_id = auth.uid()
        AND me.status = 'active'
        AND them.user_id = profiles.id
    )
  );
