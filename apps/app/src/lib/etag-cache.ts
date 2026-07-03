/** Module-level ETag tokens for conditional GET (#295). */

let graphEtag: string | null = null;
let graphVersion: string | null = null;
let versionEtag: string | null = null;

export function getGraphEtag(): string | null {
  return graphEtag;
}

export function setGraphEtag(etag: string | null): void {
  graphEtag = etag;
}

export function clearGraphEtag(): void {
  graphEtag = null;
}

export function getGraphVersion(): string | null {
  return graphVersion;
}

export function setGraphVersion(version: string | null): void {
  graphVersion = version;
}

export function clearGraphVersion(): void {
  graphVersion = null;
}

export function getVersionEtag(): string | null {
  return versionEtag;
}

export function setVersionEtag(etag: string | null): void {
  versionEtag = etag;
}