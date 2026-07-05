/** Module-level ETag tokens for conditional GET (#295). Persisted to sessionStorage for delta cursors. */

const GRAPH_ETAG_KEY = "roxabi:graph-etag";
const GRAPH_VERSION_KEY = "roxabi:graph-version";

let graphEtag: string | null = null;
let graphVersion: string | null = null;
let versionEtag: string | null = null;

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* private mode / SSR */
  }
}

export function getGraphEtag(): string | null {
  return graphEtag ?? readSession(GRAPH_ETAG_KEY);
}

export function setGraphEtag(etag: string | null): void {
  graphEtag = etag;
  writeSession(GRAPH_ETAG_KEY, etag);
}

export function clearGraphEtag(): void {
  graphEtag = null;
  writeSession(GRAPH_ETAG_KEY, null);
}

export function getGraphVersion(): string | null {
  return graphVersion ?? readSession(GRAPH_VERSION_KEY);
}

export function setGraphVersion(version: string | null): void {
  graphVersion = version;
  writeSession(GRAPH_VERSION_KEY, version);
}

export function clearGraphVersion(): void {
  graphVersion = null;
  writeSession(GRAPH_VERSION_KEY, null);
}

export function getVersionEtag(): string | null {
  return versionEtag;
}

export function setVersionEtag(etag: string | null): void {
  versionEtag = etag;
}