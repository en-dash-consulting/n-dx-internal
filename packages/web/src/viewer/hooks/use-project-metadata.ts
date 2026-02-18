/**
 * Shared hook + cache for project metadata from `/api/project`.
 *
 * Used by both the sidebar header (project name display) and the
 * breadcrumb component.
 */

import { useState, useEffect } from "preact/hooks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitInfo {
  branch: string | null;
  sha: string | null;
  remoteUrl: string | null;
  repoName: string | null;
}

export interface ProjectMetadata {
  name: string;
  description: string | null;
  version: string | null;
  git: GitInfo | null;
  nameSource: "package.json" | "directory";
}

// ---------------------------------------------------------------------------
// Singleton fetch + cache
// ---------------------------------------------------------------------------

let cachedMeta: ProjectMetadata | null = null;
let fetchPromise: Promise<ProjectMetadata | null> | null = null;

async function fetchProjectMetadata(): Promise<ProjectMetadata | null> {
  try {
    const res = await fetch("/api/project");
    if (!res.ok) return null;
    return (await res.json()) as ProjectMetadata;
  } catch {
    return null;
  }
}

/** Fetch with dedup — concurrent calls share one in-flight request. */
export function getProjectMetadata(): Promise<ProjectMetadata | null> {
  if (cachedMeta) return Promise.resolve(cachedMeta);
  if (!fetchPromise) {
    fetchPromise = fetchProjectMetadata().then((m) => {
      cachedMeta = m;
      fetchPromise = null;
      return m;
    });
  }
  return fetchPromise;
}

/** Return the cached value synchronously (may be null if not yet fetched). */
export function getCachedProjectMetadata(): ProjectMetadata | null {
  return cachedMeta;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Preact hook — returns project metadata (fetches once, shares cache). */
export function useProjectMetadata(): ProjectMetadata | null {
  const [project, setProject] = useState<ProjectMetadata | null>(cachedMeta);

  useEffect(() => {
    getProjectMetadata().then((m) => {
      if (m) setProject(m);
    });
  }, []);

  return project;
}
