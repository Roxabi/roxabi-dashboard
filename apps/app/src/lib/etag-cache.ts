/** Module-level ETag tokens for conditional GET (#295). */

let graphEtag: string | null = null;
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

export function getVersionEtag(): string | null {
  return versionEtag;
}

export function setVersionEtag(etag: string | null): void {
  versionEtag = etag;
}