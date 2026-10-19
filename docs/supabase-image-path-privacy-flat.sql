-- 校园拾光 · 数据库迁移：粘贴专用版（一条语句一行，无注释）
-- 由 docs/supabase-image-path-privacy.sql 生成，内容一致，只是去掉了注释。
-- 用法：整段复制到 Supabase -> SQL Editor -> Run；每行末尾都自带分号。

drop policy if exists "post_images_public_read" on storage.objects;
update storage.buckets set public = true where id = 'post-images';
notify pgrst, 'reload schema';
