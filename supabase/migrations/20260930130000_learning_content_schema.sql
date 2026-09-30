-- Create storage bucket for learning media if not exists
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('learning-media', 'learning-media', true, 52428800, ARRAY['image/jpeg','image/png','image/gif','application/pdf','video/mp4'])
on conflict (id) do nothing;

-- Create tables
create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text,
  cover_url text,
  category text,
  tags text[] default '{}',
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  views_count integer default 0,
  content_type text not null check (content_type in ('post','course','certification')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Child tables
create table public.content_posts (
  id uuid primary key references public.content_items(id) on delete cascade,
  body_md text,
  seo_title text,
  seo_description text,
  og_image_url text
);

create table public.course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.content_items(id) on delete cascade,
  position integer not null,
  title text not null,
  kind text not null check (kind in ('video','reading','quiz')),
  video_url text,
  body_md text,
  quiz jsonb,
  free_preview boolean default false,
  duration_minutes integer
);

create table public.course_lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.course_modules(id) on delete cascade,
  position integer not null,
  title text not null,
  kind text not null check (kind in ('video','reading','quiz')),
  video_url text,
  body_md text,
  quiz jsonb,
  free_preview boolean default false,
  duration_minutes integer
);

create table public.certifications (
  id uuid primary key references public.content_items(id) on delete cascade,
  price_inr integer not null default 0,
  provider text not null default 'first_party' check (provider in ('first_party','partner')),
  partner_name text,
  pass_mark integer not null default 80,
  max_attempts integer not null default 3,
  validity_months integer,
  questions jsonb
);

create table public.cert_questions (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.certifications(id) on delete cascade,
  question_jsonb jsonb not null
);

create table public.user_content_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid not null references public.content_items(id) on delete cascade,
  content_type text not null check (content_type in ('post','course','certification')),
  progress_percent integer default 0 check (progress_percent between 0 and 100),
  completed_at timestamptz,
  last_accessed_at timestamptz default now(),
  primary key (user_id, content_id, content_type)
);

create table public.candidate_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  certification_id uuid not null references public.certifications(id) on delete cascade,
  razorpay_order_id text unique,
  amount integer,
  currency text default 'INR',
  status text not null default 'created' check (status in ('created','paid','failed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.cert_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  certification_id uuid not null references public.certifications(id) on delete cascade,
  certificate_no text unique,
  purchased_at timestamptz default now(),
  unique (user_id, certification_id)
);

create table public.content_settings (
  key text primary key,
  value jsonb
);

-- Insert default settings
insert into public.content_settings (key, value)
values ('recommendation_weights', jsonb_build_object('skill_gap', 0.6, 'popularity', 0.4))
on conflict (key) do nothing;
-- Enable RLS
alter table public.content_items enable row level security;
alter table public.content_posts enable row level security;
alter table public.course_modules enable row level security;
alter table public.course_lessons enable row level security;
alter table public.certifications enable row level security;
alter table public.cert_questions enable row level security;
alter table public.user_content_progress enable row level security;
alter table public.candidate_orders enable row level security;
alter table public.cert_purchases enable row level security;
alter table public.content_settings enable row level security;

-- Policies: public can read published items
create policy "Anyone can read published content items"
  on public.content_items for select
  using (status = 'published');

create policy "Admins can manage content items"
  on public.content_items for all
  using (public.has_platform_role(auth.uid(), 'super_admin'))
  with check (public.has_platform_role(auth.uid(), 'super_admin'));

create policy "Admins can manage content_posts"
  on public.content_posts for all
  using (public.has_platform_role(auth.uid(), 'super_admin'))
  with check (public.has_platform_role(auth.uid(), 'super_admin'));

create policy "Admins can manage course_modules"
  on public.course_modules for all
  using (public.has_platform_role(auth.uid(), 'super_admin'))
  with check (public.has_platform_role(auth.uid(), 'super_admin'));

create policy "Admins can manage course_lessons"
  on public.course_lessons for all
  using (public.has_platform_role(auth.uid(), 'super_admin'))
  with check (public.has_platform_role(auth.uid(), 'super_admin'));

create policy "Admins can manage certifications"
  on public.certifications for all
  using (public.has_platform_role(auth.uid(), 'super_admin'))
  with check (public.has_platform_role(auth.uid(), 'super_admin'));

create policy "Admins can manage cert_questions"
  on public.cert_questions for all
  using (public.has_platform_role(auth.uid(), 'super_admin'))
  with check (public.has_platform_role(auth.uid(), 'super_admin'));

create policy "Admins can manage user_content_progress"
  on public.user_content_progress for all
  using (public.has_platform_role(auth.uid(), 'super_admin'))
  with check (public.has_platform_role(auth.uid(), 'super_admin'));

create policy "Admins can manage candidate_orders"
  on public.candidate_orders for all
  using (public.has_platform_role(auth.uid(), 'super_admin'))
  with check (public.has_platform_role(auth.uid(), 'super_admin'));

create policy "Admins can manage cert_purchases"
  on public.cert_purchases for all
  using (public.has_platform_role(auth.uid(), 'super_admin'))
  with check (public.has_platform_role(auth.uid(), 'super_admin'));

create policy "Admins can manage content_settings"
  on public.content_settings for all
  using (public.has_platform_role(auth.uid(), 'super_admin'))
  with check (public.has_platform_role(auth.uid(), 'super_admin'));

-- Seeding sample data (guarded)
insert into public.content_items (slug, title, excerpt, category, tags, status, published_at, content_type)
select 'sample-post', 'Sample Blog Post', 'This is a sample post.', 'Career Development', ARRAY['communication','job-search'], 'published', now(), 'post'
where not exists (select 1 from public.content_items where slug = 'sample-post');

insert into public.content_items (slug, title, excerpt, category, tags, status, published_at, content_type)
select 'sample-course', 'Sample Course', 'This is a sample course.', 'Career Development', ARRAY['leadership','management'], 'published', now(), 'course'
where not exists (select 1 from public.content_items where slug = 'sample-course');

insert into public.content_items (slug, title, excerpt, category, tags, status, published_at, content_type)
select 'sample-cert', 'Sample Certification', 'This is a sample certification.', 'Career Development', ARRAY['certification','skill'], 'published', now(), 'certification'
where not exists (select 1 from public.content_items where slug = 'sample-cert');

-- Insert corresponding child rows
insert into public.content_posts (id, body_md, seo_title, seo_description, og_image_url)
select id, '# Sample Post\n\nThis is the body.', 'Sample Blog Post', 'This is a sample post for SEO.', null
from public.content_items where slug = 'sample-post'
on conflict do nothing;

insert into public.course_modules (course_id, position, title, kind, video_url, body_md, quiz, free_preview, duration_minutes)
select id, 1, 'Introduction', 'reading', null, 'Welcome to the course.', null, true, 10
from public.content_items where slug = 'sample-course'
on conflict do nothing;

insert into public.course_lessons (module_id, position, title, kind, video_url, body_md, quiz, free_preview, duration_minutes)
select m.id, 1, 'Introduction Lesson', 'reading', null, 'Welcome to the lesson.', null, true, 10
from public.course_modules m
join public.content_items ci on m.course_id = ci.id
where ci.slug = 'sample-course'
on conflict do nothing;

insert into public.certifications (id, price_inr, provider, partner_name, pass_mark, max_attempts, validity_months, questions)
select id, 0, 'first_party', null, 80, 3, null, '[]'
from public.content_items where slug = 'sample-cert'
on conflict do nothing;