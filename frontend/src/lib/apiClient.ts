const ENV_API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();

const DEFAULT_API_BASES = [
  "http://127.0.0.1:5000",
  "http://localhost:5000",
  "http://127.0.0.1:8000",
  "http://localhost:8000",
];

let preferredApiBase: string | null = ENV_API_BASE || null;

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function getApiBaseCandidates(): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const candidates = [preferredApiBase, ENV_API_BASE, ...DEFAULT_API_BASES].filter(
    (base): base is string => Boolean(base)
  );

  for (const base of candidates) {
    const trimmed = base.trim().replace(/\/$/, "");
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordered.push(trimmed);
  }

  return ordered;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const normalizedPath = normalizePath(path);
  const bases = getApiBaseCandidates();
  let lastNetworkError: Error | null = null;

  for (const base of bases) {
    try {
      const response = await fetch(`${base}${normalizedPath}`, init);
      preferredApiBase = base;
      return response;
    } catch (err) {
      lastNetworkError = err instanceof Error ? err : new Error("Network error");
    }
  }

  throw lastNetworkError ?? new Error("Unable to reach backend API on configured ports");
}
