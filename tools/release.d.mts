export interface ReleaseIdentity {
  id: string;
  tag: string | null;
  channel: 'rc' | 'final' | null;
  problems: string[];
}

export function parseReleaseId(id: string): { version: string; channel: 'rc' | 'final' } | null;

export function releaseIdentity(
  version: string,
  options?: { env?: Record<string, string | undefined>; tag?: string },
): ReleaseIdentity;
