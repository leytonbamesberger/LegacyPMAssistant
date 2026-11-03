import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useMsal } from '@azure/msal-react'
import { fuzzyScore } from '../lib/fuzzy'
import {
  fetchProjectProcurementItems,
  importProcurementItems,
  type ImportItemInput,
  type ProcurementItem,
} from '../lib/procurement'
import {
  duplicateKey,
  ImportFormatError,
  readProcurementWorkbook,
  type ParsedWorkbook,
} from '../lib/procurementImport'
import type { Project } from '../lib/projects'
import { Modal } from './Modal'

/** Project order in the picker: job number (natural order), then name; no job number last. */
function byJobNumber(a: Project, b: Project): number {
  return (
    Number(!a.job_number) - Number(!b.job_number) ||
    (a.job_number ?? '').localeCompare(b.job_number ?? '', undefined, { numeric: true }) ||
    a.name.localeCompare(b.name)
  )
}

const MAX_RESULTS = 50

/**
 * The one "Import from Excel" for the Procurement tab: choose the project (the user's own projects are listed
 * up front, and the search box finds any other), choose that project's workbook, check the preview (what was
 * found, what couldn't be read, what is already in the log), then import. Nothing is saved until the confirm
 * button, and the file itself never leaves the browser — only the rows you keep are sent.
 */
