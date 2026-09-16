import { SupabaseClient } from '@supabase/supabase-js'
import { PipelineStep, estimateAnthropicCostUsd } from './modelConfig.js'

export async function logAiUsage(
  admin: SupabaseClient,
  args: {
    submittalCheckId: string | null
    profileId: string | null
    promptType: PipelineStep
    model: string
    inputTokens: number
    outputTokens: number
  },
): Promise<void> {
  const { error } = await admin.from('ai_usage_logs').insert({
    submittal_check_id: args.submittalCheckId,
    profile_id: args.profileId,
    prompt_type: args.promptType,
    provider: 'anthropic',
    model: args.model,
    input_tokens: args.inputTokens,
    output_tokens: args.outputTokens,
    estimated_cost_usd: estimateAnthropicCostUsd(
      args.model,
      args.inputTokens,
      args.outputTokens,
    ),
  })
  // Logging failure shouldn't fail the pipeline — just note it.
  if (error) console.warn('[ai_usage_logs] insert failed:', error.message)
}
