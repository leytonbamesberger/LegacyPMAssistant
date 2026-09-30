import { SupabaseClient } from '@supabase/supabase-js'
import PDFDocument from 'pdfkit'
import { LEGACY_LOGO_PNG_BASE64 } from '../shared/legacyLogo.js'
import { getCalendarMonthCompletionForMonth } from './checklist.js'
import { FLOW_REPORT_QUESTIONS, FlowReportAnswers } from '../shared/flowReportQuestions.js'
import { FlowReportRecord } from './flowReports.js'

const PAGE_MARGIN = 50
const CONTENT_BOTTOM = 700
const PAGE_OPTS = { size: 'LETTER' as const, margins: { top: 0, bottom: 0, left: 0, right: 0 } }
const NAVY = '#003058'
const RED = '#ee3428'
const LIGHT_TEXT = '#18385f'
const BUDGET_ITEM_NAMES = ['Forecasted', 'Projections Updated', 'Snapshots Taken', 'Sent to ERP']

// Letter-page signature block: pre-gap + "Respectfully Submitted," + "LEGACY
// MECHANICAL, INC." + signing space + name + title. Kept together with the
// last numbered section — see the isLast handling in drawLetterPage — so it
// never ends up alone on a second page.
const SIGNATURE_PRE_GAP = 8
const SIGNATURE_HEIGHT = SIGNATURE_PRE_GAP + 14 + 32 + 14 + 14

interface ExportProject {
  id: string
  job_number: string | null
  name: string
  gc: string | null
  pm_id: string | null
  apm_id: string | null
}

interface ExportProfile {
  id: string
  display_name: string | null
  title: 'pm' | 'apm' | null
}

const logoBuffer = Buffer.from(LEGACY_LOGO_PNG_BASE64, 'base64')

/**
 * Cover page (project checklist + flagged items) followed by one letter page
 * per project, in job-number order, matching the reference FLOW report
 * layout. Returns the finished PDF as a Buffer.
 */
export async function generateFlowReportPdf(
  admin: SupabaseClient,
  projectIds: string[],
  month: string,
  currentProfileId: string,
): Promise<Buffer> {
  const [projectsResult, reportsResult, profilesResult, completionByProject] = await Promise.all([
    admin
      .from('projects')
      .select('id, job_number, name, gc, pm_id, apm_id')
      .in('id', projectIds),
    admin.from('flow_reports').select('*').eq('month', month).in('project_id', projectIds),
    admin.from('profiles').select('id, display_name, title'),
    getCalendarMonthCompletionForMonth(admin, projectIds, month),
  ])
  if (projectsResult.error) throw new Error(projectsResult.error.message)
  if (reportsResult.error) throw new Error(reportsResult.error.message)
  if (profilesResult.error) throw new Error(profilesResult.error.message)

  const projects = (projectsResult.data ?? []) as ExportProject[]
  const projectsByJobNumber = [...projects].sort((a, b) =>
    (a.job_number ?? '').localeCompare(b.job_number ?? ''),
  )
  const reportsByProjectId = new Map(
    ((reportsResult.data ?? []) as FlowReportRecord[]).map((r) => [r.project_id, r]),
  )
  const profileById = new Map(((profilesResult.data ?? []) as ExportProfile[]).map((p) => [p.id, p]))

  const doc = new PDFDocument(PAGE_OPTS)
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  const generatedDate = formatDate(new Date())

  drawCoverPage(doc, projectsByJobNumber, reportsByProjectId, completionByProject, generatedDate)

  for (const project of projectsByJobNumber) {
    doc.addPage(PAGE_OPTS)
    const report = reportsByProjectId.get(project.id) ?? null
    // Signature name falls back PM -> APM -> the user running the export,
    // resolved per project since a batch export can mix assignments.
    const signer =
      (project.pm_id ? profileById.get(project.pm_id) : undefined) ??
      (project.apm_id ? profileById.get(project.apm_id) : undefined) ??
      profileById.get(currentProfileId)
    drawLetterPage(doc, project, report, signer, generatedDate)
  }

  doc.end()
  return done
}

