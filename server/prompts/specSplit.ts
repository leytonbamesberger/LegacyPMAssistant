// Not one of the three supplied prompts — written for Part 1's "combined
// document" fallback: when a synced Procore spec document isn't already
// segmented per CSI section, this splits its raw text into per-section
// chunks before they're cached in `spec_sections`.
export const SPEC_SPLIT_PROMPT = `You are splitting a combined construction specification document into its individual
CSI MasterFormat sections for a mechanical contractor's submittal review process.

The text below may contain one or more specification sections concatenated together.
Section boundaries are usually marked by a header line such as "SECTION 22 13 13",
"22 13 13 - SANITARY SEWERAGE PIPING", or similar MasterFormat-style numbering
(division + section + subsection, e.g. "22 13 13" or "23 05 00"), optionally followed
by a section title on the same or next line.

Identify every section boundary and split the text accordingly. For each section:
- Report its CSI section number as it appears in the header (don't reformat it).
- Report its title if one is present near the header.
- Include the full text belonging to that section, from its header up to (but not
  including) the next section's header, trimmed of leading/trailing whitespace.

If the entire input is really just one section with no further internal boundaries,
return a single entry covering all of it. Do not summarize or omit any of the
original text — every character of the input must belong to exactly one output
section's text.

Output as JSON:
{
  "sections": [
    { "csi_section": string, "title": string | null, "text": string }
  ]
}`

export const SPEC_SPLIT_SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          csi_section: { type: 'string' },
          title: { type: ['string', 'null'] },
          text: { type: 'string' },
        },
        required: ['csi_section', 'text'],
      },
    },
  },
  required: ['sections'],
} as const

export interface SpecSplitSection {
  csi_section: string
  title: string | null
  text: string
}

export interface SpecSplitResult {
  sections: SpecSplitSection[]
}
