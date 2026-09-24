import { SupabaseClient } from '@supabase/supabase-js'

export interface TaskRecord {
  id: string
  type: 'project' | 'person' | 'personal'
  project_id: string | null
  title: string
  description: string | null
  due_date: string | null
  status: 'open' | 'done'
  assigned_to: string
  assigned_by: string | null
  visibility: 'private' | 'public'
  created_at: string
  completed_at: string | null
}

export interface NewTaskFields {
  type: 'project' | 'person' | 'personal'
  projectId: string | null
  title: string
  description: string | null
  dueDate: string | null
  assignedTo: string
  visibility: 'private' | 'public'
}

/**
 * Tasks visible to a caller: assigned to them, or assigned by them (see the
 * per-row visibility note on `tasks` in supabase/schema.sql — there is no
 * Postgres RLS backstop here, this function IS the access boundary).
 */
export async function getTasksForProfile(
  admin: SupabaseClient,
  profileId: string,
  projectId?: string,
): Promise<TaskRecord[]> {
  let query = admin
    .from('tasks')
    .select('*')
    .or(`assigned_to.eq.${profileId},assigned_by.eq.${profileId}`)
    .order('due_date', { ascending: true, nullsFirst: false })

  if (projectId) query = query.eq('project_id', projectId)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as TaskRecord[]
}

export async function createTask(
  admin: SupabaseClient,
  creatorProfileId: string,
  fields: NewTaskFields,
): Promise<TaskRecord> {
  const { data, error } = await admin
    .from('tasks')
    .insert({
      type: fields.type,
      project_id: fields.projectId,
      title: fields.title,
      description: fields.description,
      due_date: fields.dueDate,
      assigned_to: fields.assignedTo,
      assigned_by: creatorProfileId,
      visibility: fields.visibility,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as TaskRecord
}

/**
 * Only the assignee or assigner may change status — enforced here via the
 * `.or()` filter on the update itself (matching getTasksForProfile's
 * visibility rule), since there's no RLS to fall back on.
 */
export async function setTaskStatus(
  admin: SupabaseClient,
  taskId: string,
  callerProfileId: string,
  status: 'open' | 'done',
): Promise<void> {
  const { error } = await admin
    .from('tasks')
    .update({ status, completed_at: status === 'done' ? new Date().toISOString() : null })
    .eq('id', taskId)
    .or(`assigned_to.eq.${callerProfileId},assigned_by.eq.${callerProfileId}`)
  if (error) throw new Error(error.message)
}

export async function deleteTask(
  admin: SupabaseClient,
  taskId: string,
  callerProfileId: string,
): Promise<void> {
  const { error } = await admin
    .from('tasks')
    .delete()
    .eq('id', taskId)
    .or(`assigned_to.eq.${callerProfileId},assigned_by.eq.${callerProfileId}`)
  if (error) throw new Error(error.message)
}
