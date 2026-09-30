/** One free-text answer per FLOW-letter question. All optional/partial while in progress. */
export interface FlowReportAnswers {
  changeProposals?: string
  rfis?: string
  submittals?: string
  applicationsForPayment?: string
  fieldOrdersTAndM?: string
  itemsDueFromLegacy?: string
  scheduleAcknowledgment?: string
  other?: string
}

export const FLOW_REPORT_QUESTIONS: { key: keyof FlowReportAnswers; label: string }[] = [
  { key: 'changeProposals', label: 'Change Proposals' },
  { key: 'rfis', label: 'Request for Information' },
  { key: 'submittals', label: 'Submittals' },
  { key: 'applicationsForPayment', label: 'Applications for Payment' },
  { key: 'fieldOrdersTAndM', label: 'Field Orders/T&M' },
  { key: 'itemsDueFromLegacy', label: 'Items Due to You From Legacy' },
  { key: 'scheduleAcknowledgment', label: 'Schedule Acknowledgment' },
  { key: 'other', label: 'Other' },
]
