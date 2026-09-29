-- 校园拾光 · 数据库迁移：粘贴专用版（一条语句一行，无注释）
-- 由 docs/supabase-anon-code.sql 生成，内容一致，只是去掉了注释和换行。
-- 用法：整段复制到 Supabase -> SQL Editor -> Run；每行末尾都自带分号。

create temp table if not exists _anon_code_dryrun ( id uuid not null default gen_random_uuid(), author_id uuid, is_anonymous boolean not null default true, anon_code text generated always as ( case when is_anonymous then upper(substr(md5(coalesce(author_id::text, id::text) || 'REPLACE_WITH_A_RANDOM_SALT'), 1, 6)) else null end ) stored );
insert into _anon_code_dryrun (author_id, is_anonymous) values ('11111111-1111-4111-8111-111111111111', true), ('11111111-1111-4111-8111-111111111111', true), ('22222222-2222-4222-8222-222222222222', true), ('11111111-1111-4111-8111-111111111111', false), (null, true);
select author_id, is_anonymous, anon_code from _anon_code_dryrun order by is_anonymous desc, author_id nulls last;
select author_id, count(distinct anon_code) as codes from _anon_code_dryrun where is_anonymous and author_id is not null group by author_id having count(distinct anon_code) > 1;
alter table public.posts add column if not exists anon_code text generated always as ( case when is_anonymous then upper(substr(md5(coalesce(author_id::text, id::text) || 'REPLACE_WITH_A_RANDOM_SALT'), 1, 6)) else null end ) stored;
comment on column public.posts.anon_code is '稳定洞号：匿名帖显示用的六位编号，由 author_id + 盐派生（跨帖稳定）；署名帖为 null';
grant select (anon_code) on public.posts to anon, authenticated;
create or replace view public.my_posts as select p.id, p.author_id, p.is_anonymous, p.display_name, p.school, p.content, p.image_path, p.created_at, p.status, p.anon_code from public.posts p where p.author_id = auth.uid();
comment on view public.my_posts is '我的发布：按 auth.uid() 在服务端过滤，替代客户端的 author_id=eq.<uid> 过滤';
grant select on public.my_posts to anon, authenticated;
notify pgrst, 'reload schema';
