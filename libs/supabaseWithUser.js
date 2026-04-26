// Thin wrappers around the write-as-user RPCs defined in
// migration 202604240001_write_as_user_rpcs.sql.
//
// Each function bundles set_config('app.current_user_id') + the write in a
// single PostgreSQL function call (same transaction), so fn_action_log() can
// attribute the change to the authenticated user.

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
