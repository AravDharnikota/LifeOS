import type { FoodAnalysis } from "@aravos/shared";
import type { AgentTurnRequest, AgentTurnResult, AiProvider, BodyComparisonRequest, BodyComparisonResult, DurationEstimateRequest, FoodAnalysisRequest } from "./provider.ts";

/** Scriptable provider for tests and for running the UI without an API key. */
export class MockAiProvider implements AiProvider {
  enabled = true;
  model = "mock";
  visionModel = "mock";
  foodHandler: (req: FoodAnalysisRequest) => Promise<FoodAnalysis> = async (req) => ({
    mealName: req.text ? req.text.slice(0, 40) : "Grilled chicken bowl",
    mealType: "lunch",
    items: [
      { name: "Grilled chicken breast", portion: "1 breast", grams: 150, calories: 250, proteinG: 46, carbsG: 0, fatG: 5.5, fiberG: 0, sugarG: 0, sodiumMg: 110, saturatedFatG: 1.5, confidence: 0.9 },
      { name: "White rice", portion: "1 cup", grams: 160, calories: 205, proteinG: 4.2, carbsG: 45, fatG: 0.4, fiberG: 0.6, sugarG: 0, sodiumMg: 2, saturatedFatG: 0.1, confidence: 0.8 },
    ],
    totals: { calories: 455, proteinG: 50.2, carbsG: 45, fatG: 5.9 },
    healthScore: 8,
    notes: "Assumed no added oil. Portion estimated from plate size.",
  });
  bodyHandler: (req: BodyComparisonRequest) => Promise<BodyComparisonResult> = async (req) => ({
    summary: req.previous ? "Slightly more shoulder definition than the previous photo; lighting differs." : "Baseline photo recorded.",
    observations: ["Shoulders look marginally broader relative to waist.", "Posture is more upright.", "Lighting is brighter, which can exaggerate definition."],
    progressScore: req.previous ? 1 : null,
  });
  durationHandler: (req: DurationEstimateRequest) => Promise<Record<string, number>> = async (req) => Object.fromEntries(req.tasks.map((t) => [t.id, 30]));
  agentHandler: (req: AgentTurnRequest) => Promise<AgentTurnResult> = async (req) => {
    const last = req.messages[req.messages.length - 1];
    const text = typeof last?.content === "string" ? last.content : "";
    return { text: `Mock reply to: ${text}`, content: [{ type: "text", text: `Mock reply to: ${text}`, citations: null }], newMessages: [{ role: "assistant", content: `Mock reply to: ${text}` }], toolCalls: [], stopReason: "end_turn" };
  };

  analyzeFood(req: FoodAnalysisRequest) {
    return this.foodHandler(req);
  }
  compareBodyPhotos(req: BodyComparisonRequest) {
    return this.bodyHandler(req);
  }
  estimateDurations(req: DurationEstimateRequest) {
    return this.durationHandler(req);
  }
  runAgentTurn(req: AgentTurnRequest) {
    return this.agentHandler(req);
  }
}
