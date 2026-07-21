# Architecture

## Data flow

```text
Follow Builders feeds ─┐
                       ├─ collect → snapshot → normalize → filter
GitHub Trending ───────┘                         ↓
                              deduplicate → score → cluster
                                                   ↓
                                 translate → summarize → DailyBrief
                                                   ↓
                                    SQLite + JSON + Astro build
                                                   ↓
                                      Caddy static publication
```

采集快照、标准化内容和最终晨报使用不同的数据结构。采集器只负责获取事实，
展示文案由流水线统一生成，阅读页和可选投递渠道消费同一份 `DailyBrief`。

## Applications

- `worker`：可重复执行的生产流水线，负责采集、模型处理、持久化和静态发布。
- `server`：提供管理 API、配置读写和任务触发，不承担公开阅读页流量。
- `web`：从晨报 JSON 构建首页、日期详情、全部原文页与归档。
- `admin`：管理 API 的浏览器客户端，不直接访问 SQLite 或服务端密钥。

## Storage

```text
/var/lib/morning-brief/
  data/
    morning-brief.sqlite
    raw/
    briefs/
  public/
    releases/
    current -> releases/<timestamp>
```

流水线使用文件锁避免同一时间重复运行。相同日期的数据通过稳定 ID 和 upsert
更新；静态站使用新 release 构建完成后再切换 `current` 符号链接。

## Model routing

Provider、Model 和 Task Route 存在 SQLite 中。路由保存模型 ID 与密钥环境变量
名称，运行时才解析环境变量值。路由不可用时，可以回退到服务器环境中的默认
OpenAI-compatible 配置。

## Production topology

```text
Internet
   ↓
Caddy
   ├─ /                 → generated Astro release
   ├─ /admin/*          → React admin release + Basic Auth
   └─ /api/*            → Hono API on 127.0.0.1:8787 + Basic Auth
                              ↓
                    SQLite + production worker
```

Docker 容器使用 host network，仅让 API 监听本机地址。Caddy 负责 TLS、静态资源
和后台访问控制；cron 在每天固定时间调用容器内生产流水线。

## Secrets

- 敏感值只存在于 `/etc/morning-brief/morning-brief.env` 或等价密钥系统。
- 浏览器接口只返回密钥是否已配置，不返回密钥值。
- 日志、错误与数据库配置不得包含明文密钥。
- Git 忽略本地环境文件、数据库、快照、晨报产物和部署上传包。
