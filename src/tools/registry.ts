import type { ComponentType, SVGProps } from 'react'
import {
  ChatIcon,
  ChecklistIcon,
  DocumentPlusIcon,
  RatingIcon,
  ReceiptIcon,
  QuestionIcon,
} from '../components/icons'

export type ToolStatus = 'active' | 'next' | 'coming-soon'

export interface ToolDefinition {
  /** Stable key; also used as the route segment when the tool goes live. */
  key: string
  name: string
  description: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  status: ToolStatus
  /**
   * Route to navigate to when the tool is live. Left undefined while the tool
   * is a placeholder — adding the real tool later is: build the page, set
   * `status: 'active'`, set `path`.
   */
  path?: string
}

/**
 * The Home page renders this list directly. To ship a real tool, flip its
 * `status` to `'active'` and give it a `path` — no layout changes needed.
 */
export const TOOLS: ToolDefinition[] = [
  {
    key: 'submittal-checker',
    name: 'Submittal Checker',
    description:
      'Compare submittals against spec sections and flag missing or non-compliant items.',
    Icon: ChecklistIcon,
    status: 'next',
  },
  {
    key: 'ai-project-chat',
    name: 'AI Project Chat',
    description: 'Ask questions across a project’s documents, RFIs, and submittals.',
    Icon: ChatIcon,
    status: 'coming-soon',
  },
  {
    key: 'submittal-creator',
    name: 'Submittal Creator',
    description: 'Assemble submittal packages from product data and spec requirements.',
    Icon: DocumentPlusIcon,
    status: 'coming-soon',
  },
  {
    key: 'po-creator',
    name: 'PO Creator',
    description: 'Draft purchase orders from takeoffs and vendor quotes.',
    Icon: ReceiptIcon,
    status: 'coming-soon',
  },
  {
    key: 'rfi-creator',
    name: 'RFI Creator',
    description: 'Turn field questions into formatted RFIs ready for the GC.',
    Icon: QuestionIcon,
    status: 'coming-soon',
  },
  {
    key: 'gc-ratings',
    name: 'GC Ratings',
    description: 'Track and review general contractor performance across projects.',
    Icon: RatingIcon,
    status: 'coming-soon',
  },
]
