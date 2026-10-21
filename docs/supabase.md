# Supabase 接入

静态网页使用 Supabase Auth、PostgreSQL 和 RLS。房主只能由数据库管理员登记；客户端没有设置房主的接口。未配置 Supabase 时，房间仍可浏览书籍、项目和静态笔记，写字板及便签不会假装保存到本地。

## 配置真实项目

指定项目：`ewujzsimqbojxvltzvav`（https://ewujzsimqbojxvltzvav.supabase.co）。项目地址已填入 `.env.example` 和 AI 收件箱 OpenAPI 配置；这不代表迁移或云端部署已经完成。

使用 CLI 时先运行 `supabase link --project-ref ewujzsimqbojxvltzvav`，确认目标后再执行迁移。

1. 在自己的 Supabase 项目执行 `supabase/migrations/202610210001_personal_room.sql`。也可通过已授权的 Supabase 插件执行同一迁移，或使用 `supabase db push`。
2. 在 Authentication 中邀请或创建房主邮箱用户，取得该用户 UUID，在 SQL Editor 执行：

   ```sql
   insert into public.room_owners (user_id) values ('你的 Auth 用户 UUID');
   ```

   表中只允许一个房主。普通登录用户仍只有访客权限。建议关闭开放注册；前端发送登录邮件时也固定 `shouldCreateUser: false`。

3. Authentication 的 Site URL 设置为正式域名，Redirect URLs 允许该站点根地址。开发测试地址按需单独添加。登录使用 PKCE 邮件链接，需要在发起登录的同一浏览器中打开。
4. 复制 `.env.example` 为 `.env`，保留已填写的项目 URL，并填写该项目的 Publishable Key。Vercel 中添加同名的 `PUBLIC_SUPABASE_URL`、`PUBLIC_SUPABASE_PUBLISHABLE_KEY`，然后重新构建部署。两者是供浏览器使用的公开连接信息；Service Role / Secret Key 不得进入前端环境变量。
5. 登录后验证写字板保存、便签改写、收件箱草稿与发布。在未登录的窗口确认只能看到公开内容。

`.vercelignore` 排除本地环境变量文件；Vercel 构建使用控制台中的变量。

## 数据规则

- `room_entries` 保存写字板、便签、思考，草稿默认私有。RLS 同时检查读取、插入和更新权限。
- `room_revisions` 由数据库触发器自动记录修改前的正文。客户端不能插入、修改或删除历史；发布前的私有版本不会向访客公开。
- 客户端没有 DELETE 权限。便签可以划掉或通过 `rewrite_sticky` 事务撕下重写；旧纸保留，重写失败会整体回滚。
- 更新必须带上读取时的 `updated_at`，避免另一窗口的旧内容覆盖新内容。
- 已撕下的便签不可再修改。

## 验证范围

`npm run test:unit` 使用 PGlite 的真实 PostgreSQL 引擎执行完整迁移，模拟 Supabase 的 `auth.uid()` 与标准角色，验证 RLS、历史、并发冲突与事务回滚。浏览器测试拦截独立的模拟项目，不读写生产数据。

这些检查不能替代真实项目中的邮件投递、Redirect URLs、网络策略和发布后的联调；必须在连接实际项目后补验。