export function ProcurementImportModal({
  projects,
  inView,
  onClose,
  onImported,
}: {
  projects: Project[]
  /** Ids of the projects in the user's Procurement view (an import into any other one adds it to the view). */
  inView: Set<string>
  onClose: () => void
  onImported: (projectId: string, items: ProcurementItem[]) => void
}) {
  const { instance, accounts } = useMsal()
  const account = accounts[0]

  const [project, setProject] = useState<Project | null>(null)
  /** The chosen project's items now (null while loading), to flag rows that are already in the log. */
  const [existing, setExisting] = useState<ProcurementItem[] | null>(null)
  const [existingFailed, setExistingFailed] = useState(false)
  const [reading, setReading] = useState(false)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Spreadsheet row numbers the user is keeping. */
  const [kept, setKept] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)

  // The chosen project's current items, for the duplicate check.
  useEffect(() => {
    if (!project || !account) return
    let cancelled = false
    setExisting(null)
    setExistingFailed(false)
    void (async () => {
      const items = await fetchProjectProcurementItems(instance, account, project.id)
      if (cancelled) return
      setExisting(items ?? [])
      setExistingFailed(items === null)
    })()
    return () => {
      cancelled = true
    }
  }, [instance, account, project])

  function chooseProject(next: Project | null) {
    setProject(next)
    setParsed(null)
    setFileName('')
    setError(null)
    setKept(new Set())
  }

  const existingKeys = useMemo(() => new Set((existing ?? []).map(duplicateKey)), [existing])
  const isDuplicate = (row: ParsedWorkbook['rows'][number]) => existingKeys.has(duplicateKey(row.item))

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // picking the same file again should re-read it
    if (!file) return
    setReading(true)
    setError(null)
    setParsed(null)
    setFileName(file.name)
    try {
      const result = await readProcurementWorkbook(file)
      setParsed(result)
      // Everything is kept except rows the log already has.
      setKept(new Set(result.rows.filter((r) => !existingKeys.has(duplicateKey(r.item))).map((r) => r.sourceRow)))
    } catch (err) {
      setError(err instanceof ImportFormatError ? err.message : 'That file couldn’t be read.')
    }
    setReading(false)
  }

  function toggle(sourceRow: number) {
    setKept((prev) => {
      const next = new Set(prev)
      if (next.has(sourceRow)) next.delete(sourceRow)
      else next.add(sourceRow)
      return next
    })
  }

  const rows = parsed?.rows ?? []
  const keptRows = rows.filter((r) => kept.has(r.sourceRow))
  const duplicates = rows.filter(isDuplicate).length
  const warned = rows.filter((r) => r.warnings.length > 0).length

  async function handleImport() {
    if (!account || !project || saving || keptRows.length === 0) return
    setSaving(true)
    setError(null)
    const created = await importProcurementItems(
      instance,
      account,
      project.id,
      keptRows.map((r) => r.item as ImportItemInput),
    )
    setSaving(false)
    if (!created) {
      setError('Couldn’t import the items — nothing was saved. Try again.')
      return
    }
    onImported(project.id, created)
    onClose()
  }

  const th = 'px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-legacy-blue-light'
  const td = 'px-2 py-1.5 align-top'

  return (
    <Modal onClose={onClose} maxWidthClassName="max-w-5xl" closeOnBackdrop={false}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-legacy-blue-dark">Import from Excel</h2>
          <p className="mt-0.5 text-xs text-legacy-blue-light">
            {project
              ? 'Choose this project’s procurement workbook (.xlsx). The headers are found automatically (usually row 5, with the items from row 6) and read by name. Est. Shipping, Est. Delivery and the price escalation columns are skipped — Est. Delivery is worked out from Ordered + Lead Time.'
              : 'Choose the project the workbook is for.'}
          </p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-legacy-blue-light hover:text-legacy-red" aria-label="Close">
          ×
        </button>
      </div>

      {!project ? (
        <ProjectPicker projects={projects} inView={inView} onChoose={chooseProject} />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-legacy-blue-light/25 bg-legacy-blue-light/5 px-3 py-2 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-legacy-blue-light">Project</span>
            <span className="font-medium text-legacy-blue-dark">
              {project.job_number ? `${project.job_number} — ` : ''}
              {project.name}
            </span>
            <button
              type="button"
              onClick={() => chooseProject(null)}
              disabled={saving}
              className="ml-auto text-xs font-medium text-legacy-blue-light underline underline-offset-2 hover:text-legacy-blue-dark disabled:opacity-40"
            >
              Change
            </button>
          </div>
          {!inView.has(project.id) && (
            <p className="mt-2 text-xs text-legacy-blue-light">
              This project isn't in your Procurement view yet — importing will add it, so you can see the items.
            </p>
          )}
          {existingFailed && (
            <p className="mt-2 text-xs text-legacy-red">
              Couldn’t check what this project already has, so duplicates won’t be flagged.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label
              className={`rounded-full border border-legacy-blue-light/30 px-3 py-1.5 text-xs font-medium text-legacy-blue-dark ${
                existing === null ? 'opacity-50' : 'cursor-pointer hover:border-legacy-blue-dark'
              }`}
            >
              {parsed ? 'Choose a different file' : 'Choose file'}
              <input
                type="file"
                accept=".xlsx,.xlsm"
                disabled={existing === null}
                onChange={(e) => void handleFile(e)}
                className="sr-only"
              />
            </label>
            {fileName && <span className="text-xs text-legacy-blue-light">{fileName}</span>}
            {reading && <span className="text-xs text-legacy-blue-light">Reading…</span>}
            {existing === null && <span className="text-xs text-legacy-blue-light">Checking the project…</span>}
          </div>

          {error && (
            <p role="alert" className="mt-3 text-sm text-legacy-red">
              {error}
            </p>
          )}

          {parsed && (
            <div className="mt-4">
              <p className="text-sm text-legacy-blue-dark">
                Sheet “{parsed.sheetName}” — headers on row {parsed.headerRow}. <strong>{rows.length}</strong> item
                {rows.length === 1 ? '' : 's'} found
                {parsed.skipped.length > 0 && (
                  <>
                    , {parsed.skipped.length} row{parsed.skipped.length === 1 ? '' : 's'} skipped (no Description:{' '}
                    {parsed.skipped.map((s) => s.sourceRow).join(', ')})
                  </>
                )}
                {duplicates > 0 && <>, {duplicates} already in the log (unchecked)</>}
                {warned > 0 && <>, {warned} with cells that couldn’t be read (left blank)</>}.
              </p>

              {rows.length === 0 ? (
                <p className="mt-3 text-sm text-legacy-blue-light">There's nothing to import from this sheet.</p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-lg border border-legacy-blue-light/25">
                  <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-xs text-legacy-blue-dark">
                    <thead>
                      <tr className="bg-[#edf0f4]">
                        <th className={th}>
                          <input
                            type="checkbox"
                            aria-label="Select all items"
                            checked={keptRows.length === rows.length}
                            onChange={(e) =>
                              setKept(e.target.checked ? new Set(rows.map((r) => r.sourceRow)) : new Set())
                            }
                            className="h-3.5 w-3.5 accent-legacy-blue-dark"
                          />
                        </th>
                        <th className={th}>Row</th>
                        <th className={th}>Description</th>
                        <th className={th}>Spec #</th>
                        <th className={th}>Tag</th>
                        <th className={th}>Submitted</th>
                        <th className={th}>Approved</th>
                        <th className={th}>Ordered</th>
                        <th className={th}>Lead Time</th>
                        <th className={th}>Vendor</th>
                        <th className={th}>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const dup = isDuplicate(row)
                        const { item } = row
                        const cell = `${td} border-b border-legacy-blue-light/15`
                        return (
                          <tr key={row.sourceRow} className={kept.has(row.sourceRow) ? '' : 'opacity-50'}>
                            <td className={cell}>
                              <input
                                type="checkbox"
                                aria-label={`Import ${item.description}`}
                                checked={kept.has(row.sourceRow)}
                                onChange={() => toggle(row.sourceRow)}
                                className="h-3.5 w-3.5 accent-legacy-blue-dark"
                              />
                            </td>
                            <td className={`${cell} text-legacy-blue-light`}>{row.sourceRow}</td>
                            <td className={`${cell} font-medium`}>
                              {item.description}
                              {dup && (
                                <span className="ml-1.5 rounded-full bg-legacy-blue-light/15 px-1.5 py-0.5 text-[10px] font-normal text-legacy-blue-light">
                                  Already in the log
                                </span>
                              )}
                              {row.warnings.map((w) => (
                                <span key={w} className="mt-0.5 block text-[11px] font-normal text-legacy-red">
                                  {w}
                                </span>
                              ))}
                            </td>
                            <td className={cell}>{item.spec_number}</td>
                            <td className={cell}>{item.tag}</td>
                            <td className={`${cell} whitespace-nowrap`}>{item.submitted_date}</td>
                            <td className={`${cell} whitespace-nowrap`}>{item.approved_date}</td>
                            <td className={`${cell} whitespace-nowrap`}>{item.ordered_date}</td>
                            <td className={`${cell} whitespace-nowrap`}>
                              {item.lead_time_value !== undefined ? `${item.lead_time_value} ${item.lead_time_unit}` : ''}
                            </td>
                            <td className={cell}>{item.vendor}</td>
                            <td className={`${cell} max-w-[12rem] truncate`} title={item.notes}>
                              {item.notes}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-5 flex items-center justify-between border-t border-legacy-blue-light/15 pt-3">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-full border border-legacy-blue-light/30 px-3 py-1.5 text-xs font-medium text-legacy-blue-dark hover:border-legacy-blue-dark disabled:opacity-40"
        >
          Cancel
        </button>
        {project && (
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={saving || keptRows.length === 0}
            className="rounded-full bg-legacy-blue-dark px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {saving ? 'Importing…' : `Import ${keptRows.length} item${keptRows.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
    </Modal>
  )
}

/**
 * Step one: the user's own (Added) projects are listed up front; typing in the search box searches every
 * project by job number or name.
 */
function ProjectPicker({
  projects,
  inView,
  onChoose,
}: {
  projects: Project[]
  inView: Set<string>
  onChoose: (project: Project) => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim()

  const mine = useMemo(() => projects.filter((p) => p.isStarred).sort(byJobNumber), [projects])
  const results = useMemo(() => {
    if (!q) return []
    return projects
      .map((p) => ({ p, score: fuzzyScore(q, `${p.job_number ?? ''} ${p.name}`) }))
      .filter((x): x is { p: Project; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score || byJobNumber(a.p, b.p))
      .slice(0, MAX_RESULTS)
      .map((x) => x.p)
  }, [projects, q])

  const list = q ? results : mine

  return (
    <div className="mt-4">
      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search any project by job number or name…"
        aria-label="Search projects"
        className="w-full rounded-md border border-legacy-blue-light/30 px-2.5 py-1.5 text-sm text-legacy-blue-dark focus:border-legacy-blue-dark focus:outline-none"
      />
      <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-legacy-blue-light">
        {q ? 'Search results' : 'Your projects'}
      </div>
      <ul className="mt-1 max-h-72 divide-y divide-legacy-blue-light/10 overflow-y-auto rounded-lg border border-legacy-blue-light/25">
        {list.length === 0 && (
          <li className="px-3 py-3 text-sm text-legacy-blue-light">
            {q ? `No projects match “${query}”.` : 'You haven’t added any projects yet — search above to find one.'}
          </li>
        )}
        {list.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onChoose(p)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-legacy-blue-dark hover:bg-legacy-blue-light/10"
            >
              <span className="w-20 shrink-0 text-xs text-legacy-blue-light">{p.job_number ?? '—'}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              {q && p.isStarred && <span className="shrink-0 text-[10px] uppercase text-legacy-blue-light">Added</span>}
              {!inView.has(p.id) && <span className="shrink-0 text-[10px] text-legacy-blue-light">not in your view</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
