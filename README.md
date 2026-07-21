# Morning Brief

Morning Brief 是一套自动化 AI 资讯晨报系统。它每天聚合 Zara Zhang 的
[Follow Builders](https://github.com/zarazhangrui/follow-builders) 公开 Feed
与 GitHub Trending，经过标准化、筛选、聚类、翻译和模型总结后，生成适合
快速阅读的中文晨报、完整原文页和历史归档。

线上实例：<https://breakfast.151014.xyz>

## 关于 Follow Builders

Builders 人物动态、播客与博客信息源来自 Zara Zhang 创建和维护的
[zarazhangrui/follow-builders](https://github.com/zarazhangrui/follow-builders)。
感谢 Zara 持续维护高质量的 AI Builder 名单、公开 Feed 和项目方法论，让本项目
能够在可靠的上游信息源之上继续构建个人化阅读体验。

Morning Brief 不复制 Follow Builders 的采集基础设施，而是消费其公开 Feed，
在此基础上增加面向个人需求的内容筛选、中文翻译、事件聚类、GitHub Trending、
静态阅读网站和管理后台。原始内容页面保留来源名称及外部链接。

## 核心能力

- 采集 Follow Builders 的 X、播客和博客公开 Feed
- 获取 GitHub Daily Trending 前五并补充 README
- 自动完成内容过滤、去重、评分、事件聚类和中文翻译
- 生成「今日关键信息」「Builders 在说什么」「GitHub 趋势」与「下一步行动」
- 为每日全部采集内容生成不做过滤的分类原文页
- 使用 Astro 构建静态阅读页和历史归档
- 使用 React 管理今日概况、每日内容、信息源、模型路由和运行记录
- 使用 SQLite 保存内容、晨报、模型配置和流水线状态
- 使用 Docker、Caddy 与 cron 运行生产环境

## 项目结构

```text
apps/
  worker/    采集、筛选、翻译、总结和发布流水线
  server/    管理 API 与任务触发
  web/       Astro 阅读页、原文页和历史归档
  admin/     React 管理后台
packages/
  core/      共享领域模型与校验 Schema
  database/  SQLite Schema、迁移与访问层
deploy/      Docker、Caddy、cron 与生产配置模板
docs/        架构与设计原则
design/      早期页面设计和交互原型
```

## 技术栈

- Node.js 22、TypeScript、pnpm workspace
- Astro、React、Vite
- Hono
- SQLite、Drizzle ORM
- Vitest
- Docker Compose、Caddy、cron
- OpenAI-compatible LLM API

## 本地开发

要求 Node.js 22.13+ 与 pnpm 10。

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm test
pnpm build
pnpm dev
```

也可以分别启动各应用：

```powershell
pnpm dev:server
pnpm dev:web
pnpm dev:admin
```

默认开发入口：

- 阅读页：`http://127.0.0.1:4321`
- 管理后台：`http://127.0.0.1:5173`
- 管理 API：`http://127.0.0.1:8787`

管理后台连接地址需要包含 `/api`：

```env
VITE_ADMIN_API_URL=http://127.0.0.1:8787/api
```

## 生成晨报

配置至少一个 Follow Builders Feed 和可用模型后运行：

```powershell
pnpm daily -- --date 2026-07-21
```

Worker 会优先读取数据库中的 `daily-overview` 任务路由。没有可用路由时，
回退到 `.env.local` 中的 `LLM_BASE_URL`、`LLM_MODEL` 和
`MORNING_BRIEF_LLM_API_KEY`。

## 生产部署

生产环境使用以下组件：

- `deploy/compose.production.yaml`：管理 API 与 Worker 容器
- `deploy/breakfast.caddy`：阅读页、后台和 API 路由
- `deploy/morning-brief.cron`：每日定时流水线
- `/etc/morning-brief/morning-brief.env`：仅存在于服务器的敏感配置
- `/var/lib/morning-brief`：数据库、原始快照、晨报 JSON 与静态发布目录

生产流水线命令：

```bash
docker exec morning-brief pnpm --filter @morning-brief/worker \
  production-daily --date YYYY-MM-DD --requested-by manual
```

每次运行会重新采集、生成指定日期晨报，随后构建 Astro 静态站并原子切换
`PUBLIC_DIR/current`。管理后台和 `/api/*` 应使用访问认证保护。

## 数据与安全边界

- API Key 只从服务端环境变量读取，不进入浏览器或 SQLite 明文字段。
- 数据库只保存密钥环境变量名称，例如 `MORNING_BRIEF_LLM_API_KEY`。
- `.env.local`、SQLite、原始 Feed、晨报成品和部署压缩包均不会提交 Git。
- 模型和 Provider 配置由管理后台维护，密钥值仍只在服务器配置。
- OpenClaw Webhook 适配器是可选能力；未配置相关环境变量时不会发送消息。

## 质量检查

```powershell
pnpm test
pnpm build
```

测试覆盖共享 Schema、SQLite、管理 API、采集解析、流水线、模型路由与晨报
生成。提交代码前应保证测试与全量构建通过。

## 致谢

特别感谢 [Zara Zhang](https://github.com/zarazhangrui) 和她维护的
[Follow Builders](https://github.com/zarazhangrui/follow-builders)。这个项目的
「Follow Builders, Not Influencers」理念及公开 Feed，是 Morning Brief 的重要
信息源与灵感基础。