/** Draws the footer + starts a fresh page if `needed` more points won't fit above CONTENT_BOTTOM. */
function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  if (y + needed <= CONTENT_BOTTOM) return y
  drawFooter(doc)
  doc.addPage(PAGE_OPTS)
  return 40
}

function drawLogo(doc: PDFKit.PDFDocument, topY: number, logoWidth: number, gapAfter: number): number {
  doc.rect(0, 0, 612, 14).fill('#d9d2c7')
  doc.image(logoBuffer, (612 - logoWidth) / 2, topY, { width: logoWidth })
  return topY + logoWidth * (412 / 605) + gapAfter
}

function drawCoverPage(
  doc: PDFKit.PDFDocument,
  projects: ExportProject[],
  reportsByProjectId: Map<string, FlowReportRecord>,
  completionByProject: Map<string, Map<string, boolean>>,
  generatedDate: string,
) {
  let y = drawLogo(doc, 40, 180, 20)

  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12)
  doc.text('Monthly FLOW Meeting Report', PAGE_MARGIN, y)
  y += 26

  doc.font('Helvetica').fontSize(10).fillColor('black')
  doc.text(`Date: ${generatedDate}`, PAGE_MARGIN, y)
  y += 24
  doc.text('To: Casey Corbin', PAGE_MARGIN, y)
  y += 14
  doc.text('Construction Operations Manager', PAGE_MARGIN, y)
  y += 24

  for (const project of projects) {
    y = ensureSpace(doc, y, 34)
    const completion = completionByProject.get(project.id)
    const label = `${project.job_number ?? '—'} — ${project.name}`
    doc.font('Helvetica-Bold').fontSize(10).fillColor('black').text(label, PAGE_MARGIN, y)
    y += 14

    let x = PAGE_MARGIN + 12
    doc.font('Helvetica').fontSize(9)
    for (const itemName of BUDGET_ITEM_NAMES) {
      const done = completion?.get(itemName) ?? false
      if (done) drawCheckmark(doc, x, y + 1)
      else drawX(doc, x, y + 1)
      doc.fillColor(done ? 'black' : LIGHT_TEXT).text(itemName, x + 12, y, { continued: false })
      x += doc.widthOfString(itemName) + 30
    }
    y += 20
  }

  const flagged = projects.filter((project) => {
    const report = reportsByProjectId.get(project.id)
    return report && (report.margin_fade_notes?.trim() || report.underbilled_notes?.trim())
  })

  if (flagged.length > 0) {
    y = ensureSpace(doc, y, 34)
    y += 16
    doc.font('Helvetica-Bold').fontSize(11).fillColor(RED).text('Flagged Items', PAGE_MARGIN, y)
    y += 18
    for (const project of flagged) {
      const report = reportsByProjectId.get(project.id)!
      y = ensureSpace(doc, y, 40)
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('black')
        .text(`${project.job_number ?? '—'} — ${project.name}`, PAGE_MARGIN, y)
      y += 14
      doc.font('Helvetica').fontSize(9).fillColor(LIGHT_TEXT)
      if (report.margin_fade_notes?.trim()) {
        y = ensureSpace(doc, y, 20)
        y = doc.text(`Margin fade: ${report.margin_fade_notes.trim()}`, PAGE_MARGIN + 12, y, {
          width: 500,
        }).y
        y += 4
      }
      if (report.underbilled_notes?.trim()) {
        y = ensureSpace(doc, y, 20)
        y = doc.text(`Underbilled: ${report.underbilled_notes.trim()}`, PAGE_MARGIN + 12, y, {
          width: 500,
        }).y
        y += 4
      }
      y += 8
    }
  }

  drawFooter(doc)
}

