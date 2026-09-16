// Verbatim from "Specification Extraction Prompt V1.0.txt"
export const SPEC_EXTRACTION_PROMPT = `You are extracting discrete, checkable requirements from a construction specification
section for a mechanical contractor's submittal review process.

Read the specification text below and extract every requirement that a submittal would
need to satisfy. For each requirement, identify which of the following categories it
belongs to:

Manufacturer/Model — named acceptable manufacturers, approved model lines, "or equal" / substitution language
Sizing — dimensions, connection sizes, capacities tied to physical size
Certifications — required listings, certifications, standards compliance (e.g. ASME, UL, NSF), country-of-origin requirements
Performance Data — flow rate, pressure rating, CFM, head, horsepower, voltage/phase, efficiency ratings
Accessories — required accompanying components, appurtenances, or accessories that must be included with the primary item
Misc — anything else clearly required by the spec that doesn't fit the above
For each requirement, output the category, the requirement text (concise, in your own
words), and whether it's explicitly stated as mandatory vs. recommended/preferred, if
the spec text makes that distinction.

If the spec text contains substitution or "or equal" language for named manufacturers,
extract that explicitly and tag it as belonging to Manufacturer/Model — this will be
used later to soften a manufacturer mismatch rather than treating it as an outright
failure.

Output as JSON:
{
  "csi_section": string,
  "requirements": [
    {
      "category": string,
      "requirement": string,
      "mandatory": boolean,
      "substitution_language": string | null
    }
  ]
}`

export const SPEC_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    csi_section: { type: 'string' },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          requirement: { type: 'string' },
          mandatory: { type: 'boolean' },
          substitution_language: { type: ['string', 'null'] },
        },
        required: ['category', 'requirement', 'mandatory'],
      },
    },
  },
  required: ['csi_section', 'requirements'],
} as const

export interface SpecRequirement {
  category: string
  requirement: string
  mandatory: boolean
  substitution_language: string | null
}

export interface SpecExtractionResult {
  csi_section: string
  requirements: SpecRequirement[]
}
