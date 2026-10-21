# Ziklspace

正面敞开的 2.5D 卡通房间。Astro、TypeScript、MDX；Supabase 保存房主内容并控制读写权限。

## 开发

Node.js 24（`.nvmrc` 为 24.19.0）。

```sh
npm ci
npm run dev
```

当前云环境的主目录不可写，使用：

```sh
export ASTRO_TELEMETRY_DISABLED=1
npm --cache /tmp/ziklspace-npm-cache ci --no-audit --no-fund
npm run dev -- --ignore-lock --port 4321
```

保留前台终端，Ctrl+C 停止。`--ignore-lock` 控制 Astro 的服务实例记录，与依赖锁文件无关。启动前复用已有健康实例，不要重复占用端口。

## 房间

- 门口：点击门进入，有减少动态效果与跳过动画支持。
- 写字板：房主书写和保存，访客只读。
- 便签板：新增、修改、划掉、撕下重写；旧字迹与旧纸保留。
- 书架：选书、阅读、放回书架；同时提供独立阅读路由。
- 电脑：个人项目入口。
- 笔记本：公开思考与 MDX 笔记。
- 日历：项目与生活近况。
- 台灯、猫：可交互的房间物件。
- 房主收件箱：AI 对话整理稿或 Markdown 导入，先私有保存再手动发布。

手机默认展示全景，点击“近看”后可在房间视口内左右移动，也可以通过底部物件入口操作。所有入口支持键盘和原生对话框焦点管理。没有后台连接时只提供静态阅读，不以浏览器本地数据冒充云端保存。

## Supabase 与 AI 内容

- [数据库、房主账号和连接配置](docs/supabase.md)
- [GPT / Gemini 整理、导入与草稿接口](docs/ai-inbox.md)
- [HTTP 工具 OpenAPI 定义](docs/ai-inbox.openapi.json)

前端只读取 `PUBLIC_SUPABASE_URL` 和 `PUBLIC_SUPABASE_PUBLISHABLE_KEY`。复制 `.env.example` 后填写自己的项目；云端密钥不进入浏览器。真实项目迁移、房主登记和邮件配置需要授权后的 Supabase 项目连接。

## 静态内容

内容文件名决定路由，正文支持 Markdown/MDX。各集合均支持 `draft: true`，草稿不生成公开路由。

| 目录                   | 字段                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/content/notes`    | `title`、`date`（YYYY-MM-DD）、`category`、`sample`、`draft`、可选 `description`                                                   |
| `src/content/projects` | `title`、`date`、`category`、`status`（active/paused/complete/archived）、可选 `url` 和 `repository`、`featured`、`order`、`draft` |
| `src/content/updates`  | `title`、`date`、`items` 数组、可选 `project`（项目 ID）、`draft`                                                                  |
| `src/content/books`    | `title`、`author`、`sample`、`order`、`draft`                                                                                      |

现有三篇笔记和《房间笔记》都是样稿，没有虚构用户的经历或藏书。新增实际阅读材料前请使用自己拥有或获准发布的内容。

## 代码位置

- `src/components/room/RoomScene.astro`：可缩放的房间插画。
- `src/components/room/PersonalRoom.astro`：物件、入口与阅读面板。
- `src/styles/room.css`：卡通材质、空间、入场和响应式布局。
- `src/scripts/room.ts`：房间交互、编辑、导入和发布。
- `src/lib/room-api.ts`：Supabase 会话、读写和并发冲突处理。
- `supabase/migrations`：表结构、RLS、历史与重写事务。
- `supabase/functions/submit-thought`：仅写入草稿的 AI 入口。

## 检查

```sh
npm run check
npm run format:check
npm test
npm run build
```

`npm test` 先验证草稿接口与真实 PostgreSQL 引擎上的数据库权限，再构建并运行桌面、手机 Playwright 测试。数据库测试使用 PGlite，不需要 Docker。浏览器测试构建固定使用 `room-test.supabase.co` 模拟项目，所有请求被测试拦截，不接触生产数据库。测试之后用 `npm run build` 恢复正常生产输出。

浏览器可用 `npx playwright install chromium` 安装；云环境优先使用 `/usr/bin/chromium`，也可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`。4173 测试服务自动关闭。临时 MDX 草稿使用排他写入，构建后清理。

GitHub Actions 已配置格式、类型和完整测试。真实 Supabase 邮件、云端权限及线上域名需要接入实际项目后另外验证，模拟测试不能代表这些已经完成。

## Vercel

导入 `Frank-Zikl/ziklspace`，仓库根目录，生产分支 `main`。`vercel.json` 指定 Astro、`npm ci`、`npm run build`、`dist`；Node.js 固定为 24。

在 Vercel 设置两个 `PUBLIC_SUPABASE_*` 变量，并将 Supabase 登录回调配置为实际站点地址，再重新部署。可选 `SITE_URL=https://你的正式域名` 用于 canonical 和分享地址。不要使用某次预览部署的临时域名作为生产地址。

已登录 Vercel CLI 时可运行 `npx vercel --prod`；本地 `.vercel/` 和环境变量文件不会提交或上传。未配置 Supabase 时仍能部署静态房间，但登录及云端内容不可用。

## 设计约定

统一为温暖卡通房间，正面开放，物件行为符合用途。展示文字仅保留名字、对象名称、状态和必要操作；不添加介绍标语。私有思考发布前必须由房主检查，AI 不能自动代表用户表达感受。
