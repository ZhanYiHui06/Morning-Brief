import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import {
  Article, CaretDown, CheckCircle, ClockCounterClockwise,
  Database, Gear, GithubLogo, List, Play, Pulse, Robot,
  SlidersHorizontal, SquaresFour, X
} from "@phosphor-icons/react";
import { api, apiBaseUrl, isMockMode } from "./api";
import type { ContentDecision, ModelConfig, Provider, Run } from "./types";

type Page = "dashboard" | "content" | "sources" | "models" | "runs" | "settings";
type Icon = typeof SquaresFour;
const nav: Array<{ id: Page; label: string; note: string; icon: Icon }> = [
  { id: "dashboard", label: "今日概况", note: "运行与发布", icon: SquaresFour },
  { id: "content", label: "每日内容", note: "采集与筛选", icon: Article },
  { id: "sources", label: "信息源", note: "Feed 与 GitHub", icon: Database },
  { id: "models", label: "模型与 API", note: "Provider 与路由", icon: Robot },
  { id: "runs", label: "运行记录", note: "时间线与日志", icon: Pulse },
  { id: "settings", label: "系统设置", note: "自动化与计划", icon: Gear }
];

function useLoad<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  useEffect(() => { loader().then(setData).catch((e: unknown) => setError(e instanceof Error ? e.message : "加载失败")); }, []);
  return { data, setData, error };
}

const statusText = (status: string) => ({
  succeeded: "完成", running: "进行中", failed: "失败", partial: "部分完成", pending: "待处理",
  keep: "已保留", drop: "已过滤", merge: "已合并", draft: "草稿", published: "已发布",
  not_sent: "未发送", sent: "已发送", healthy: "可用", unknown: "未知"
}[status] || status);

function Status({ value }: { value: string }) {
  return <span className={`status status-${value}`}><i />{statusText(value)}</span>;
}

function Loading({ error }: { error?: string }) {
  return <div className={error ? "error-state" : "loading"}><span />{error || "正在读取数据"}</div>;
}

