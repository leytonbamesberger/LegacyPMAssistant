// Verbatim from "Spec ID & Multi Product Det Prompt V1.2.txt"
// (source file wrapped it as { "final_submittal_classification_prompt": "..." } —
// this is that string's value, unescaped into a normal multi-line string).
export const SPEC_IDENTIFICATION_PROMPT = `You are reviewing a construction submittal document for a mechanical contractor (HVAC and plumbing trades) to determine which CSI specification section it belongs to.

First, determine whether this document contains MULTIPLE distinct products/items that would each need their own separate submittal review (e.g., a package bundling a pump AND a separate control panel AND a separate strainer as unrelated line items). Do NOT flag a single product as multi-product just because it includes standard accessories, components, or appurtenances that are part of that one item (e.g., a valve with its actuator, a unit with its factory-installed controls). Only flag true multi-product packages — distinct, independently-specified items bundled into one PDF.

If multi-product: Check whether the user has indicated this should be treated as a SINGLE submittal. Look for explicit statements like "treat as single submittal", "single tag", "one submittal", or similar language indicating the user wants bundled items evaluated together rather than separately.

- If user indicates SINGLE SUBMITTAL treatment: Proceed to section identification. Assign the CSI section based on the primary/dominant product or the section that best encompasses the bundle. Note in reasoning that multiple products are present but treated as one submittal per user direction.
- If user has NOT indicated single submittal treatment: Stop here and output the multi_product flag with explanation. Do not attempt section identification.

If single product: identify the most likely CSI MasterFormat section this submittal belongs to. Mechanical contractor submittals are overwhelmingly (~90%) Division 22 (Plumbing) or Division 23 (HVAC), with a smaller share (~5-9%) in Division 26 (Electrical) — typically when submitting on behalf of a subcontracted electrical scope. Other divisions are rare. Weight your guess accordingly, but don't force a 22/23 answer if the document clearly indicates otherwise.

**Confidence Scoring:** Confidence should reflect how CLEARLY the content aligns with a CSI section, not the TYPE or FORMAT of the submittal. A general specification standard document, product data sheet, specification book, or technical reference all deserve equal weight if they clearly belong to a section. Do NOT reduce confidence because the submittal is a spec standard rather than product data, or vice versa. Confidence should be high (85+) when there is a clear, unambiguous match between content and section, regardless of submittal format. Reduce confidence only when the content has ambiguous scope, belongs to multiple possible sections, or lacks clear indicators of proper classification.

Output your best-guess CSI section (division + section number + title if identifiable), a confidence score from 0-100 representing how certain you are of the section match, and brief reasoning.

Output as JSON:
{
  "multi_product": boolean,
  "multi_product_explanation": string | null,
  "treat_as_single_submittal": boolean,
  "predicted_csi_section": string | null,
  "predicted_section_title": string | null,
  "confidence": number,
  "reasoning": string
}`

/** JSON Schema mirroring the prompt's "Output as JSON" shape, for tool-use enforcement. */
export const SPEC_IDENTIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    multi_product: { type: 'boolean' },
    multi_product_explanation: { type: ['string', 'null'] },
    treat_as_single_submittal: { type: 'boolean' },
    predicted_csi_section: { type: ['string', 'null'] },
    predicted_section_title: { type: ['string', 'null'] },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
  },
  required: [
    'multi_product',
    'treat_as_single_submittal',
    'confidence',
    'reasoning',
  ],
} as const

export interface SpecIdentificationResult {
  multi_product: boolean
  multi_product_explanation: string | null
  treat_as_single_submittal: boolean
  predicted_csi_section: string | null
  predicted_section_title: string | null
  confidence: number
  reasoning: string
}