function drawLetterPage(
  doc: PDFKit.PDFDocument,
  project: ExportProject,
  report: FlowReportRecord | null,
  signer: ExportProfile | undefined,
  generatedDate: string,
) {
  // Logo shrunk ~22% and tightened up against the header block (see the
  // build-order prompt) — this is what bought back the room the signature
  // block needs to stay on one page in the default (all "None.") case.
  let y = drawLogo(doc, 40, 140, 10)

  doc.font('Helvetica').fontSize(10).fillColor('black')
  doc.text(`Date: ${generatedDate}`, PAGE_MARGIN, y)
  y += 20
  doc.text(`Company: ${report?.company?.trim() ?? ''}`, PAGE_MARGIN, y)
  y += 20
  doc.text(`Project: ${project.name}`, PAGE_MARGIN, y)
  y += 14
  doc.text(`Project ID: #${project.job_number ?? ''}`, PAGE_MARGIN, y)
  y += 20
  doc.text(`Attn: ${report?.attn?.trim() ?? ''}`, PAGE_MARGIN, y)
  y += 20

  y = doc.text(
    'The following is a list of open issues on the referenced project which is intended to be a ' +
      'constructive reminder of outstanding items. It is our general practice to submit such a list periodically.',
    PAGE_MARGIN,
    y,
    { width: 512 },
  ).y
  y += 14

  const answers = report?.answers ?? ({} as FlowReportAnswers)
  const headingHeight = 14
  const postAnswerGap = 9
  const answerX = PAGE_MARGIN + 14
  const answerWidth = 498

  FLOW_REPORT_QUESTIONS.forEach(({ key, label }, index) => {
    const answer = answers[key]?.trim() || 'None.'
    doc.font('Helvetica').fontSize(10)
    const answerHeight = doc.heightOfString(answer, { width: answerWidth })
    const isLast = index === FLOW_REPORT_QUESTIONS.length - 1
    const sectionHeight = headingHeight + answerHeight + postAnswerGap

    // Keep heading + answer together (break-inside: avoid); the last section
    // additionally reserves room for the signature block so the two move to
    // a new page together rather than leaving the signature stranded alone.
    y = ensureSpace(doc, y, sectionHeight + (isLast ? SIGNATURE_HEIGHT : 0))

    doc.font('Helvetica-Bold').fontSize(10).fillColor('black').text(`${index + 1}.  ${label}`, PAGE_MARGIN, y)
    y += headingHeight
    doc.font('Helvetica').fontSize(10)
    y = doc.text(answer, answerX, y, { width: answerWidth }).y
    y += postAnswerGap
  })

  y += SIGNATURE_PRE_GAP
  doc.font('Helvetica').fontSize(10)
  doc.text('Respectfully Submitted,', PAGE_MARGIN, y)
  y += 14
  doc.font('Helvetica-Bold').text('LEGACY MECHANICAL, INC.', PAGE_MARGIN, y)
  y += 32
  doc.font('Helvetica').text(signer?.display_name ?? '', PAGE_MARGIN, y)
  y += 14
  doc.text(signer?.title === 'apm' ? 'Assistant Project Manager' : 'Project Manager', PAGE_MARGIN, y)

  drawFooter(doc)
}

function drawFooter(doc: PDFKit.PDFDocument) {
  const y = 730
  doc.moveTo(PAGE_MARGIN, y).lineTo(612 - PAGE_MARGIN, y).strokeColor('#cccccc').stroke()

  doc.font('Helvetica').fontSize(9).fillColor('black')
  doc.text('legacy-mechanical.com', PAGE_MARGIN, y + 12)
  doc.text('Office: 720.898.3446   Fax: 720.531.5405', 230, y + 12)
  doc.text('6400 Broadway, Suite 1, Denver, CO 80221', 420, y + 12)

  const barY = 778
  doc.rect(0, barY, 90, 14).fill(RED)
  doc.rect(90, barY, 432, 14).fill(NAVY)
  doc.rect(522, barY, 90, 14).fill(RED)
}

function drawCheckmark(doc: PDFKit.PDFDocument, x: number, y: number) {
  doc
    .save()
    .lineWidth(1.2)
    .strokeColor(NAVY)
    .moveTo(x, y + 3)
    .lineTo(x + 2.5, y + 6)
    .lineTo(x + 7, y - 1)
    .stroke()
    .restore()
}

/** Same bounding box/placement as drawCheckmark — the "not completed" mark for a Budget item. */
function drawX(doc: PDFKit.PDFDocument, x: number, y: number) {
  doc
    .save()
    .lineWidth(1.2)
    .strokeColor(RED)
    .moveTo(x, y - 1)
    .lineTo(x + 7, y + 6)
    .moveTo(x + 7, y - 1)
    .lineTo(x, y + 6)
    .stroke()
    .restore()
}

function formatDate(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${date.getFullYear()}`
}
