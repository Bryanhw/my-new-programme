alter table public.posts drop constraint if exists posts_topics_allowed;
alter table public.posts add constraint posts_topics_allowed check (cardinality(topics) <= 3 and topics <@ array['食堂','图书馆','晚霞','emo','求组队','学习','运动','随手拍','失物招领','二手闲置','拼单拼车','兼职信息','社团招新','选课考试','找室友','求助提问','通知吐槽','毕业季']::text[]);
notify pgrst, 'reload schema';