function PageHead({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return <header className="page-head" data-animate><div><h1>{title}</h1><p>{description}</p></div>{children && <div className="page-actions">{children}</div>}</header>;
}

function useShanghaiTime() {
  const format = () => new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());
  const [value, setValue] = useState(format);
  useEffect(() => {
    const timer = window.setInterval(() => setValue(format()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return value;
}

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 2600); };
  const current = nav.find((item) => item.id === page)!;
  const shanghaiTime = useShanghaiTime();

  useLayoutEffect(() => {
    if (!contentRef.current) return;
    const container = contentRef.current;
    const mm = gsap.matchMedia();
    const animated = new WeakSet<HTMLElement>();
    const tweens = new Set<gsap.core.Tween>();
    let reveal = (_elements: HTMLElement[]) => {};

    const collect = (root: ParentNode | HTMLElement) => {
      const elements: HTMLElement[] = [];
      if (root instanceof HTMLElement && root.matches("[data-animate]")) elements.push(root);
      elements.push(...Array.from(root.querySelectorAll<HTMLElement>("[data-animate]")));
      return elements.filter((element) => {
        if (animated.has(element)) return false;
        animated.add(element);
        return true;
      });
    };

    const revealNew = (root: ParentNode | HTMLElement) => {
      const elements = collect(root);
      if (elements.length) reveal(elements);
    };

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      reveal = (elements) => {
        const tween = gsap.fromTo(elements, { autoAlpha: 0, y: 12 }, {
          autoAlpha: 1,
          y: 0,
          duration: .46,
          stagger: .045,
          ease: "power2.out",
          clearProps: "transform,opacity,visibility",
          onComplete: () => tweens.delete(tween)
        });
        tweens.add(tween);
      };
      revealNew(container);
    });

    mm.add("(prefers-reduced-motion: reduce)", () => {
      reveal = (elements) => gsap.set(elements, { clearProps: "all" });
      revealNew(container);
    });

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) revealNew(node);
        });
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      tweens.forEach((tween) => tween.kill());
      mm.revert();
    };
  }, [page]);

  const go = (next: Page) => { setPage(next); setMenuOpen(false); };
  return <div className="admin-shell">
    <aside className={menuOpen ? "sidebar open" : "sidebar"} aria-label="管理后台导航">
      <div className="brand"><span>MB</span><div><b>Morning Brief</b><small>CONTROL DESK</small></div><button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="关闭导航"><X /></button></div>
      <nav>{nav.map((item) => { const NavIcon = item.icon; return <button key={item.id} aria-current={page === item.id ? "page" : undefined} onClick={() => go(item.id)}><NavIcon size={18} weight={page === item.id ? "fill" : "regular"}/><span><b>{item.label}</b><small>{item.note}</small></span></button>; })}</nav>
      <div className="connection"><span className={isMockMode ? "signal amber" : "signal"}/><div><b>{isMockMode ? "本地示例模式" : "管理 API 已连接"}</b><small>{apiBaseUrl || "修改只保留在当前会话"}</small></div></div>
    </aside>
    {menuOpen && <button className="nav-scrim" aria-label="关闭导航" onClick={() => setMenuOpen(false)} />}

    <section className="workspace">
      <header className="topbar"><button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="打开导航"><List size={21}/></button><span>控制台 / {current.label}</span><div><span className="live-dot"/>上海时间 · {shanghaiTime}</div></header>
      {isMockMode && <div className="mock-banner"><b>本地预览</b><span>页面使用示例数据。连接管理 API 后，保存操作才会持久化。</span></div>}
      <main ref={contentRef}>
        {page === "dashboard" && <Dashboard flash={flash} go={go} />}
        {page === "content" && <DailyContent />}
        {page === "sources" && <Sources flash={flash} />}
        {page === "models" && <ModelSettings flash={flash} />}
        {page === "runs" && <Runs />}
        {page === "settings" && <Settings flash={flash} />}
      </main>
    </section>
    {notice && <div className="toast" role="status"><CheckCircle size={18} weight="fill"/>{notice}</div>}
  </div>;
}

function Dashboard({ flash, go }: { flash: (message: string) => void; go: (page: Page) => void }) {
  const { data, error } = useLoad(api.dashboard);
  if (!data) return <Loading error={error} />;
  const metrics = [["采集", data.counts.collected], ["保留", data.counts.kept], ["过滤", data.counts.dropped], ["合并", data.counts.merged]];
  const run = async () => { await api.runTask("daily"); flash("完整流水线已进入任务队列"); };
  return <>
    <PageHead title="今日概况" description={`${data.date}，自动流程会完成采集、筛选、生成和网页发布。`}><span className="automation-badge"><span className="live-dot"/>全自动模式</span><button className="button primary" onClick={run}><Play weight="fill"/>立即运行一次</button></PageHead>
    <section className="metric-rail" data-animate>{metrics.map(([label, value], index) => <div key={label}><small>{label}</small><strong>{value}</strong><span>{index === 0 ? "今日原始条目" : "内容决策"}</span></div>)}</section>
    <div className="dashboard-grid">
      <section className="panel pipeline-panel" data-animate><header className="panel-head"><div><span className="section-code">PIPELINE</span><h2>本次运行</h2></div><Status value={data.briefStatus}/></header><div className="stage-list">{data.stages.length ? data.stages.map((stage, index) => <div className="stage" key={`${stage.name}-${index}`}><span className="stage-index">{String(index + 1).padStart(2, "0")}</span><Status value={stage.status}/><span><b>{stage.name}</b><small>{stage.message || "阶段执行正常"}</small></span><time>{stage.durationMs ? `${(stage.durationMs / 1000).toFixed(1)}s` : "等待"}</time></div>) : <div className="empty-row">当前没有运行中的阶段。</div>}</div></section>
      <aside className="panel publish-panel" data-animate><header className="panel-head"><div><span className="section-code">PUBLISHING</span><h2>网页发布</h2></div><Article size={20}/></header><div className="panel-body"><Status value={data.briefStatus}/><h3>今日流程已自动完成</h3><p>AI 已完成内容判断、晨报生成和网页发布。发生严重异常时，任务会记录失败并保留上一版页面。</p><a className="button primary full" href="/" target="_blank" rel="noreferrer">打开今日晨报</a><button className="button ghost full" onClick={() => go("content")}>查看今日内容</button></div></aside>
    </div>
  </>;
}

