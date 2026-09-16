import { Effort } from './modelConfig.js'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

export type ContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'document'
      source: { type: 'base64'; media_type: 'application/pdf'; data: string }
    }

export interface AnthropicToolCallOptions<T> {
  model: string
  effort?: Effort
  system: string
  content: ContentBlock[]
  /** Name of the single tool Claude is forced to call — its `input` IS the result. */
  toolName: string
  toolDescription: string
  /** JSON Schema for the tool's `input`. */
  toolSchema: Record<string, unknown>
  maxTokens?: number
  /** For validating/typing the parsed result at the call site. */
  parse?: (input: unknown) => T
}

export interface AnthropicToolCallResult<T> {
  data: T
  inputTokens: number
  outputTokens: number
}

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('Missing required server env var: ANTHROPIC_API_KEY')
  return key
}

/**
 * Call Claude with a single forced tool so the response is structurally
 * guaranteed JSON (matching `toolSchema`) instead of parsed from free text.
 * Never retries on failure — a malformed/failed response throws, and the
 * caller surfaces a manual "Retry" action rather than silently burning
 * tokens on an automatic retry loop.
 */
export async function callAnthropicTool<T>(
  options: AnthropicToolCallOptions<T>,
): Promise<AnthropicToolCallResult<T>> {
  const body: Record<string, unknown> = {
    model: options.model,
    max_tokens: options.maxTokens ?? 4096,
    system: options.system,
    messages: [{ role: 'user', content: options.content }],
    tools: [
      {
        name: options.toolName,
        description: options.toolDescription,
        input_schema: options.toolSchema,
      },
    ],
    tool_choice: { type: 'tool', name: options.toolName },
  }
  if (options.effort) {
    body.output_config = { effort: options.effort }
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': requireApiKey(),
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Anthropic API returned ${res.status}: ${text.slice(0, 1000)}`)
  }

  let json: {
    content?: Array<{ type: string; name?: string; input?: unknown }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Anthropic API returned non-JSON: ${text.slice(0, 500)}`)
  }

  const toolUse = (json.content ?? []).find(
    (block) => block.type === 'tool_use' && block.name === options.toolName,
  )
  if (!toolUse) {
    throw new Error(
      `Anthropic response had no "${options.toolName}" tool_use block: ${text.slice(0, 500)}`,
    )
  }

  const data = options.parse ? options.parse(toolUse.input) : (toolUse.input as T)

  return {
    data,
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  }
}

export function pdfContentBlock(base64: string): ContentBlock {
  return {
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: base64 },
  }
}

export function textContentBlock(text: string): ContentBlock {
  return { type: 'text', text }
}
