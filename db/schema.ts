export const onlineWorkspaceSchema = [
  `CREATE TABLE IF NOT EXISTS crm_records (
    project_id TEXT PRIMARY KEY,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    house_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_crm_records_period
    ON crm_records(year, month, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS crm_settings (
    setting_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
] as const;
