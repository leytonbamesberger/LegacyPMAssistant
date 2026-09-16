import { CategoryKey, CategoryResult } from '../../shared/categories.js'

// Verbatim from "Compliance Check Prompt V1.1.txt"
export const COMPLIANCE_CHECK_PROMPT = `You are checking a submittal document against a specification requirements checklist
for a mechanical contractor. Your job is to determine, for each of the 6 categories
below, whether the submittal satisfies what the specification requires.

Categories: Manufacturer/Model, Sizing, Certifications, Performance Data, Accessories, Misc.

For each category:

Review the extracted requirements in that category against what the submittal
document actually shows.
If the spec has no requirements in that category, mark it N/A.
If the submittal clearly satisfies the requirement, mark it Pass.
If there's a real, meaningful gap or mismatch, mark it Fail.
If there's a minor concern, ambiguity, or something the reviewer should double-check
but isn't clearly wrong, mark it Caution.

Special rule for Manufacturer/Model: if your initial finding is Fail (the submitted
manufacturer is not among those named in the spec), check whether the extracted
requirements include substitution or "or equal" language. If such language exists and
reasonably could apply to the submitted manufacturer, downgrade the finding from Fail
to Caution and explain in the notes that the spec permits substitutions and the
reviewer should confirm whether this one qualifies. Do not assume the substitution is
automatically acceptable — flag it for human judgment.

For the Accessories category specifically, apply this calibration: submittals
routinely use generic or commodity trim (braided supply lines instead of rigid
risers, standard escutcheons instead of an exact material call-out, off-the-shelf
stops and strainers) that serves the same function as what the spec describes in
prescriptive detail — this is normal market practice, not a defect.

For each accessory requirement:

Mark Pass if the submitted component performs the same function and there's no
indication it's incompatible or substandard, even if the exact material, brand,
or construction described doesn't match word-for-word.
Mark Caution if the mismatch could matter functionally or dimensionally (a
different trap size, a connection type that doesn't fit the specified fitting,
an accessory that's optional/not confirmed as ordered) — flag it for the
reviewer to confirm rather than treating it as settled either way.
Reserve Fail for Accessories only when a required accessory is clearly absent,
the wrong type entirely (e.g., no check valve where one is functionally
required), or the substitution creates a real functional, code, or safety gap.

This calibration applies to Accessories only — Manufacturer/Model, Certifications,
and Performance Data should still be held to the stricter Pass/Fail/Caution logic.

For the Misc category specifically, apply this calibration: submittals are
routinely made using manufacturer cut sheets alone, with the engineer/reviewer
expected to verify quantities, sizes, and schedule-level details (e.g., valve
tags, locations) separately — this is normal practice, not a submittal defect.
Do NOT fail a Misc requirement just because a cut sheet doesn't itself contain
a schedule, tag list, quantity breakdown, or similar project-specific
information that wouldn't reasonably appear on a manufacturer's product sheet.

For this type of requirement:

Mark Pass if the cut sheet doesn't contradict the requirement and the missing
information is the kind that's normally supplied elsewhere (schedule,
drawings, submittal cover sheet) rather than on the product sheet itself.
Mark Caution only if the spec's language suggests the schedule/quantity/tag
information must be submitted as part of this package specifically (e.g.,
"submit valve schedule with submittal," "include quantity breakdown in
submittal") — in which case note that the reviewer should confirm it's
provided elsewhere in the submittal package or request it.
Reserve Fail for Misc only when the cut sheet actively contradicts a
requirement (e.g., "all valves one manufacturer" but multiple manufacturers
are shown) or omits something no reasonable submittal review process would
catch downstream.

This calibration applies to Misc only.

For every category, write a short note explaining the finding. Pass notes can be brief
("Watts, matches spec") — Fail and Caution notes should give enough detail for the
reviewer to act without re-reading the spec themselves (what the spec calls for vs.
what was submitted).

Be precise about what counts as "manufacturer" — do not confuse the product
manufacturer with a distributor, vendor, or reseller named elsewhere in the submittal.

Output as JSON:
{
"categories": {
"manufacturer_model": { "status": "Pass|Fail|Caution|N/A", "notes": string },
"sizing": { "status": "...", "notes": string },
"certifications": { "status": "...", "notes": string },
"performance_data": { "status": "...", "notes": string },
"accessories": { "status": "...", "notes": string },
"misc": { "status": "...", "notes": string }
}
}`

const CATEGORY_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['Pass', 'Fail', 'Caution', 'N/A'] },
    notes: { type: 'string' },
  },
  required: ['status', 'notes'],
} as const

export const COMPLIANCE_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    categories: {
      type: 'object',
      properties: {
        manufacturer_model: CATEGORY_RESULT_SCHEMA,
        sizing: CATEGORY_RESULT_SCHEMA,
        certifications: CATEGORY_RESULT_SCHEMA,
        performance_data: CATEGORY_RESULT_SCHEMA,
        accessories: CATEGORY_RESULT_SCHEMA,
        misc: CATEGORY_RESULT_SCHEMA,
      },
      required: [
        'manufacturer_model',
        'sizing',
        'certifications',
        'performance_data',
        'accessories',
        'misc',
      ],
    },
  },
  required: ['categories'],
} as const

export interface ComplianceCheckResult {
  categories: Record<CategoryKey, CategoryResult>
}
