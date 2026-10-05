import { SupabaseClient } from '@supabase/supabase-js'

const ID_CHUNK = 100

/**
 * After a project's PM/APM changes: its open checklist tasks (the ones initiation
 * generated — Setup and Recurring) follow the new assignment. Manual tasks and
 * completed ones are left alone.
 *
 * (Flow reports are no longer stored as task rows, so there's nothing flow-shaped to sync.)
 */
export async function syncGeneratedTaskAssignees(admin: SupabaseClient, projectId: string): Promise<void> {
  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('pm_id, apm_id')
    .eq('id', projectId)
    .single()
  if (projectError) throw new Error(projectError.message)
  const assigneeIds = [project.pm_id, project.apm_id].filter((id): id is string => typeof id === 'string')

  const { data: tasks, error } = await admin
    .from('tasks')
    .select('id')
    .eq('project_id', projectId)
    .not('source_category', 'is', null)
    .neq('status', 'complete')
  if (error) throw new Error(error.message)
  const taskIds = (tasks ?? []).map((t) => t.id as string)

  for (let i = 0; i < taskIds.length; i += ID_CHUNK) {
    const chunk = taskIds.slice(i, i + ID_CHUNK)
    const { error: deleteError } = await admin.from('task_assignees').delete().in('task_id', chunk)
    if (deleteError) throw new Error(deleteError.message)
    if (assigneeIds.length === 0) continue
    const { error: insertError } = await admin
      .from('task_assignees')
      .insert(chunk.flatMap((task_id) => assigneeIds.map((user_id) => ({ task_id, user_id }))))
    if (insertError) throw new Error(insertError.message)
  }
}