function DailyContent() {
  const { data, error } = useLoad(api.contents);
  const [filter, setFilter] = useState<ContentDecision | "all">("all");
  const filtered = useMemo(() => data?.filter((item) => filter === "all" || item.decision === filter) || [], [data, filter]);
  if (!data) return <Loading error={error} />;
  return <>
    <PageHead title="每日内容" description="查看当天采集、分类与筛选结果。整个流程默认由 AI 自动完成。"><span className="muted-label">共 {data.length} 条</span></PageHead>
    <div className="filter-row" data-animate>{(["all", "pending", "keep", "drop", "merge"] as const).map((value) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{({ all: "全部", pending: "待处理", keep: "已保留", drop: "已过滤", merge: "已合并" })[value]}</button>)}<span>{filtered.length} 条内容</span></div>
    <section className="daily-content-list panel" data-animate>{filtered.length ? filtered.map((entry) => <article className="daily-content-row" key={entry.id}><header><span><b>{entry.author}</b><small>{entry.source}</small></span><Status value={entry.decision}/></header><p>{entry.content}</p><footer><span>{entry.category}</span><span>相关度 {entry.scores.relevance}/10</span>{entry.reason && <span>{entry.reason}</span>}{entry.url && <a href={entry.url} target="_blank" rel="noreferrer">查看来源 ↗</a>}</footer></article>) : <div className="empty-row">当前分类下没有内容。</div>}</section>
  </>;
}

function Sources({ flash: _flash }: { flash: (message: string) => void }) {
  const { data, error } = useLoad(api.system);
  if (!data) return <Loading error={error}/>;
  return <><PageHead title="信息源" description="这里展示生产环境当前实际启用的采集入口。配置由服务器环境变量管理。"/>
    <section className="panel" data-animate><header className="panel-head"><div><span className="section-code">PRODUCTION SOURCES</span><h2>正在使用的信息源</h2></div><Status value={data.sources.every((source) => source.enabled) ? "succeeded" : "partial"}/></header><div className="source-list">{data.sources.map((source) => <div className="source-row source-row-live" key={source.id}><span className="source-icon">{source.id === "github-trending" ? <GithubLogo/> : <Database/>}</span><span><b>{source.name}</b><small>{source.url || "未配置 URL"}</small></span><span><small>类型</small><b>{source.kind}</b></span><span><small>状态</small><b>{source.enabled ? "已启用" : "未配置"}</b></span><Status value={source.enabled ? "succeeded" : "failed"}/></div>)}</div></section>
    <aside className="security-note" data-animate><Database/><div><b>来源配置不在浏览器内修改</b><p>Zara Feed 地址由 ZARA_X_FEED_URL、ZARA_PODCASTS_FEED_URL、ZARA_BLOGS_FEED_URL 提供；GitHub 每日读取全球 Trending 前 5。GitHub Token 当前{data.secrets.githubTokenConfigured ? "已配置" : "未配置，公共页面采集仍可运行"}。</p></div></aside>
  </>;
}

