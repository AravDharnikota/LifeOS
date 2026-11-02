import Anthropic from "@anthropic-ai/sdk";
import type { FoodAnalysis } from "@aravos/shared";
import type { Env } from "../lib/env.ts";

export interface ImageInput {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

export interface FoodAnalysisRequest {
  image?: ImageInput;
  text?: string;
  /** user corrections to a previous analysis, e.g. "that's 2 eggs not 3" */
  correction?: { previous: FoodAnalysis; note: string };
  localTime: string; // e.g. "08:15" used to guess meal type
}

export interface BodyComparisonRequest {
  current: ImageInput & { date: string; weightKg?: number | null };
  previous?: (ImageInput & { date: string; weightKg?: number | null }) | null;
  goal?: string | null;
}
export interface BodyComparisonResult {
  summary: string;
  observations: string[];
  progressScore: number | null; // -2..2
}

export interface DurationEstimateRequest {
  tasks: { id: string; title: string; notes?: string | null; tags?: string[] }[];
  history: { title: string; estimateMinutes: number | null; actualMinutes: number }[];
}

/** Tool definitions in the raw Anthropic shape used by the in-app agent and the scheduler. */
export interface AgentTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run: (input: unknown) => Promise<string>;
}

export interface AgentTurnRequest {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: AgentTool[];
  maxIterations?: number;
  onText?: (delta: string) => void;
  onToolCall?: (call: { name: string; input: unknown }) => void;
  onToolResult?: (res: { name: string; input: unknown; result: string; ok: boolean }) => void;
}

export interface AgentTurnResult {
  text: string;
  content: Anthropic.Beta.BetaContentBlock[];
  /** all assistant/user turns appended during the loop (for persistence) */
  newMessages: Anthropic.Beta.BetaMessageParam[];
  toolCalls: { name: string; input: unknown; result: string; ok: boolean }[];
  stopReason: string | null;
}

export interface AiProvider {
  enabled: boolean;
  model: string;
  visionModel: string;
  analyzeFood(req: FoodAnalysisRequest): Promise<FoodAnalysis>;
  compareBodyPhotos(req: BodyComparisonRequest): Promise<BodyComparisonResult>;
  estimateDurations(req: DurationEstimateRequest): Promise<Record<string, number>>;
  runAgentTurn(req: AgentTurnRequest): Promise<AgentTurnResult>;
}

export class AiDisabledError extends Error {
  status = 503;
  constructor() {
    super("AI features are disabled. Set ANTHROPIC_API_KEY on the server to enable them.");
  }
}

export function createAiProvider(env: Env): AiProvider {
  if (!env.anthropicApiKey) return disabledProvider(env);
  // Lazy import keeps startup fast and lets tests inject mocks.
  const client = new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 2, timeout: 10 * 60 * 1000 });
  // Implemented in ./anthropic.ts
  const { AnthropicProvider } = require_anthropic();
  return new AnthropicProvider(client, env.model, env.visionModel);
}

// Resolved at runtime to avoid a circular import at module-evaluation time.
import { AnthropicProvider as _AnthropicProvider } from "./anthropic.ts";
function require_anthropic(): { AnthropicProvider: typeof _AnthropicProvider } {
  return { AnthropicProvider: _AnthropicProvider };
}

export function disabledProvider(env: Env): AiProvider {
  const fail = async () => {
    throw new AiDisabledError();
  };
  return { enabled: false, model: env.model, visionModel: env.visionModel, analyzeFood: fail, compareBodyPhotos: fail, estimateDurations: fail, runAgentTurn: fail };
}
