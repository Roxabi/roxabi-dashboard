-- Per-issue graph mutation log for incremental /api/graph?since=… fetches (#295 follow-up).

CREATE TABLE IF NOT EXISTS graph_changelog (
  issue_key  TEXT NOT NULL,
  bumped_at  TEXT NOT NULL,
  op         TEXT NOT NULL DEFAULT 'upsert' CHECK (op IN ('upsert', 'delete')),
  PRIMARY KEY (issue_key, bumped_at)
);

CREATE INDEX IF NOT EXISTS idx_graph_changelog_bumped_at ON graph_changelog(bumped_at);