function ModelSettings({ flash }: { flash: (message: string) => void }) {
  const { data, setData, error } = useLoad(api.modelConfig);
  const [providerId, setProviderId] = useState<string>();
  if (!data) return <Loading error={error} />;
  const selected = data.providers.find((provider) => provider.id === providerId);
  const editProvider = (provider: Provider) => setData({ ...data, providers: data.providers.map((entry) => entry.id === provider.id ? provider : entry) });
  const save = async () => { await api.saveModelConfig(data); flash("模型配置已保存"); };
  return <><PageHead title="模型与 API" description="集中管理兼容接口、模型能力和任务路由。密钥只使用环境变量引用。"><button className="button primary" onClick={save}>保存配置</button></PageHead>
    <aside className="security-note" data-animate><Robot/><div><b>密钥不会进入浏览器</b><p>这里只保存环境变量名称。控制台不读取、不显示，也不允许导出 API Key 明文。</p></div></aside>
    <section className="panel" data-animate><header className="panel-head"><div><span className="section-code">PROVIDERS</span><h2>API 提供商</h2></div><button className="button ghost small" onClick={() => flash("新增 Provider 表单将在接口就绪后开放")}>添加提供商</button></header><div className="provider-table">{data.providers.map((provider) => <button key={provider.id} onClick={() => setProviderId(provider.id)}><Status value={provider.health}/><span><b>{provider.name}</b><small>{provider.baseUrl}</small></span><code>{provider.envSecretRef}</code><span>{provider.enabled ? "已启用" : "已停用"}</span><span>编辑 →</span></button>)}</div></section>
    <section className="panel" data-animate><header className="panel-head"><div><span className="section-code">MODELS</span><h2>已配置模型</h2></div><span className="muted-label">{data.models.filter((model) => model.enabled).length} 个启用</span></header><div className="model-list">{data.models.map((model) => <article key={model.id}><small>{data.providers.find((provider) => provider.id === model.providerId)?.name}</small><h3>{model.displayName}</h3><code>{model.modelId}</code><span>{model.structuredOutput ? "结构化输出" : "文本输出"}</span></article>)}</div></section>
    <section className="panel" data-animate><header className="panel-head"><div><span className="section-code">ROUTING</span><h2>任务路由</h2></div><label className="pause"><input type="checkbox" checked={data.paused} onChange={(event) => setData({ ...data, paused: event.target.checked })}/>暂停模型调用</label></header><div className="route-table"><div className="route-header"><span>任务</span><span>主要模型</span><span>备用模型</span></div>{data.routes.map((route) => <div className="route-row" key={route.task}><b>{route.label}</b><select value={route.primaryModelId} onChange={(event) => setData({ ...data, routes: data.routes.map((entry) => entry.task === route.task ? { ...entry, primaryModelId: event.target.value } : entry) })}>{data.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select><select value={route.fallbackModelId || ""} onChange={(event) => setData({ ...data, routes: data.routes.map((entry) => entry.task === route.task ? { ...entry, fallbackModelId: event.target.value } : entry) })}><option value="">无备用</option>{data.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select></div>)}</div></section>
    {selected && <div className="sheet-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) setProviderId(undefined); }}><aside className="edit-sheet" role="dialog" aria-modal="true" aria-labelledby="provider-title"><header><div><span className="section-code">PROVIDER</span><h2 id="provider-title">编辑 {selected.name}</h2></div><button className="icon-action" onClick={() => setProviderId(undefined)} aria-label="关闭"><X/></button></header><label className="field"><span>显示名称</span><input value={selected.name} onChange={(event) => editProvider({ ...selected, name: event.target.value })}/></label><label className="field"><span>Base URL</span><input value={selected.baseUrl} onChange={(event) => editProvider({ ...selected, baseUrl: event.target.value })}/></label><label className="field"><span>密钥环境变量引用</span><input value={selected.envSecretRef} onChange={(event) => editProvider({ ...selected, envSecretRef: event.target.value })}/><small>例如 MORNING_BRIEF_LLM_KEY，这里不是密钥输入框。</small></label><SettingToggle title="启用 Provider" note="停用后，关联任务使用备用路由" initial={selected.enabled}/><div className="sheet-actions"><button className="button ghost" onClick={() => setProviderId(undefined)}>取消</button><button className="button primary" onClick={() => { setProviderId(undefined); save(); }}>保存更改</button></div></aside></div>}
  </>;
}

function Runs() {
  const { data, error } = useLoad(api.runs);
  const [expanded, setExpanded] = useState<string>();
  if (!data) return <Loading error={error} />;
  return <><PageHead title="运行记录" description="先看可读摘要，需要时再展开阶段与技术信息。"><button className="button ghost"><SlidersHorizontal/>筛选运行</button></PageHead><section className="runs panel" data-animate>{data.map((run: Run) => <article key={run.id}><button className="run-summary" onClick={() => setExpanded(expanded === run.id ? undefined : run.id)} aria-expanded={expanded === run.id}><Status value={run.status}/><span><b>{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(run.startedAt))}</b><small>{run.summary}</small></span><code>{run.id}</code><time>{run.durationMs ? `${(run.durationMs / 1000).toFixed(1)} 秒` : "运行中"}</time><CaretDown className={expanded === run.id ? "rotated" : ""}/></button>{expanded === run.id && <div className="run-detail">{run.stages.length ? run.stages.map((stage, index) => <div key={`${stage.name}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><Status value={stage.status}/><div><b>{stage.name}</b><small>{stage.message || "无额外信息"}</small></div></div>) : <p>该运行没有可展示的阶段明细。</p>}<button className="button ghost small">查看原始技术日志</button></div>}</article>)}</section></>;
}

function BooleanState({ value }: { value: boolean }) {
  return <Status value={value ? "succeeded" : "failed"}/>;
}

function Settings({ flash: _flash }: { flash: (message: string) => void }) {
  const { data, error } = useLoad(api.system);
  if (!data) return <Loading error={error}/>;
  return <><PageHead title="系统设置" description="生产配置只读展示。敏感配置保存在服务器，不会返回浏览器。"/>
    <div className="settings-columns">
      <section className="panel span-two automation-panel" data-animate><header className="panel-head"><div><span className="section-code">AUTOPILOT</span><h2>自动化状态</h2></div><span className="automation-badge"><span className="live-dot"/>{data.automation.enabled ? "正在运行" : "已暂停"}</span></header><div className="panel-body production-state-grid"><ProductionState title="全自动运行" detail="采集、AI 筛选与总结、网页发布" value={data.automation.enabled}/><ProductionState title="严重异常时暂停" detail="避免发布不完整结果" value={data.automation.pauseOnSevereError}/></div></section>
      <section className="panel" data-animate><header className="panel-head"><div><span className="section-code">SCHEDULE</span><h2>每日计划</h2></div><ClockCounterClockwise/></header><div className="panel-body production-list"><ProductionRow label="时区" value={data.timeZone}/><ProductionRow label="定时任务" value={data.schedule.installed ? "已安装" : "未安装"} ok={data.schedule.installed}/><ProductionRow label="开始采集" value={data.schedule.collectionTime ?? "未配置"}/><ProductionRow label="目标发布" value={data.schedule.deliveryTime ?? "生成完成后"}/><ProductionRow label="最大内容数" value={String(data.schedule.maxItems)}/></div></section>
      <section className="panel" data-animate><header className="panel-head"><div><span className="section-code">PUBLISHING</span><h2>网页发布</h2></div><Article/></header><div className="panel-body production-list"><ProductionRow label="自动发布" value={data.delivery.webPublishing ? "已启用" : "未启用"} ok={data.delivery.webPublishing}/><ProductionRow label="公开地址" value={data.publicUrl || "未配置"}/></div></section>
    </div>
  </>;
}

function ProductionRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return <div className="production-row"><span>{label}</span><b>{value}</b>{ok !== undefined && <BooleanState value={ok}/>}</div>;
}

function ProductionState({ title, detail, value }: { title: string; detail: string; value: boolean }) {
  return <div className="production-state"><span><b>{title}</b><small>{detail}</small></span><BooleanState value={value}/></div>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button className="toggle" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span/></button>;
}
function SettingToggle({ title, note, initial = false }: { title: string; note: string; initial?: boolean }) {
  const [checked, setChecked] = useState(initial);
  return <div className="setting-toggle"><span><b>{title}</b><small>{note}</small></span><Toggle checked={checked} onChange={setChecked} label={title}/></div>;
}

export default App;
