import type { DailyBrief } from "../schemas.js";

export interface DeliveryResult {
  channel: string;
  idempotencyKey: string;
  status: "sent" | "skipped";
  externalId?: string;
}

export interface DeliveryAdapter {
  readonly channel: string;
  hasDelivered(idempotencyKey: string): Promise<boolean>;
  deliver(
    brief: DailyBrief,
    options: { idempotencyKey: string },
  ): Promise<DeliveryResult>;
}

export function createDeliveryIdempotencyKey(
  brief: DailyBrief,
  channel: string,
): string {
  return `${channel}:${brief.date}:${brief.generatedAt}`;
}
