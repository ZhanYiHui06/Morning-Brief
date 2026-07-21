import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import {
  Article, CaretDown, CheckCircle, ClockCounterClockwise,
  CloudArrowDown, Database, Gear, GithubLogo, Key, List, Play, Plus, Pulse, Robot,
  SlidersHorizontal, SquaresFour, X
} from "@phosphor-icons/react";
import { api, apiBaseUrl, isMockMode } from "./api";
import type { ContentDecision, DashboardData, DiscoveredModel, ModelConfig, Provider, Run } from "./types";

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
  const load = () => {
    setError("");
    loader().then(setData).catch((e: unknown) => setError(e instanceof Error ? e.message : "加载失败"));
  };
  useEffect(load, []);
  return { data, setData, error, reload: load };
}

const statusText = (status: string) => ({
  succeeded: "完成", running: "进行中", failed: "失败", partial: "部分完成", pending: "待处理",
  keep: "已保留", drop: "已过滤", merge: "已合并", draft: "草稿", published: "已发布",
  not_sent: "未发送", sent: "已发送", healthy: "可用", unknown: "未知"
}[status] || status);

function Status({ value }: { value: string }) {
  return <span className={`status status-${value}`}><i />{statusText(value)}</span>;
}

function Loading({ error, retry }: { error?: string; retry?: () => void }) {
  if (error) return <div className="error-state" role="alert"><b>数据加载失败</b><span>{error}</span>{retry && <button className="button ghost small" onClick={retry}>重试</button>}</div>;
  return <div className="loading" role="status"><span />正在读取数据</div>;
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

export type RunFilter = "all" | Run["status"] | Run["trigger"];

export const filterRuns = (runs: Run[], filter: RunFilter) =>
  runs.filter((run) => filter === "all" || run.status === filter || run.trigger === filter);

export type PublishingStatus = DashboardData["briefStatus"] | "failed";

export const publishCopy = (status: PublishingStatus) => ({
  published: { title: "今日晨报已发布", body: "内容判断、晨报生成和网页发布均已完成。", action: "打开今日晨报" },
  partial: { title: "今日流程仅部分完成", body: "部分阶段未完成，当前页面可能仍是上一版本。请先查看运行记录确认问题。", action: "查看当前页面" },
  failed: { title: "今日发布失败", body: "今日流程未能完成，公开页面仍保留上一版本。请查看运行记录并在修复后重试。", action: "查看上一版本" },
  draft: { title: "今日晨报仍是草稿", body: "生成或发布尚未完成。当前公开页面不会被描述为今日已发布版本。", action: "查看当前页面" }
}[status]);

type DialogProps = {
  titleId: string;
  className?: string;
  side?: boolean;
  busy?: boolean;
  onClose: () => void;
  onSubmit?: () => void | Promise<void>;
  children: React.ReactNode;
};

function Dialog({ titleId, className = "", side = false, busy = false, onClose, onSubmit, children }: DialogProps) {
  const ref = useRef<HTMLFormElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("[autofocus], input, select, button")?.focus());
    return () => { window.cancelAnimationFrame(frame); restoreFocus.current?.focus(); };
  }, []);
  const keyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab" || !ref.current) return;
    const focusable = Array.from(ref.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className={`sheet-scrim${side ? "" : " modal-scrim"}`} onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form ref={ref} className={`${side ? "edit-sheet" : "provider-dialog"} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={keyDown} onSubmit={(event) => { event.preventDefault(); void onSubmit?.(); }}>
      {children}
    </form>
  </div>;
}

function App() {
  const pageFromUrl = () => {
    const requested = new URLSearchParams(window.location.search).get("page");
    return nav.some((item) => item.id === requested) ? requested as Page : "dashboard";
  };
  const [page, setPage] = useState<Page>(pageFromUrl);
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 2600); };
  const current = nav.find((item) => item.id === page)!;
  const shanghaiTime = useShanghaiTime();

  useEffect(() => {
    const onPopState = () => setPage(pageFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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

  const go = (next: Page) => {
    const url = new URL(window.location.href);
    if (next === "dashboard") url.searchParams.delete("page"); else url.searchParams.set("page", next);
    window.history.pushState({}, "", url);
    setPage(next); setMenuOpen(false);
  };
  return <><a className="skip-link" href="#main-content">跳到主要内容</a><div className="admin-shell">
    <aside className={menuOpen ? "sidebar open" : "sidebar"} aria-label="管理后台导航">
      <div className="brand"><span>MB</span><div><b>Morning Brief</b><small>CONTROL DESK</small></div><button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="关闭导航"><X /></button></div>
      <nav>{nav.map((item) => { const NavIcon = item.icon; return <button key={item.id} aria-current={page === item.id ? "page" : undefined} onClick={() => go(item.id)}><NavIcon size={18} weight={page === item.id ? "fill" : "regular"}/><span><b>{item.label}</b><small>{item.note}</small></span></button>; })}</nav>
      <div className="connection"><span className={isMockMode ? "signal amber" : "signal"}/><div><b>{isMockMode ? "本地示例模式" : "管理 API 已连接"}</b><small>{apiBaseUrl || "修改只保留在当前会话"}</small></div></div>
    </aside>
    {menuOpen && <button className="nav-scrim" aria-label="关闭导航" onClick={() => setMenuOpen(false)} />}

    <section className="workspace">
      <header className="topbar"><button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="打开导航"><List size={21}/></button><span>控制台 / {current.label}</span><div><span className="live-dot"/>上海时间 · {shanghaiTime}</div></header>
      {isMockMode && <div className="mock-banner"><b>本地预览</b><span>页面使用示例数据。连接管理 API 后，保存操作才会持久化。</span></div>}
      <main id="main-content" ref={contentRef} tabIndex={-1}>
        {page === "dashboard" && <Dashboard flash={flash} go={go} />}
        {page === "content" && <DailyContent />}
        {page === "sources" && <Sources flash={flash} />}
        {page === "models" && <ModelSettings flash={flash} />}
        {page === "runs" && <Runs />}
        {page === "settings" && <Settings flash={flash} />}
      </main>
    </section>
    {notice && <div className="toast" role="status"><CheckCircle size={18} weight="fill"/>{notice}</div>}
  </div></>;
}

function Dashboard({ flash, go }: { flash: (message: string) => void; go: (page: Page) => void }) {
  const { data, error, reload } = useLoad(api.dashboard);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  if (!data) return <Loading error={error} retry={reload} />;
  const metrics = [["采集", data.counts.collected], ["保留", data.counts.kept], ["过滤", data.counts.dropped], ["合并", data.counts.merged]];
  const run = async () => {
    setRunning(true); setRunError("");
    try { await api.runTask("daily"); flash("完整流水线已进入任务队列"); }
    catch (e) { setRunError(e instanceof Error ? e.message : "任务启动失败"); }
    finally { setRunning(false); }
  };
  const publishing = publishCopy(data.briefStatus);
  const publishNeedsAttention = (["partial", "failed"] as PublishingStatus[]).includes(data.briefStatus);
  return <>
    <PageHead title="今日概况" description={`${data.date}，自动流程会完成采集、筛选、生成和网页发布。`}><ServiceBadge service={data.service}/><button className="button primary" disabled={running} onClick={run}><Play weight="fill"/>{running ? "正在启动…" : "立即运行一次"}</button></PageHead>
    {runError && <p className="action-error" role="alert">{runError} <button onClick={run}>重试</button></p>}
    <ServiceOverview service={data.service} go={go}/>
    <section className="metric-rail" data-animate>{metrics.map(([label, value], index) => <div key={label}><small>{label}</small><strong>{value}</strong><span>{index === 0 ? "今日原始条目" : "内容决策"}</span></div>)}</section>
    <div className="dashboard-grid">
      <section className="panel pipeline-panel" data-animate><header className="panel-head"><div><span className="section-code">PIPELINE</span><h2>本次运行</h2></div><Status value={data.briefStatus}/></header><div className="stage-list">{data.stages.length ? data.stages.map((stage, index) => <div className="stage" key={`${stage.name}-${index}`}><span className="stage-index">{String(index + 1).padStart(2, "0")}</span><Status value={stage.status}/><span><b>{stage.name}</b><small>{stage.message || "阶段执行正常"}</small></span><time>{stage.durationMs ? `${(stage.durationMs / 1000).toFixed(1)}s` : "等待"}</time></div>) : <div className="empty-row">当前没有运行中的阶段。</div>}</div></section>
      <aside className="panel publish-panel" data-animate><header className="panel-head"><div><span className="section-code">PUBLISHING</span><h2>网页发布</h2></div><Article size={20}/></header><div className="panel-body"><Status value={data.briefStatus}/><h3>{publishing.title}</h3><p>{publishing.body}</p><a className={`button ${data.briefStatus === "published" ? "primary" : "ghost"} full`} href="/" target="_blank" rel="noreferrer">{publishing.action}</a><button className="button ghost full" onClick={() => go(publishNeedsAttention ? "runs" : "content")}>{publishNeedsAttention ? "查看运行记录" : "查看今日内容"}</button></div></aside>
    </div>
  </>;
}

function serviceTime(value?: string) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function ServiceBadge({ service }: { service: DashboardData["service"] }) {
  return <span className={`service-badge service-tone-${service.status}`}><i/>{service.label}</span>;
}

function ServiceOverview({ service, go }: { service: DashboardData["service"]; go: (page: Page) => void }) {
  const components = [
    ["API", service.components.api],
    ["数据库", service.components.database],
    ["自动化", service.components.automation],
    ["定时任务", service.components.scheduler]
  ] as const;
  return <section className={`service-overview service-tone-${service.status}`} data-animate>
    <div className="service-summary"><span className="service-symbol"><Pulse weight="bold"/></span><div><span className="section-code">LIVE STATUS</span><h2>{service.label}</h2><p>{service.message}</p></div></div>
    <div className="service-facts">
      <div><small>最近检查</small><b>{serviceTime(service.checkedAt)}</b></div>
      <div><small>最近成功</small><b>{serviceTime(service.lastSuccessAt)}</b></div>
      <div><small>下次计划</small><b>{serviceTime(service.nextRunAt)}</b></div>
    </div>
    <footer><div className="service-components">{components.map(([label, ready]) => <span className={ready ? "ready" : "not-ready"} key={label}><i/>{label}</span>)}</div><button className="button ghost small" onClick={() => go("runs")}>查看运行记录</button></footer>
  </section>;
}

function DailyContent() {
  const { data, error, reload } = useLoad(api.contents);
  const [filter, setFilter] = useState<ContentDecision | "all">("all");
  const filtered = useMemo(() => data?.filter((item) => filter === "all" || item.decision === filter) || [], [data, filter]);
  if (!data) return <Loading error={error} retry={reload} />;
  return <>
    <PageHead title="每日内容" description="查看当天采集、分类与筛选结果。整个流程默认由 AI 自动完成。"><span className="muted-label">共 {data.length} 条</span></PageHead>
    <div className="filter-row" data-animate>{(["all", "pending", "keep", "drop", "merge"] as const).map((value) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{({ all: "全部", pending: "待处理", keep: "已保留", drop: "已过滤", merge: "已合并" })[value]}</button>)}<span>{filtered.length} 条内容</span></div>
    <section className="daily-content-list panel" data-animate>{filtered.length ? filtered.map((entry) => <article className="daily-content-row" key={entry.id}><header><span><b>{entry.author}</b><small>{entry.source}</small></span><Status value={entry.decision}/></header><p>{entry.content}</p><footer><span>{entry.category}</span><span>相关度 {entry.scores.relevance}/10</span>{entry.reason && <span>{entry.reason}</span>}{entry.url && <a href={entry.url} target="_blank" rel="noreferrer">查看来源 ↗</a>}</footer></article>) : <div className="empty-row">当前分类下没有内容。</div>}</section>
  </>;
}

function Sources({ flash: _flash }: { flash: (message: string) => void }) {
  const { data, error, reload } = useLoad(api.system);
  if (!data) return <Loading error={error} retry={reload}/>;
  return <><PageHead title="信息源" description="这里展示生产环境当前实际启用的采集入口。配置由服务器环境变量管理。"/>
    <section className="panel" data-animate><header className="panel-head"><div><span className="section-code">PRODUCTION SOURCES</span><h2>正在使用的信息源</h2></div><Status value={data.sources.every((source) => source.enabled) ? "succeeded" : "partial"}/></header><div className="source-list">{data.sources.map((source) => <div className="source-row source-row-live" key={source.id}><span className="source-icon">{source.id === "github-trending" ? <GithubLogo/> : <Database/>}</span><span><b>{source.name}</b><small>{source.url || "未配置 URL"}</small></span><span><small>类型</small><b>{source.kind}</b></span><span><small>状态</small><b>{source.enabled ? "已启用" : "未配置"}</b></span><Status value={source.enabled ? "succeeded" : "failed"}/></div>)}</div></section>
    <aside className="security-note sources-note" data-animate><Database/><div><b>来源配置不在浏览器内修改</b><p>Zara Feed 地址由 ZARA_X_FEED_URL、ZARA_PODCASTS_FEED_URL、ZARA_BLOGS_FEED_URL 提供；GitHub 每日读取全球 Trending 前 5。GitHub Token 当前{data.secrets.githubTokenConfigured ? "已配置" : "未配置，公共页面采集仍可运行"}。</p></div></aside>
  </>;
}

type ProviderDraft = { name: string; baseUrl: string; apiKey: string; enabled: boolean };

const emptyProviderDraft = (): ProviderDraft => ({
  name: "",
  baseUrl: "",
  apiKey: "",
  enabled: true
});

export const providerDraftFrom = (provider: Provider): ProviderDraft => ({
  name: provider.name,
  baseUrl: provider.baseUrl,
  apiKey: "",
  enabled: provider.enabled
});

function ModelSettings({ flash }: { flash: (message: string) => void }) {
  const { data, setData, error, reload } = useLoad(api.modelConfig);
  const [providerId, setProviderId] = useState<string>();
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>();
  const [newProvider, setNewProvider] = useState<ProviderDraft>();
  const [createdProvider, setCreatedProvider] = useState<Provider>();
  const [discovered, setDiscovered] = useState<DiscoveredModel[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [working, setWorking] = useState<string>();
  const [dialogError, setDialogError] = useState("");
  const [actionError, setActionError] = useState("");
  const [manualModel, setManualModel] = useState<{ providerId: string; modelId: string; displayName: string }>();
  if (!data) return <Loading error={error} retry={reload} />;

  const selected = data.providers.find((provider) => provider.id === providerId);
  const validNewProvider = Boolean(
    newProvider?.name.trim()
    && newProvider.baseUrl.trim()
    && newProvider.apiKey.trim()
  );
  const mergeImportedModels = (models: ModelConfig["models"], imported: ModelConfig["models"]) => {
    const importedKeys = new Set(imported.map((item) => `${item.providerId}:${item.modelId}`));
    return [...models.filter((item) => !importedKeys.has(`${item.providerId}:${item.modelId}`)), ...imported];
  };
  const save = async () => {
    setWorking("save-config"); setActionError("");
    try { setData(await api.saveModelConfig(data)); flash("模型配置已保存"); }
    catch (e) { setActionError(e instanceof Error ? e.message : "模型配置保存失败"); }
    finally { setWorking(undefined); }
  };
  const connectProvider = async (provider: Provider) => {
    setWorking(`test:${provider.id}`); setDialogError("");
    try {
      const result = await api.testProvider(provider.id);
      const models = await api.discoverModels(provider.id);
      const updated = { ...provider, health: "healthy" as const, modelCount: result.modelCount,
        checkedAt: result.checkedAt, connectionMessage: `连接正常，发现 ${models.length} 个模型` };
      setCreatedProvider(updated); setDiscovered(models); setSelectedModels(models.map((model) => model.modelId));
      setData((current) => current && ({ ...current, providers: current.providers.map((item) => item.id === updated.id ? updated : item) }));
      flash("Provider 连接成功");
    } catch (e) {
      const message = e instanceof Error ? e.message : "连接失败，请检查地址和 API Key";
      const failed = { ...provider, health: "error" as const, checkedAt: new Date().toISOString(), connectionMessage: message };
      setCreatedProvider(failed);
      setData((current) => current && ({ ...current, providers: current.providers.map((item) => item.id === failed.id ? failed : item) }));
      setDialogError(`Provider 已保存，但未能连接：${message}`);
    } finally { setWorking(undefined); }
  };
  const createProvider = async () => {
    if (!newProvider || !validNewProvider) return;
    setWorking("create-provider"); setDialogError("");
    try {
      const created = await api.createProvider({ ...newProvider, name: newProvider.name.trim(),
        baseUrl: newProvider.baseUrl.trim().replace(/\/$/, ""), apiKey: newProvider.apiKey.trim() });
      setData((current) => current && ({ ...current, providers: [...current.providers, created] }));
      setNewProvider(undefined); setCreatedProvider(created);
      setWorking(undefined);
      await connectProvider(created);
    } catch (e) { setDialogError(e instanceof Error ? e.message : "Provider 保存失败"); setWorking(undefined); }
  };

  const importSelected = async () => {
    if (!createdProvider) return;
    setWorking("import-models"); setDialogError("");
    try {
      const imported = await api.importModels(createdProvider.id, discovered.filter((item) => selectedModels.includes(item.modelId)));
      setData((current) => current && ({ ...current, models: mergeImportedModels(current.models, imported),
        providers: current.providers.map((item) => item.id === createdProvider.id ? { ...item, modelCount: Math.max(item.modelCount, imported.length), health: "healthy" } : item) }));
      setCreatedProvider(undefined); flash("模型已导入");
    } catch (e) { setDialogError(e instanceof Error ? e.message : "模型导入失败"); }
    finally { setWorking(undefined); }
  };

  const addManualModel = async () => {
    if (!manualModel?.providerId || !manualModel.modelId.trim()) return;
    setWorking("add-model"); setDialogError("");
    try {
      const imported = await api.importModels(manualModel.providerId, [{ modelId: manualModel.modelId.trim(), displayName: manualModel.displayName.trim() || manualModel.modelId.trim() }]);
      setData((current) => current && ({ ...current, models: mergeImportedModels(current.models, imported) }));
      setManualModel(undefined); flash("模型已添加");
    } catch (e) { setDialogError(e instanceof Error ? e.message : "模型添加失败"); }
    finally { setWorking(undefined); }
  };
  const toggleModel = async (modelId: string) => {
    const next = { ...data, models: data.models.map((item) => item.id === modelId ? { ...item, enabled: !item.enabled } : item) };
    setWorking(`model:${modelId}`); setActionError("");
    try { setData(await api.saveModelConfig(next)); flash("模型状态已保存"); }
    catch (e) { setActionError(e instanceof Error ? e.message : "模型状态保存失败"); }
    finally { setWorking(undefined); }
  };
  const removeModel = async (modelId: string) => {
    const model = data.models.find((item) => item.id === modelId);
    const route = data.routes.find((item) => item.primaryModelId === modelId || item.fallbackModelId === modelId);
    if (route) { setActionError(`无法移除 ${model?.displayName || "该模型"}：它仍用于 ${route.label}。请先重新分配路由并保存。`); return; }
    if (!window.confirm(`确定移除模型“${model?.displayName || modelId}”吗？`)) return;
    setWorking(`delete:${modelId}`); setActionError("");
    try { await api.deleteModel(modelId); setData({ ...data, models: data.models.filter((item) => item.id !== modelId) }); flash("模型已移除"); }
    catch (e) { setActionError(e instanceof Error ? e.message : "模型移除失败"); }
    finally { setWorking(undefined); }
  };
  const openProvider = (provider: Provider) => { setProviderId(provider.id); setProviderDraft(providerDraftFrom(provider)); setDialogError(""); };
  const closeProvider = () => { setProviderId(undefined); setProviderDraft(undefined); setDialogError(""); };
  const deleteSelectedProvider = async () => {
    if (!selected) return;
    const providerModelIds = new Set(data.models.filter((model) => model.providerId === selected.id).map((model) => model.id));
    const primaryRoute = data.routes.find((route) => providerModelIds.has(route.primaryModelId));
    if (primaryRoute) {
      setDialogError(`无法删除 ${selected.name}：它的模型仍是 ${primaryRoute.label} 的主模型。请先重新分配路由并保存。`);
      return;
    }
    const modelCount = providerModelIds.size;
    if (!window.confirm(`确定删除 Provider“${selected.name}”吗？${modelCount ? `其下 ${modelCount} 个模型也会一并删除。` : ""} 此操作无法撤销。`)) return;
    setWorking(`delete-provider:${selected.id}`); setDialogError("");
    try {
      await api.deleteProvider(selected.id);
      setData({
        ...data,
        providers: data.providers.filter((provider) => provider.id !== selected.id),
        models: data.models.filter((model) => model.providerId !== selected.id),
        routes: data.routes.map((route) => providerModelIds.has(route.fallbackModelId || "")
          ? { ...route, fallbackModelId: undefined }
          : route),
      });
      closeProvider(); flash("Provider 已删除");
    } catch (e) { setDialogError(e instanceof Error ? e.message : "Provider 删除失败"); }
    finally { setWorking(undefined); }
  };
  const saveProvider = async () => {
    if (!selected || !providerDraft) return;
    setWorking(`provider:${selected.id}`); setDialogError("");
    try {
      const updated = await api.updateProvider({ ...selected, name: providerDraft.name.trim(), baseUrl: providerDraft.baseUrl.trim().replace(/\/$/, ""), enabled: providerDraft.enabled }, providerDraft.apiKey.trim() || undefined);
      setData({ ...data, providers: data.providers.map((item) => item.id === updated.id ? updated : item) });
      closeProvider(); flash("Provider 已更新");
    } catch (e) { setDialogError(e instanceof Error ? e.message : "Provider 更新失败"); }
    finally { setWorking(undefined); }
  };
  const testSelectedProvider = async () => {
    if (!selected) return;
    setWorking(`test:${selected.id}`); setDialogError("");
    try {
      const result = await api.testProvider(selected.id);
      const updated = { ...selected, health: "healthy" as const, modelCount: result.modelCount,
        checkedAt: result.checkedAt, connectionMessage: `连接正常，发现 ${result.modelCount} 个模型` };
      setData({ ...data, providers: data.providers.map((item) => item.id === updated.id ? updated : item) }); flash("连接测试完成");
    } catch (e) {
      const message = e instanceof Error ? e.message : "连接测试失败";
      setData({ ...data, providers: data.providers.map((item) => item.id === selected.id ? { ...item, health: "error", checkedAt: new Date().toISOString(), connectionMessage: message } : item) });
      setDialogError(message);
    } finally { setWorking(undefined); }
  };

  return <>
    <PageHead title="模型与 API" description="添加兼容接口、导入可用模型，并指定每天生成晨报时使用的主模型与备用模型。"><button className="button primary" disabled={Boolean(working)} onClick={save}>{working === "save-config" ? "正在保存…" : "保存模型设置"}</button></PageHead>
    {actionError && <p className="action-error" role="alert">{actionError}</p>}
    <aside className="security-note" data-animate><Key/><div><b>API Key 加密保存</b><p>密钥提交后不会再次显示，也不会出现在普通接口、日志或前端代码中。后台只显示是否已经配置。</p></div></aside>
    <div className="model-settings-stack">
      <section className="panel" data-animate><header className="panel-head"><div><span className="section-code">PROVIDERS</span><h2>API 提供商</h2></div><button className="button ghost small" disabled={Boolean(working)} onClick={() => { setDialogError(""); setNewProvider(emptyProviderDraft()); }}><Plus/>添加提供商</button></header><div className="provider-table">{data.providers.length ? data.providers.map((provider) => <button key={provider.id} onClick={() => openProvider(provider)}><Status value={provider.health}/><span><b>{provider.name}</b><small>{provider.baseUrl}</small></span><span><b>{provider.keyConfigured ? "密钥已配置" : "缺少密钥"}</b><small>{provider.modelCount} 个模型{provider.checkedAt ? ` · ${serviceTime(provider.checkedAt)}` : ""}</small></span><span>{provider.enabled ? "已启用" : "已停用"}</span><span>管理 →</span></button>) : <p className="empty-row">还没有 Provider。请先添加一个兼容接口。</p>}</div></section>
      <section className="panel" data-animate><header className="panel-head"><div><span className="section-code">MODELS</span><h2>已添加模型</h2></div><button className="button ghost small" disabled={!data.providers.length || Boolean(working)} onClick={() => { setDialogError(""); setManualModel({ providerId: data.providers[0]?.id || "", modelId: "", displayName: "" }); }}><Plus/>手动添加</button></header><div className="model-list">{data.models.length ? data.models.map((model) => <article key={model.id}><small>{data.providers.find((provider) => provider.id === model.providerId)?.name}</small><h3>{model.displayName}</h3><code>{model.modelId}</code><footer><button disabled={Boolean(working)} onClick={() => void toggleModel(model.id)}>{working === `model:${model.id}` ? "保存中…" : model.enabled ? "停用" : "启用"}</button><button disabled={Boolean(working)} onClick={() => void removeModel(model.id)}>{working === `delete:${model.id}` ? "移除中…" : "移除"}</button></footer></article>) : <p className="empty-row">还没有模型。添加 Provider 后可自动获取，或手动输入模型 ID。</p>}</div></section>
      <section className="panel" data-animate><header className="panel-head"><div><span className="section-code">DAILY BRIEF</span><h2>晨报使用模型</h2></div></header><div className="route-table"><div className="route-header"><span>用途</span><span>主模型</span><span>备用模型</span></div>{[data.routes.find((route) => route.task === "daily-overview") || { task: "daily-overview", label: "每日晨报", primaryModelId: data.models[0]?.id || "", fallbackModelId: undefined }].map((route) => <div className="route-row" key={route.task}><b>采集后的筛选、总结与成稿</b><select value={route.primaryModelId} onChange={(event) => setData({ ...data, routes: [{ ...route, primaryModelId: event.target.value }] })}><option value="">请选择主模型</option>{data.models.filter((model) => model.enabled).map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select><select value={route.fallbackModelId || ""} onChange={(event) => setData({ ...data, routes: [{ ...route, fallbackModelId: event.target.value || undefined }] })}><option value="">无备用</option>{data.models.filter((model) => model.enabled && model.id !== route.primaryModelId).map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select></div>)}</div></section>
    </div>

    {newProvider && <Dialog titleId="new-provider-title" busy={working === "create-provider"} onClose={() => { setNewProvider(undefined); setDialogError(""); }} onSubmit={createProvider}><header><div><span className="section-code">CONNECT PROVIDER</span><h2 id="new-provider-title">添加 API 提供商</h2></div><button type="button" className="icon-action" disabled={Boolean(working)} onClick={() => setNewProvider(undefined)} aria-label="关闭"><X/></button></header><p className="dialog-intro">输入 OpenAI-compatible 接口信息。保存后会立即测试连接，并读取该接口提供的模型。</p><label className="field"><span>名称</span><input autoFocus required placeholder="例如：主要模型接口" value={newProvider.name} onChange={(event) => setNewProvider({ ...newProvider, name: event.target.value })}/></label><label className="field"><span>Base URL</span><input required type="url" placeholder="https://api.example.com/v1" value={newProvider.baseUrl} onChange={(event) => setNewProvider({ ...newProvider, baseUrl: event.target.value })}/></label><label className="field"><span>API Key</span><input required type="password" autoComplete="new-password" placeholder="输入后将加密保存" value={newProvider.apiKey} onChange={(event) => setNewProvider({ ...newProvider, apiKey: event.target.value })}/><small>提交后不再显示。如需更换，可在 Provider 管理中输入新密钥覆盖。</small></label>{dialogError && <p className="form-error" role="alert">{dialogError}</p>}<div className="setting-toggle dialog-toggle"><span><b>添加后立即启用</b><small>启用后可用于晨报生成</small></span><Toggle checked={newProvider.enabled} onChange={(enabled) => setNewProvider({ ...newProvider, enabled })} label="添加后立即启用"/></div><div className="sheet-actions"><button type="button" className="button ghost" disabled={Boolean(working)} onClick={() => setNewProvider(undefined)}>取消</button><button type="submit" className="button primary" disabled={!validNewProvider || Boolean(working)}>{working === "create-provider" ? "正在保存…" : "保存并测试连接"}</button></div></Dialog>}
    {createdProvider && <Dialog titleId="import-models-title" className="model-import-dialog" busy={Boolean(working)} onClose={() => { setCreatedProvider(undefined); setDialogError(""); }} onSubmit={importSelected}><header><div><span className="section-code">IMPORT MODELS</span><h2 id="import-models-title">{createdProvider.health === "healthy" ? "选择要使用的模型" : "Provider 已保存"}</h2></div><button type="button" className="icon-action" disabled={Boolean(working)} onClick={() => setCreatedProvider(undefined)} aria-label="关闭"><X/></button></header>{createdProvider.health === "healthy" ? <><p className="dialog-intro">已连接 {createdProvider.name}，发现 {discovered.length} 个模型。选择后导入到 Morning Brief。</p><div className="discovered-models">{discovered.length ? discovered.map((model) => <label key={model.modelId}><input type="checkbox" checked={selectedModels.includes(model.modelId)} onChange={(event) => setSelectedModels(event.target.checked ? [...selectedModels, model.modelId] : selectedModels.filter((id) => id !== model.modelId))}/><span><b>{model.displayName}</b><code>{model.modelId}</code></span></label>) : <p className="empty-row">接口没有返回可导入的模型，可稍后手动添加。</p>}</div></> : <p className="dialog-intro">{createdProvider.name} 已安全保存，但连接尚未成功。修正 Provider 信息后可再次测试。</p>}{dialogError && <p className="form-error" role="alert">{dialogError}</p>}<div className="sheet-actions"><button type="button" className="button ghost" disabled={Boolean(working)} onClick={() => setCreatedProvider(undefined)}>稍后处理</button>{createdProvider.health === "healthy" ? <button type="submit" className="button primary" disabled={!selectedModels.length || Boolean(working)}><CloudArrowDown/>{working === "import-models" ? "正在导入…" : `导入 ${selectedModels.length} 个模型`}</button> : <button type="button" className="button primary" disabled={Boolean(working)} onClick={() => void connectProvider(createdProvider)}>{working?.startsWith("test:") ? "正在重试…" : "重试连接"}</button>}</div></Dialog>}
    {manualModel && <Dialog titleId="manual-model-title" busy={working === "add-model"} onClose={() => { setManualModel(undefined); setDialogError(""); }} onSubmit={addManualModel}><header><div><span className="section-code">MANUAL MODEL</span><h2 id="manual-model-title">手动添加模型</h2></div><button type="button" className="icon-action" disabled={Boolean(working)} onClick={() => setManualModel(undefined)} aria-label="关闭"><X/></button></header><p className="dialog-intro">当接口不支持读取模型列表时，可以按服务商文档填写准确的模型 ID。</p><label className="field"><span>API 提供商</span><select required value={manualModel.providerId} onChange={(event) => setManualModel({ ...manualModel, providerId: event.target.value })}>{data.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label><label className="field"><span>模型 ID</span><input autoFocus required placeholder="例如：model-name" value={manualModel.modelId} onChange={(event) => setManualModel({ ...manualModel, modelId: event.target.value })}/></label><label className="field"><span>显示名称（可选）</span><input placeholder="默认使用模型 ID" value={manualModel.displayName} onChange={(event) => setManualModel({ ...manualModel, displayName: event.target.value })}/></label>{dialogError && <p className="form-error" role="alert">{dialogError}</p>}<div className="sheet-actions"><button type="button" className="button ghost" disabled={Boolean(working)} onClick={() => setManualModel(undefined)}>取消</button><button type="submit" className="button primary" disabled={!manualModel.providerId || !manualModel.modelId.trim() || Boolean(working)}>{working === "add-model" ? "正在添加…" : "添加模型"}</button></div></Dialog>}
    {selected && providerDraft && <Dialog titleId="provider-title" side busy={Boolean(working)} onClose={closeProvider} onSubmit={saveProvider}><header><div><span className="section-code">PROVIDER</span><h2 id="provider-title">管理 {selected.name}</h2></div><button type="button" className="icon-action" disabled={Boolean(working)} onClick={closeProvider} aria-label="关闭"><X/></button></header><div className="provider-security-state"><Key/><span><b>{selected.keyConfigured ? "API Key 已配置" : "API Key 未配置"}</b><small>密钥内容不会显示</small></span></div><label className="field"><span>名称</span><input autoFocus required value={providerDraft.name} onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })}/></label><label className="field"><span>Base URL</span><input required type="url" value={providerDraft.baseUrl} onChange={(event) => setProviderDraft({ ...providerDraft, baseUrl: event.target.value })}/></label><label className="field"><span>更换 API Key（可选）</span><input type="password" autoComplete="new-password" placeholder="留空则保持现有密钥" value={providerDraft.apiKey} onChange={(event) => setProviderDraft({ ...providerDraft, apiKey: event.target.value })}/></label><div className="test-block"><span><b>连接状态</b><small>{selected.connectionMessage || "尚未测试"}{selected.checkedAt ? ` · ${serviceTime(selected.checkedAt)}` : ""}</small></span><button type="button" className="button ghost small" disabled={Boolean(working)} onClick={() => void testSelectedProvider()}><Pulse/>{working === `test:${selected.id}` ? "测试中…" : "测试连接"}</button></div>{dialogError && <p className="form-error" role="alert">{dialogError}</p>}<div className="setting-toggle"><span><b>启用 Provider</b><small>停用后不会用于晨报生成</small></span><Toggle checked={providerDraft.enabled} onChange={(enabled) => setProviderDraft({ ...providerDraft, enabled })} label="启用 Provider"/></div><div className="sheet-actions"><button type="button" className="button danger" disabled={Boolean(working)} onClick={() => void deleteSelectedProvider()}>{working === `delete-provider:${selected.id}` ? "正在删除…" : "删除 Provider"}</button><button type="button" className="button ghost" disabled={Boolean(working)} onClick={closeProvider}>取消</button><button type="submit" className="button primary" disabled={!providerDraft.name.trim() || !providerDraft.baseUrl.trim() || Boolean(working)}>{working === `provider:${selected.id}` ? "正在保存…" : "保存更改"}</button></div></Dialog>}
  </>;
}

function Runs() {
  const { data, error, reload } = useLoad(api.runs);
  const [expanded, setExpanded] = useState<string>();
  const [filter, setFilter] = useState<RunFilter>("all");
  if (!data) return <Loading error={error} retry={reload} />;
  const filtered = filterRuns(data, filter);
  return <><PageHead title="运行记录" description="先看可读摘要，需要时再展开阶段与技术信息。"><label className="run-filter"><SlidersHorizontal/><span>筛选运行</span><select value={filter} onChange={(event) => setFilter(event.target.value as RunFilter)}><option value="all">全部</option><option value="running">进行中</option><option value="succeeded">完成</option><option value="partial">部分完成</option><option value="failed">失败</option><option value="manual">手动触发</option><option value="schedule">定时触发</option></select></label></PageHead><section className="runs panel" data-animate>{filtered.length ? filtered.map((run: Run) => <article key={run.id}><button className="run-summary" onClick={() => setExpanded(expanded === run.id ? undefined : run.id)} aria-expanded={expanded === run.id}><Status value={run.status}/><span><b>{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(run.startedAt))}</b><small>{run.summary}</small></span><code>{run.id}</code><time>{run.durationMs !== undefined ? `${(run.durationMs / 1000).toFixed(1)} 秒` : run.status === "running" ? "运行中" : "暂无耗时"}</time><CaretDown className={expanded === run.id ? "rotated" : ""}/></button>{expanded === run.id && <div className="run-detail">{run.stages.length ? run.stages.map((stage, index) => <div key={`${stage.name}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><Status value={stage.status}/><div><b>{stage.name}</b><small>{stage.message || "无额外信息"}</small></div></div>) : <p>该运行没有可展示的阶段明细。</p>}</div>}</article>) : <p className="empty-row">当前筛选条件下没有运行记录。</p>}</section></>;
}

function BooleanState({ value }: { value: boolean }) {
  return <Status value={value ? "succeeded" : "failed"}/>;
}

function Settings({ flash: _flash }: { flash: (message: string) => void }) {
  const { data, error, reload } = useLoad(api.system);
  if (!data) return <Loading error={error} retry={reload}/>;
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
  return <button type="button" className="toggle" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span/></button>;
}

export default App;
