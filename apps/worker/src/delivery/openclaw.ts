import type { DailyBrief } from "../schemas.js";
import type { DeliveryAdapter, DeliveryResult } from "./adapter.js";

export function formatWechatBrief(brief: DailyBrief, publicUrl: string) {
  const highlights = brief.highlights.slice(0, 3).map((item, index) =>
    `${index + 1}. ${item.title}\n${item.summary}`,
  ).join("\n\n");
  return [
    `Morning Brief | ${brief.date}`,
    "",
    "今日关键信息",
    "",
    highlights || "今天没有达到入选标准的关键信息。",
    "",
    `查看完整晨报：${publicUrl.replace(/\/$/, "")}/brief/${brief.date}/`,
  ].join("\n");
}

export class OpenClawWebhookDeliveryAdapter implements DeliveryAdapter {
  readonly channel = "wechat";

  constructor(private readonly config: {
    url: string;
    token: string;
    channel: string;
    to?: string;
    publicUrl: string;
    hasDelivered: (key: string) => Promise<boolean>;
  }) {}

  hasDelivered(idempotencyKey: string) {
    return this.config.hasDelivered(idempotencyKey);
  }

  async deliver(
    brief: DailyBrief,
    options: { idempotencyKey: string },
  ): Promise<DeliveryResult> {
    if (await this.hasDelivered(options.idempotencyKey)) {
      return { channel: this.channel, idempotencyKey: options.idempotencyKey, status: "skipped" };
    }
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: [
          "请将下面的晨报内容原样发送，不要重新总结或添加说明。",
          "",
          formatWechatBrief(brief, this.config.publicUrl),
        ].join("\n"),
        name: "Morning Brief",
        wakeMode: "now",
        deliver: true,
        channel: this.config.channel,
        ...(this.config.to ? { to: this.config.to } : {}),
        timeoutSeconds: 120,
      }),
      signal: AbortSignal.timeout(130_000),
    });
    if (!response.ok) {
      throw new Error(`OpenClaw delivery failed: HTTP ${response.status}`);
    }
    return { channel: this.channel, idempotencyKey: options.idempotencyKey, status: "sent" };
  }
}
