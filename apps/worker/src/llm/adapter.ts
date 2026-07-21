import { z } from "zod";

export interface StructuredLlm {
  generate<T>(
    prompt: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    options?: { system?: string; temperature?: number },
  ): Promise<T>;
}

export class LlmHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfterMs?: number,
  ) {
    super(`LLM request failed: HTTP ${status}`);
    this.name = "LlmHttpError";
  }
}

const contentPartSchema = z.object({
  type: z.string().optional(),
  text: z.string().optional(),
}).passthrough();

const chatCompletionSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.union([z.string(), z.array(contentPartSchema), z.null()]).optional(),
        reasoning_content: z.string().optional(),
      }).passthrough(),
    }),
  ).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}

function extractContent(message: z.infer<typeof chatCompletionSchema>["choices"][number]["message"]): string {
  if (typeof message.content === "string" && message.content.trim()) return message.content;
  if (Array.isArray(message.content)) {
    const text = message.content
      .map((part) => part.text)
      .filter((part): part is string => typeof part === "string")
      .join("");
    if (text.trim()) return text;
  }
  // Some OpenAI-compatible gateways return the final structured result only
  // in reasoning_content. Accept it when the standard content field is empty.
  if (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
    return message.reasoning_content;
  }
  throw new Error("LLM returned an empty response");
}

function stripJsonFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

export class OpenAiCompatibleLlm implements StructuredLlm {
  constructor(
    private readonly config: {
      baseUrl: string;
      apiKey: string;
      model: string;
      fetcher?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  async generate<T>(
    prompt: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    options?: { system?: string; temperature?: number },
  ): Promise<T> {
    const response = await (this.config.fetcher ?? fetch)(
      `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: options?.temperature ?? 0.2,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                options?.system ??
                "Return only valid JSON that satisfies the requested structure.",
            },
            { role: "user", content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
      },
    );
    if (!response.ok) {
      throw new LlmHttpError(
        response.status,
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }
    const completion = chatCompletionSchema.parse(await response.json());
    const content = extractContent(completion.choices[0]!.message);
    return schema.parse(JSON.parse(stripJsonFence(content)));
  }
}
