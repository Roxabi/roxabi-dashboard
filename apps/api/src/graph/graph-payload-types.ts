export type DevState = "idle" | "dev" | "pr_open" | "pr_reviewed";

export interface GraphNode {
  key: string;
  repo: string;
  number: number;
  title: string | null;
  state: string;
  dev_state: DevState;
  url: string | null;
  milestone: string | null;
  milestone_code: string | null;
  milestone_name: string | null;
  milestone_sort_key: number;
  labels: string[];
  priority: string | null;
  lane: string | null;
  size: string | null;
  status: string | null;
  is_stub: boolean;
  assignees: string[];
}

export interface GraphEdge {
  src: string;
  dst: string;
  kind: string;
}

export interface RepoSummary {
  repo: string;
  archived: boolean;
  is_private: boolean;
  issue_count: number;
  last_updated_at: string | null;
}

export interface GraphBuildResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  repos: RepoSummary[];
  rowsRead: number;
}