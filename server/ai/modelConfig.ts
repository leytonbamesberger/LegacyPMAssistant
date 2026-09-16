/**
 * Which provider/model/effort each pipeline step uses — a config table, not
 * something scattered across call sites. Add a provider later by adding a
 * `callXyz()` wrapper next to `callAnthropicTool` and branching on `provider`
 * in `server/ai/callModel.ts`; no pipeline code needs to change.
 */

export type PipelineStep = 'specIdentification' | 'specExtraction' | 'specSplit' | 'complianceCheck'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ModelStepConfig {
  provider: 'anthropic'
  model: string
  effort?: Effort
}

export const PROMPT_MODEL_CONFIG: Record<PipelineStep, ModelStepConfig> = {
  specIdentification: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  specExtraction: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  // Not one of the three prompts supplied, but needed by Part 1's "combined
  // document" fallback — cheap, so it gets Haiku too.
  specSplit: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  complianceCheck: {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    effort: 'medium',
  },
}

/**
 * Anthropic's published per-million-token rates for cost estimation in
 * `ai_usage_logs`. Rough and worth revisiting — Anthropic can reprice models.
 */
const ANTHROPIC_RATES_PER_MILLION: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 3, output: 15 },
}

export function estimateAnthropicCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const rate = ANTHROPIC_RATES_PER_MILLION[model]
  if (!rate) return null
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000
}
