import { z } from "zod";

export interface StructuredLlm {
  generate<T>(
    prompt: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    options?: { system?: string; temperature?: number },
  ): Promise<T>;
}

const chatCompletionSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string(),
      }),
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
      throw new Error(`LLM request failed: HTTP ${response.status}`);
    }
    const completion = chatCompletionSchema.parse(await response.json());
    const content = completion.choices[0]?.message.content;
    if (!content) throw new Error("LLM returned an empty response");
    return schema.parse(JSON.parse(stripJsonFence(content)));
  }
}
