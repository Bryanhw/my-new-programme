/* =====================================================================
 *  配置中心
 *  ---------------------------------------------------------------------
 *  把下面两个值换成你自己 Supabase 项目的信息即可（其余文件都不用改）。
 *
 *  去哪儿找：
 *    Supabase Dashboard -> 左侧 Project Settings -> API
 *      - Project URL      -> 填到 SUPABASE_URL
 *      - anon public key  -> 填到 SUPABASE_ANON_KEY
 *
 *  anon key 是「公开的匿名密钥」，设计上就允许放在前端代码里，
 *  真正的安全由数据库的行级安全策略（RLS）保证，详见 docs/supabase-setup.sql。
 *  ⚠️ 千万不要把 service_role key 放到这里。
 * ===================================================================== */

window.CAMPUS_CONFIG = {
  // 例：https://abcdefghijklmn.supabase.co
  SUPABASE_URL: "https://your-project-ref.supabase.co",

  // 例：eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....
  SUPABASE_ANON_KEY: "your-anon-public-key",

  // 图片存储桶名称（与 SQL 脚本中保持一致）
  BUCKET: "post-images",

  // 站点名称，会显示在标题和页头
  SITE_NAME: "校园拾光",

  // 一句话标语，出现在主页
  SITE_SLOGAN: "把今天的心事和光，留在这里"
};
