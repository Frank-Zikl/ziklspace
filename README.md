# Ziklspace

Zikl 的个人空间。Astro、TypeScript 和 MDX，输出静态站点。

## 开发

Node.js 22.22+，`.nvmrc` 固定当前验证过的 24.19.0。

```sh
npm ci
npm run dev
```

开发服务监听 `0.0.0.0:4321`。当前云环境的主目录不可写，使用以下命令：

```sh
export ASTRO_TELEMETRY_DISABLED=1
npm --cache /tmp/ziklspace-npm-cache ci --no-audit --no-fund
npm run dev
```

交互式终端中的开发服务在前台运行，使用 Ctrl+C 停止。Astro 7 在 AI agent 环境中会自动进入后台，停止当前仓库的后台服务：

```sh
./node_modules/.bin/astro dev stop
```

如果云机器冷启动超过后台模式的 30 秒等待上限，先确认没有现有实例，再以前台模式启动并保留终端会话：

```sh
npm run dev -- --ignore-lock --port 4321
```

`--ignore-lock` 在这里用于开发服务的实例记录，与 npm 的依赖锁文件无关。这个前台实例使用 Ctrl+C 停止；`astro dev status/stop` 不会管理它。

## 检查

```sh
npm run check
npm run format:check
npm test
```

`npm test` 会构建生产输出，再运行桌面和手机的 Playwright 测试，覆盖导航、阅读、项目链接、纸团、印章、翻页、草稿过滤、窄屏、减少动态效果和 404。测试服务在 4173 端口启动，结束后自动关闭。

本机需要 Chromium：

```sh
npx playwright install chromium
```

云环境会自动使用已有的 `/usr/bin/chromium`。也可以用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定浏览器路径。GitHub Actions 安装 Playwright 对应版本的 Chromium。

失败时查看 `playwright-report/`，或运行 `npm run test:report`。

草稿检查使用 `tests/fixtures/` 中的测试数据：构建前临时写入内容目录，构建后清理；排他写入保护已有文件。测试不会修改现有笔记、项目或近况。

## 内容

首页、列表和详情页都从内容集合生成。文件名决定地址；正文支持 Markdown 和 MDX。三篇现有笔记是明确标记的样稿。

### 笔记

新建 `src/content/notes/文件名.mdx`：

```yaml
---
title: 笔记标题
date: '2026-10-20'
category: 一些思考
sample: false
draft: false
---
```

在 frontmatter 下写正文。`description` 可选，仅用于页面元信息。首页按日期选取最新笔记。

### 项目

新建 `src/content/projects/文件名.mdx`：

```yaml
---
title: 项目名称
category: 项目
date: '2026-10-20'
status: active
featured: false
order: 0
draft: false
---
```

`url` 可填项目的公开网址，`repository` 可填代码仓库网址，均只接受 HTTP 或 HTTPS。项目状态支持 `active`、`paused`、`complete`、`archived`。首页优先展示 `featured: true` 的项目；列表按 `order`、日期排序。正文会出现在项目详情页。

### 近况

新建 `src/content/updates/日期.mdx`：

```yaml
---
title: Ziklspace 初版
date: '2026-10-20'
project: ziklspace
items:
  - 工作台首页
  - 笔记与项目页面
---
```

`project` 可选，填写项目文件对应的 ID。首页展示最新近况的前两项；近况页保留历史记录和正文。

所有集合都支持 `draft: true`；草稿不会出现在首页、列表或详情路由中。未填写 `draft` 时默认发布。未填写 `sample` 时默认真实内容，样稿必须显式标记。

## 代码位置

- `src/pages/index.astro`：首页内容组合。
- `src/components/CanvasIntro.astro`、`CanvasNavigation.astro`：签名和星图导航。
- `src/components/Workbench.astro`：工作台。
- `src/components/CanvasIndex.astro`：索引纸片及手机翻页。
- `src/components/StampButton.astro`、`PaperPlay.astro`：独立互动组件。
- `src/lib/content.ts`：发布过滤、排序和日期格式。
- `src/content.config.ts`：内容字段校验。
- `src/data/site.ts`、`src/data/play.ts`：个人信息和纸团内容。
- `src/styles/global.css`、`canvas.css`、`materials.css`：基础排版、画布布局及材质。
- `tests/e2e/`：浏览器回归测试。

## 构建与部署

```sh
npm run build
npm run preview
```

将 `dist/` 部署到静态托管服务。有正式域名后，在构建环境设置 `SITE_URL`，即可生成 canonical 和分享地址：

```sh
SITE_URL=https://你的域名 npm run build
```

未配置域名时不生成绝对地址。GitHub Actions 已配置格式、类型检查和浏览器测试；远端执行结果需在推送后确认。

## 设计约定

- 保留已确认的自由画布、工作台、星图导航和散放索引。
- 物件使用左上方光照、纸层、折边和接触阴影表现体积。
- 界面仅使用名字、栏目、日期、状态和必要操作，省略介绍、标语和装饰性文案。
- 内容有独立链接，移动端和键盘操作都可用，尊重减少动态效果设置。
- 获得真实内容前，样稿保持明确标记，不编造个人经历或联系方式。

云任务已有独立环境，直接使用当前 checkout；用户没有要求时无需创建 Git worktree。
