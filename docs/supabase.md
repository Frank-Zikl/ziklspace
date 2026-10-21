# Supabase 接入

静态网页使用 Supabase Auth、PostgreSQL 和 RLS。房主只能由数据库管理员登记；客户端没有设置房主的接口。未配置 Supabase 时，房间仍可浏览书籍、项目和静态笔记，写字板及便签不会假装保存到本地。

## 配置真实项目

指定项目：`ewujzsimqbojxvltzvav`（https://ewujzsimqbojxvltzvav.supabase.co）。正式网站为 https://ziklspace.vercel.app/。

2026-10-21 已通过 Supabase 插件部署两项迁移和 `submit-thought` Edge Function。三张业务表均启用 RLS；提权函数位于不对 Data API 暴露的 `private` schema。已在真实云端事务中验证房主写入、访客只读、私有草稿、历史记录和便签重写回滚，全部测试数据均已回滚。

房主邮箱已由管理员配置在 `private.room_owner_setup`，没有写入仓库。该邮箱对应的 Auth 用户确认后，数据库会自动登记唯一房主。Auth 用户创建、登录回跳和 `ROOM_INGEST_TOKEN` 仍需在控制台配置；当前插件没有对应管理工具。函数已部署不代表已启用投递：密钥未配置时接口拒绝写入。

使用 CLI 时先运行 `supabase link --project-ref ewujzsimqbojxvltzvav`，确认目标后再执行迁移。

1. 指定项目已执行 `20261021061303_personal_room.sql` 和 `20261021061529_verified_room_owner.sql`，不要重复运行建表 SQL。全新项目按文件名顺序执行 `supabase/migrations/` 中的迁移。文件版本与指定项目的云端迁移历史一致。
2. 新项目先在 SQL Editor 配置允许成为房主的邮箱；指定项目已配置，可跳过此 SQL：

   ```sql
   insert into private.room_owner_setup (email)
   values (lower(trim('你的房主邮箱')))
   on conflict (singleton) do update set email = excluded.email;
   ```

   然后在 [Authentication Users](https://supabase.com/dashboard/project/ewujzsimqbojxvltzvav/auth/users) 创建同一邮箱的用户，可启用 Auto Confirm；密码可随机生成，网站仍通过邮件链接登录。未经确认的邮箱和其他邮箱不会获得房主权限；已有房主不会被另一个账号覆盖。普通登录用户只有访客权限。建议关闭开放注册；前端发送登录邮件时也固定 `shouldCreateUser: false`。

3. 在 [URL Configuration](https://supabase.com/dashboard/project/ewujzsimqbojxvltzvav/auth/url-configuration) 将 Site URL 设为 `https://ziklspace.vercel.app`，Redirect URLs 添加 `https://ziklspace.vercel.app/`。开发测试地址按需单独添加。登录使用 PKCE 邮件链接，需要在发起登录的同一浏览器中打开。默认邮件服务可能限制收件人；出现邮件投递限制时，检查该邮箱是否属于项目组织，或配置自定义 SMTP。
4. 复制 `.env.example` 为 `.env`，保留已填写的项目 URL，并填写该项目的 Publishable Key。Vercel 中添加同名的 `PUBLIC_SUPABASE_URL`、`PUBLIC_SUPABASE_PUBLISHABLE_KEY`，然后重新构建部署。两者是供浏览器使用的公开连接信息；Service Role / Secret Key 不得进入前端环境变量。
5. 登录后验证写字板保存、便签改写、收件箱草稿与发布。在未登录的窗口确认只能看到公开内容。

当前项目的公开 URL 和 Publishable Key 已配置在 `vercel.json` 的 `env` 中，供 Vercel 构建使用。Publishable Key 会进入浏览器，不是管理员凭据；数据保护依赖上述 RLS 和房主登记。更换项目或轮换公开密钥时，应同步修改此配置。

`.vercelignore` 排除本地环境变量文件；本地开发使用未提交的 `.env`。

## 数据规则

- `room_entries` 保存写字板、便签、思考，草稿默认私有。RLS 同时检查读取、插入和更新权限。
- `room_revisions` 由数据库触发器自动记录修改前的正文。客户端不能插入、修改或删除历史；发布前的私有版本不会向访客公开。
- 客户端没有 DELETE 权限。便签可以划掉或通过 `rewrite_sticky` 事务撕下重写；旧纸保留，重写失败会整体回滚。
- 更新必须带上读取时的 `updated_at`，避免另一窗口的旧内容覆盖新内容。
- 已撕下的便签不可再修改。
- 只有管理员可配置房主邮箱。`private.room_owner_setup` 撤销客户端权限并启用 RLS，不设客户端策略；安全顾问对此可能显示“RLS Enabled No Policy”的信息提示，这是有意拒绝所有客户端访问。

## 验证范围

`npm run test:unit` 使用 PGlite 的真实 PostgreSQL 引擎执行完整迁移，模拟 Supabase 的 `auth.uid()` 与标准角色，验证 RLS、历史、并发冲突与事务回滚。浏览器测试拦截独立的模拟项目，不读写生产数据。

`scripts/verify-room.sql` 用于初始化时的空库云端检查。它在单个事务内创建临时 Auth/业务数据，验证后整体回滚；已有房主或业务内容时应使用本地测试，勿直接重跑初始化检查。

已完成云端 SQL 权限验证，仍需实际邮箱登录及线上页面联调。Vercel 插件能读取项目的 READY 状态，但当前连接访问部署页面返回 403，因此尚未核验线上交互。不要将模拟浏览器测试描述为真实邮件、HTTP 投递或线上登录已通过。
