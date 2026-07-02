/*
 * Thin wrappers around the write-as-user RPCs defined in migration
 * 202604240001_write_as_user_rpcs.sql. All user-initiated writes (insert, update, delete,
 * upsert) must go through these functions instead of calling Supabase directly. Each
 * wrapper bundles set_config('app.current_user_id') and the actual write into a single
 * PostgreSQL RPC call within one transaction, so the fn_action_log trigger can correctly
 * attribute every change to the authenticated user in the action_log table. Accepts a
 * Supabase client instance as its first argument so callers control which DB environment
 * is targeted. The match parameter accepts an arbitrary key/value object for updates and
 * deletes that don't have a single primary key (rowId) to target.
 */

export async function insertAsUser(supabase, { userId, table, data }) {
  const { data: result, error } = await supabase.rpc("rpc_insert_as_user", {
    p_user_id: userId,
    p_table: table,
    p_data: data,
  });
  return { data: result, error };
}

export async function insertBatchAsUser(supabase, { userId, table, rows }) {
  const { data: result, error } = await supabase.rpc("rpc_insert_batch_as_user", {
    p_user_id: userId,
    p_table: table,
    p_rows: rows,
  });
  return { data: result, error };
}

export async function updateAsUser(supabase, { userId, table, data, rowId = null, match = null }) {
  const { data: result, error } = await supabase.rpc("rpc_update_as_user", {
    p_user_id: userId,
    p_table: table,
    p_data: data,
    p_row_id: rowId,
    p_match: match,
  });
  return { data: result, error };
}

export async function deleteAsUser(supabase, { userId, table, rowId = null, match = null }) {
  const { data: result, error } = await supabase.rpc("rpc_delete_as_user", {
    p_user_id: userId,
    p_table: table,
    p_row_id: rowId,
    p_match: match,
  });
  return { data: result, error };
}

export async function upsertAsUser(supabase, {
  userId,
  table,
  data,
  conflictCols = ["id"],
  ignoreConflicts = false,
}) {
  const { data: result, error } = await supabase.rpc("rpc_upsert_as_user", {
    p_user_id: userId,
    p_table: table,
    p_data: data,
    p_conflict_cols: conflictCols,
    p_ignore_conflicts: ignoreConflicts,
  });
  return { data: result, error };
}
