export type ContentDecision = "pending" | "keep" | "drop" | "merge";
export type RunStatus = "running" | "succeeded" | "failed" | "partial";

export interface DashboardData {
  date: string;
  briefStatus: "draft" | "published" | "partial";
  deliveryStatus: "not_sent" | "sent" | "failed";
  counts: { collected: number; kept: number; dropped: number; merged: number; published: number };
  stages: Array<{ name: string; status: RunStatus; durationMs?: number; message?: string }>;
}

export interface ContentItem {
  id: string;
  author: string;
  source: string;
  content: string;
  url?: string;
  category: string;
  decision: ContentDecision;
  scores: { relevance: number; importance: number; novelty: number; actionability: number };
  reason: string;
}

export interface Provider {
  id: string;
  name: string;
  protocol: "openai-compatible";
  baseUrl: string;
  envSecretRef: string;
  enabled: boolean;
  health: "healthy" | "unknown" | "error";
}

export interface Model {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
  structuredOutput: boolean;
}

export interface TaskRoute {
  task: string;
  label: string;
  primaryModelId: string;
  fallbackModelId?: string;
}

export interface ModelConfig {
  providers: Provider[];
  models: Model[];
  routes: TaskRoute[];
  paused: boolean;
}

export interface Run {
  id: string;
  startedAt: string;
  durationMs?: number;
  status: RunStatus;
  trigger: "manual" | "schedule";
  summary: string;
  stages: Array<{ name: string; status: RunStatus; message?: string }>;
}

export interface BriefDraft {
  date: string;
  title: string;
  deck: string;
  status: "draft" | "published" | "partial";
  highlights: Array<{ title: string; summary: string }>;
}

export interface SystemStatus {
  environment: "production" | "development";
  timeZone: string;
  publicUrl: string;
  automation: {
    enabled: boolean;
    pauseOnSevereError: boolean;
  };
  schedule: {
    installed: boolean;
    collectionTime: string | null;
    deliveryTime: string | null;
    maxItems: number;
  };
  delivery: {
    webPublishing: boolean;
  };
  secrets: {
    githubTokenConfigured: boolean;
    llmKeyConfigured: boolean;
  };
  sources: Array<{
    id: string;
    name: string;
    kind: string;
    url: string;
    enabled: boolean;
  }>;
}
