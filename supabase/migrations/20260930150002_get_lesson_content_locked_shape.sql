-- get_lesson_content() raised a 'locked' exception for a locked lesson, forcing the
-- caller to string-match the error message to tell "locked" apart from a real
-- failure, and gave no course_id to build a Buy button from without a second
-- lookup. Return a discriminated result instead: {unlocked:false, courseId} for a
-- locked lesson, {unlocked:true, ...content} once accessible. 'lesson_not_found'
-- still raises — that's a genuine 404, not a locked state.
CREATE OR REPLACE FUNCTION public.get_lesson_content(_lesson_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _l record;
  _unlocked boolean;
BEGIN
  SELECT l.id, l.title, l.kind, l.video_url, l.body_md, l.free_preview,
         co.id AS course_id, co.price_inr, ci.status
    INTO _l
    FROM public.course_lessons l
    JOIN public.course_modules m ON m.id = l.module_id
    JOIN public.courses co ON co.id = m.course_id
    JOIN public.content_items ci ON ci.id = co.id
   WHERE l.id = _lesson_id;
  IF NOT FOUND OR _l.status <> 'published' THEN
    RAISE EXCEPTION 'lesson_not_found';
  END IF;

  _unlocked := _l.free_preview OR _l.price_inr <= 0
    OR (_uid IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.course_purchases WHERE user_id = _uid AND course_id = _l.course_id));
  IF NOT _unlocked THEN
    RETURN jsonb_build_object('unlocked', false, 'courseId', _l.course_id);
  END IF;

  RETURN jsonb_build_object(
    'unlocked', true, 'courseId', _l.course_id,
    'title', _l.title, 'kind', _l.kind, 'videoUrl', _l.video_url, 'bodyMd', _l.body_md
  );
END;
$$;
