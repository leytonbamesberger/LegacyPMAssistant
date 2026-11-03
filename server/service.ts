import { SupabaseClient } from '@supabase/supabase-js'
import { inferTaskType, insertTask, isRealDate, TaskRuleError } from './tasks.js'

/**
 * A project's service salesman (`projects.service_id`, at most one) and the "Meet with owner/client"
 * task created when the slot goes from empty to a person. Used by the Add flow (a Service user adding a
 * project claims it) and by Edit Project (a PM/APM or the salesman changing it).
 */

export const serviceTaskTitle = (projectName: string) => `Meet with owner/client: ${projectName}`

/** An optional due date from a request body: absent / null / blank = none; anything else must be a real date. */
export function parseServiceDueDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !isRealDate(value)) {
    throw new TaskRuleError('"serviceDueDate" must be a real date (YYYY-MM-DD) or null')
  }
  return value
}

/** The only people who can be a project's service salesman. */
async function assertServiceProfile(admin: SupabaseClient, profileId: string): Promise<void> {
  const { data, error } = await admin.from('profiles').select('title').eq('id', profileId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new TaskRuleError('That person was not found', 404)
  if (data.title !== 'service') throw new TaskRuleError('Only people with the Service role can be a service salesman')
}

/**
 * Makes `salesmanId` the project's salesman IF it has none, and creates the meet-the-owner task. The
 * assignment is one conditional update (`where service_id is null`) and the task is only created when
 * that update changed a row, so two people claiming at once can't both win (the loser gets false and
 * nothing is created).
 */
export async function claimServiceSalesman(
  admin: SupabaseClient,
  options: { projectId: string; salesmanId: string; actingProfileId: string; dueDate: string | null },
): Promise<boolean> {
  const { projectId, salesmanId, actingProfileId, dueDate } = options
  const { data, error } = await admin
    .from('projects')
    .update({ service_id: salesmanId })
    .eq('id', projectId)
    .is('service_id', null)
    .select('id, name')
  if (error) throw new Error(error.message)
  const claimed = data?.[0] as { id: string; name: string } | undefined
  if (!claimed) return false

  try {
    await insertTask(admin, {
      type: inferTaskType(actingProfileId, [salesmanId], projectId),
      projectId,
      title: serviceTaskTitle(claimed.name),
      dueDate,
      assignedBy: actingProfileId,
      assigneeIds: [salesmanId],
      sourceCategory: 'service',
    })
  } catch (err) {
    // Don't leave a claimed project with no task behind: give the slot back and report the failure.
    await admin.from('projects').update({ service_id: null }).eq('id', projectId).eq('service_id', salesmanId)
    throw err
  }
  return true
}

/**
 * Edit Project's change of salesman:
 *  - empty -> person: claim (creates the task, with `dueDate`);
 *  - person A -> person B: the project's open service task moves from A to B; a completed one is left
 *    alone and nothing new is created;
 *  - cleared: the slot is emptied and any open task keeps its current assignee.
 */
export async function changeServiceSalesman(
  admin: SupabaseClient,
  options: { projectId: string; nextId: string | null; actingProfileId: string; dueDate: string | null },
): Promise<void> {
  const { projectId, nextId, actingProfileId, dueDate } = options
  const { data: project, error } = await admin.from('projects').select('service_id').eq('id', projectId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!project) throw new TaskRuleError('Project not found', 404)
  const current = (project.service_id as string | null) ?? null
  if (current === nextId) return

  if (nextId === null) {
    const { error: clearError } = await admin.from('projects').update({ service_id: null }).eq('id', projectId)
    if (clearError) throw new Error(clearError.message)
    return
  }

  await assertServiceProfile(admin, nextId)

  if (current === null) {
    const claimed = await claimServiceSalesman(admin, { projectId, salesmanId: nextId, actingProfileId, dueDate })
    if (!claimed) throw new TaskRuleError('Someone just assigned a service salesman to this project — reload and try again')
    return
  }

  // A -> B. Conditional on A still being the salesman, so a concurrent change isn't silently overwritten.
  const { data: swapped, error: swapError } = await admin
    .from('projects')
    .update({ service_id: nextId })
    .eq('id', projectId)
    .eq('service_id', current)
    .select('id')
  if (swapError) throw new Error(swapError.message)
  if (!swapped || swapped.length === 0) {
    throw new TaskRuleError('The service salesman was just changed by someone else — reload and try again')
  }

  const { data: open, error: openError } = await admin
    .from('tasks')
    .select('id')
    .eq('project_id', projectId)
    .eq('source_category', 'service')
    .neq('status', 'complete')
  if (openError) throw new Error(openError.message)
  const taskIds = (open ?? []).map((t) => t.id as string)
  if (taskIds.length === 0) return

  // Move A's assignment to B (add B first so a task is never left without an assignee).
  const { error: addError } = await admin
    .from('task_assignees')
    .upsert(taskIds.map((task_id) => ({ task_id, user_id: nextId })), { onConflict: 'task_id,user_id' })
  if (addError) throw new Error(addError.message)
  const { error: removeError } = await admin
    .from('task_assignees')
    .delete()
    .in('task_id', taskIds)
    .eq('user_id', current)
  if (removeError) throw new Error(removeError.message)
}
