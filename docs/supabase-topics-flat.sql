alter table public.posts add column if not exists topics text[] not null default '{}';
alter table public.posts drop constraint if exists posts_topics_allowed;
alter table public.posts add constraint posts_topics_allowed check (cardinality(topics) <= 3 and topics <@ array['食堂','图书馆','晚霞','emo','求组队','学习','运动','随手拍']::text[]);
create index if not exists posts_topics_idx on public.posts using gin (topics);
grant select (topics) on public.posts to anon, authenticated;
create or replace view public.my_posts as
select
  p.id,
  p.author_id,
  p.is_anonymous,
  p.display_name,
  p.school,
  p.content,
  p.image_path,
  p.created_at,
  p.status,
  p.anon_code,
  p.topics
from public.posts p
where p.author_id = auth.uid();
grant select on public.my_posts to anon, authenticated;
notify pgrst, 'reload schema';
