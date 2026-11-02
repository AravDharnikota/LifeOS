import Anthropic from "@anthropic-ai/sdk";
import { FoodAnalysis } from "@aravos/shared";
import type { AgentTurnRequest, AgentTurnResult, AiProvider, BodyComparisonRequest, BodyComparisonResult, DurationEstimateRequest, FoodAnalysisRequest } from "./provider.ts";
import { FOOD_SYSTEM_PROMPT, foodUserContent, BODY_SYSTEM_PROMPT, bodyUserContent, DURATION_SYSTEM_PROMPT, durationUserContent } from "./prompts.ts";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Real provider backed by the Anthropic SDK.
 * - Structured outputs via output_config.format for vision analyses.
 * - Tool loop for the in-app agent, implemented manually so the HTTP layer can stream text and tool events.
 */
export class AnthropicProvider implements AiProvider {
  enabled = true;
  constructor(
    private client: Anthropic,
    public model: string,
    public visionModel: string,
  ) {}

  private fallbackParams(): Record<string, unknown> {
    // Server-side fallback routes safety declines to another model automatically (Claude API only).
    return { betas: [FALLBACK_BETA], fallbacks: "default" };
  }

  async analyzeFood(req: FoodAnalysisRequest): Promise<FoodAnalysis> {
    const res = await this.client.beta.messages.create({
      model: this.visionModel,
      max_tokens: 4000,
      system: FOOD_SYSTEM_PROMPT,
      messages: [{ role: "user", content: foodUserContent(req) }],
      output_config: { format: { type: "json_schema", schema: FOOD_JSON_SCHEMA } },
      ...this.fallbackParams(),
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "";
    if (res.stop_reason === "refusal") throw new Error("The model declined to analyze this image.");
    return FoodAnalysis.parse(JSON.parse(text));
  }

  async compareBodyPhotos(req: BodyComparisonRequest): Promise<BodyComparisonResult> {
    const res = await this.client.beta.messages.create({
      model: this.visionModel,
      max_tokens: 2000,
      system: BODY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: bodyUserContent(req) }],
      output_config: { format: { type: "json_schema", schema: BODY_JSON_SCHEMA } },
      ...this.fallbackParams(),
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (res.stop_reason === "refusal") throw new Error("The model declined to analyze these photos.");
    const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "{}";
    const j = JSON.parse(text) as BodyComparisonResult;
    return { summary: String(j.summary ?? ""), observations: Array.isArray(j.observations) ? j.observations.map(String) : [], progressScore: typeof j.progressScore === "number" ? Math.max(-2, Math.min(2, Math.round(j.progressScore))) : null };
  }

  async estimateDurations(req: DurationEstimateRequest): Promise<Record<string, number>> {
    if (req.tasks.length === 0) return {};
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 2000,
      system: DURATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: durationUserContent(req) }],
      output_config: { format: { type: "json_schema", schema: DURATION_JSON_SCHEMA }, effort: "low" },
      ...this.fallbackParams(),
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "{}";
    const j = JSON.parse(text) as { estimates: { id: string; minutes: number }[] };
    const out: Record<string, number> = {};
    for (const e of j.estimates ?? []) if (typeof e.minutes === "number" && e.minutes > 0) out[e.id] = Math.round(e.minutes);
    return out;
  }

  async runAgentTurn(req: AgentTurnRequest): Promise<AgentTurnResult> {
    const tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Beta.BetaTool["input_schema"] }));
    const byName = new Map(req.tools.map((t) => [t.name, t]));
    const messages: Anthropic.Beta.BetaMessageParam[] = [...req.messages];
    const newMessages: Anthropic.Beta.BetaMessageParam[] = [];
    const toolCalls: AgentTurnResult["toolCalls"] = [];
    let text = "";
    let lastContent: Anthropic.Beta.BetaContentBlock[] = [];
    let stopReason: string | null = null;
    const maxIter = req.maxIterations ?? 12;
    for (let i = 0; i < maxIter; i++) {
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: 16000,
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages,
        tools,
        output_config: { effort: "medium" },
        ...this.fallbackParams(),
      } as Anthropic.Beta.MessageCreateParamsStreaming);
      stream.on("text", (delta) => {
        text += delta;
        req.onText?.(delta);
      });
      const msg = await stream.finalMessage();
      lastContent = msg.content;
      stopReason = msg.stop_reason;
      const assistantTurn: Anthropic.Beta.BetaMessageParam = { role: "assistant", content: msg.content };
      messages.push(assistantTurn);
      newMessages.push(assistantTurn);
      if (msg.stop_reason === "pause_turn") continue;
      const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (msg.stop_reason !== "tool_use" || uses.length === 0) break;
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        req.onToolCall?.({ name: u.name, input: u.input });
        const tool = byName.get(u.name);
        let result = "";
        let ok = true;
        try {
          if (!tool) throw new Error(`Unknown tool ${u.name}`);
          result = await tool.run(u.input);
        } catch (e) {
          ok = false;
          result = e instanceof Error ? e.message : String(e);
        }
        toolCalls.push({ name: u.name, input: u.input, result, ok });
        req.onToolResult?.({ name: u.name, input: u.input, result, ok });
        results.push({ type: "tool_result", tool_use_id: u.id, content: result.slice(0, 20000), is_error: !ok });
      }
      const userTurn: Anthropic.Beta.BetaMessageParam = { role: "user", content: results };
      messages.push(userTurn);
      newMessages.push(userTurn);
      text += text && !text.endsWith("\n") ? "\n" : "";
    }
    return { text: text.trim(), content: lastContent, newMessages, toolCalls, stopReason };
  }
}

export const FOOD_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["mealName", "items", "totals", "healthScore", "notes", "mealType"],
  properties: {
    mealName: { type: "string" },
    mealType: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "portion", "grams", "calories", "proteinG", "carbsG", "fatG", "fiberG", "sugarG", "sodiumMg", "saturatedFatG", "confidence"],
        properties: {
          name: { type: "string" },
          portion: { type: "string" },
          grams: { type: "number" },
          calories: { type: "number" },
          proteinG: { type: "number" },
          carbsG: { type: "number" },
          fatG: { type: "number" },
          fiberG: { type: ["number", "null"] },
          sugarG: { type: ["number", "null"] },
          sodiumMg: { type: ["number", "null"] },
          saturatedFatG: { type: ["number", "null"] },
          confidence: { type: "number" },
        },
      },
    },
    totals: { type: "object", additionalProperties: false, required: ["calories", "proteinG", "carbsG", "fatG"], properties: { calories: { type: "number" }, proteinG: { type: "number" }, carbsG: { type: "number" }, fatG: { type: "number" } } },
    healthScore: { type: "integer" },
    notes: { type: "string" },
  },
} as const;

export const BODY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "observations", "progressScore"],
  properties: { summary: { type: "string" }, observations: { type: "array", items: { type: "string" } }, progressScore: { type: ["integer", "null"] } },
} as const;

export const DURATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["estimates"],
  properties: { estimates: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "minutes"], properties: { id: { type: "string" }, minutes: { type: "integer" } } } } },
} as const;
