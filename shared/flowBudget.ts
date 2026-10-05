/**
 * The monthly budget checklist on a flow report. Four booleans stored on
 * `flow_reports` (not on tasks, not in the checklist catalog) — optional, never
 * required to complete or submit a report. No imports: used by src/ and server/.
 */
export interface FlowBudgetChecklist {
  budget_forecasted: boolean
  budget_projections_updated: boolean
  budget_snapshots_taken: boolean
  budget_sent_to_erp: boolean
}

export type FlowBudgetKey = keyof FlowBudgetChecklist

/** In display order — the form, the PDF cover columns, and the Overview columns all follow this. */
export const FLOW_BUDGET_ITEMS: { key: FlowBudgetKey; label: string }[] = [
  { key: 'budget_forecasted', label: 'Forecasted' },
  { key: 'budget_projections_updated', label: 'Projections Updated' },
  { key: 'budget_snapshots_taken', label: 'Snapshots Taken' },
  { key: 'budget_sent_to_erp', label: 'Sent to ERP' },
]

export const NO_BUDGET_CHECKS: FlowBudgetChecklist = {
  budget_forecasted: false,
  budget_projections_updated: false,
  budget_snapshots_taken: false,
  budget_sent_to_erp: false,
}
