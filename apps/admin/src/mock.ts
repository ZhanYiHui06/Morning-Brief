import type { BriefDraft, ContentItem, DashboardData, ModelConfig, Run, SystemStatus } from "./types";

export const dashboard: DashboardData = {
  date: "2026-07-21",
  briefStatus: "published",
  deliveryStatus: "sent",
  counts: { collected: 86, kept: 24, dropped: 43, merged: 9, published: 12 },
  stages: [
    { name: "获取 Zara Feed", status: "succeeded", durationMs: 1840 },
    { name: "获取 GitHub Trending", status: "succeeded", durationMs: 920 },
    { name: "筛选与事件合并", status: "succeeded", durationMs: 3180 },
    { name: "生成中文晨报", status: "partial", durationMs: 12460, message: "一个模型请求使用备用路由，已自动完成降级" },
    { name: "发布网页", status: "succeeded", durationMs: 1280 }
  ]
};

export const contents: ContentItem[] = [
  {
    id: "item-1", author: "Boris Cherny", source: "Zara · X", category: "AI Coding",
    content: "Claude Code 团队分享了新的任务隔离与上下文管理方式，重点改善长时间运行的编码任务。",
    url: "https://example.com", decision: "keep",
    scores: { relevance: 9, importance: 8, novelty: 7, actionability: 9 },
    reason: "与 Agent Harness 和 AI 编程工作流直接相关。"
  },
  {
    id: "item-2", author: "Swyx", source: "Zara · X", category: "行业观察",
    content: "一次缺少上下文的活动转发，仅包含简短评论。",
    decision: "pending", scores: { relevance: 4, importance: 3, novelty: 4, actionability: 2 },
    reason: "上下文不足，自动流程未将其纳入晨报。"
  },
  {
    id: "item-3", author: "Claude", source: "Zara · X", category: "产品更新",
    content: "Claude 发布新能力的官方公告，与团队成员的多条解释被识别为同一事件。",
    decision: "merge", scores: { relevance: 10, importance: 9, novelty: 8, actionability: 8 },
    reason: "合并到“Claude 产品更新”事件，避免重复展示。"
  }
];

export const brief: BriefDraft = {
  date: "2026-07-21",
  title: "Agent 开始接管更长的工作链",
  deck: "今天的信号集中在上下文管理、任务隔离，以及开发者对可控性的重新重视。",
  status: "published",
  highlights: [
    { title: "Claude Code 改善长任务上下文", summary: "工程团队公开了新的任务隔离与上下文管理思路，重点解决 Agent 长时间运行后目标漂移、历史信息堆积和中间状态不透明的问题。这意味着 AI 编程产品正在从单次生成代码，转向持续完成一段可验证的真实工作。" },
    { title: "GitHub 趋势向本地 Agent 倾斜", summary: "今日 GitHub Trending 前五中有两个项目强调本地运行、隐私保护与可组合工具。开发者不再只追求模型能力，而是开始关注数据放在哪里、工具如何连接，以及 Agent 出错后能否恢复。" },
    { title: "可控性成为 Agent 产品的核心体验", summary: "多位产品负责人同时讨论确认、撤销、任务边界和失败恢复。随着模型能够执行更复杂的操作，用户是否敢把任务真正交出去，正在成为比功能数量更重要的产品指标。" }
  ]
};

export const modelConfig: ModelConfig = {
  paused: false,
  providers: [
    { id: "proxy", name: "CLI Proxy API", protocol: "openai-compatible", baseUrl: "http://localhost:8317/v1", envSecretRef: "MORNING_BRIEF_LLM_KEY", enabled: true, health: "healthy" },
    { id: "backup", name: "备用兼容接口", protocol: "openai-compatible", baseUrl: "https://api.example.com/v1", envSecretRef: "MORNING_BRIEF_BACKUP_KEY", enabled: false, health: "unknown" }
  ],
  models: [
    { id: "fast", providerId: "proxy", modelId: "fast-model", displayName: "快速分类模型", enabled: true, structuredOutput: true },
    { id: "main", providerId: "proxy", modelId: "main-model", displayName: "晨报主模型", enabled: true, structuredOutput: true },
    { id: "strong", providerId: "proxy", modelId: "strong-model", displayName: "最终编辑模型", enabled: true, structuredOutput: true }
  ],
  routes: [
    { task: "classify", label: "相关性分类", primaryModelId: "fast", fallbackModelId: "main" },
    { task: "builder-summary", label: "Builders 摘要", primaryModelId: "main", fallbackModelId: "strong" },
    { task: "final-brief", label: "最终晨报", primaryModelId: "strong", fallbackModelId: "main" }
  ]
};

export const runs: Run[] = [
  { id: "run-0721", startedAt: "2026-07-21T06:50:03+08:00", durationMs: 21840, status: "partial", trigger: "schedule", summary: "自动采集、生成与网页发布已完成。1 次模型请求走备用路由。", stages: dashboard.stages },
  { id: "run-0720", startedAt: "2026-07-20T06:50:01+08:00", durationMs: 19820, status: "succeeded", trigger: "schedule", summary: "采集、生成和发布全部完成。", stages: dashboard.stages.map((stage) => ({ ...stage, status: "succeeded" })) }
];

export const systemStatus: SystemStatus = {
  environment: "development",
  timeZone: "Asia/Shanghai",
  publicUrl: "http://127.0.0.1:4322",
  automation: { enabled: true, pauseOnSevereError: true },
  schedule: {
    installed: true,
    collectionTime: "06:50",
    deliveryTime: "07:15",
    maxItems: 15
  },
  delivery: { webPublishing: true },
  secrets: { githubTokenConfigured: false, llmKeyConfigured: true },
  sources: [
    { id: "zara-x", name: "Zara Builders · X", kind: "JSON Feed", url: "由 ZARA_X_FEED_URL 配置", enabled: true },
    { id: "zara-podcasts", name: "Zara Builders · Podcasts", kind: "JSON Feed", url: "由 ZARA_PODCASTS_FEED_URL 配置", enabled: true },
    { id: "zara-blogs", name: "Zara Builders · Blogs", kind: "JSON Feed", url: "由 ZARA_BLOGS_FEED_URL 配置", enabled: true },
    { id: "github-trending", name: "GitHub Trending · Daily Top 5", kind: "HTML", url: "https://github.com/trending?since=daily", enabled: true }
  ]
};
