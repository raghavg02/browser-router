import { LaunchHistoryItem } from "./historyStorage";

// Common popular domains dictionary for instant completion
const POPULAR_DOMAINS: Record<string, string> = {
  git: "github.com",
  github: "github.com",
  figma: "figma.com",
  fig: "figma.com",
  yt: "youtube.com",
  youtube: "youtube.com",
  reddit: "reddit.com",
  red: "reddit.com",
  notion: "notion.so",
  linear: "linear.app",
  gpt: "chatgpt.com",
  chatgpt: "chatgpt.com",
  claude: "claude.ai",
  x: "x.com",
  twitter: "x.com",
  linkedin: "linkedin.com",
  so: "stackoverflow.com",
  stackoverflow: "stackoverflow.com",
  netflix: "netflix.com",
  amazon: "amazon.com",
  amzn: "amazon.com",
  wiki: "wikipedia.org",
  wikipedia: "wikipedia.org",
  gmail: "mail.google.com",
  docs: "docs.google.com",
  drive: "drive.google.com",
  vercel: "vercel.com",
  twitch: "twitch.tv",
  spotify: "open.spotify.com",
};

/**
 * Checks if a typed keyword matches a popular website domain.
 */
export function getDomainSuggestion(query: string): string | null {
  const clean = query.trim().toLowerCase();
  if (!clean || clean.length < 2) return null;

  // Exact or prefix match in dictionary
  if (POPULAR_DOMAINS[clean]) {
    return POPULAR_DOMAINS[clean];
  }

  // Check if starts with a dictionary key (e.g. "figm" -> "figma.com")
  for (const [key, domain] of Object.entries(POPULAR_DOMAINS)) {
    if (key.startsWith(clean) && clean.length >= 3) {
      return domain;
    }
  }

  return null;
}

/**
 * Fetches live search auto-complete suggestions from Google's standard public suggestion endpoint.
 * (The same engine used in Chrome, Brave, and Edge omnibars).
 */
export async function fetchLiveSearchSuggestions(query: string, signal?: AbortSignal): Promise<string[]> {
  const clean = query.trim();
  if (!clean || clean.length < 2) return [];

  // Skip URL-like inputs
  if (clean.includes("://") || clean.includes("localhost") || clean.match(/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/)) {
    return [];
  }

  const url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(clean)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500); // 1.5s max timeout

    // Link incoming signal if provided
    if (signal) {
      signal.addEventListener("abort", () => controller.abort());
    }

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return [];

    const data = (await response.json()) as [string, string[]];
    if (Array.isArray(data) && Array.isArray(data[1])) {
      // Exclude exact duplicate of the typed query and take top 4
      return data[1].filter((item) => item.toLowerCase() !== clean.toLowerCase()).slice(0, 4);
    }
    return [];
  } catch {
    // Graceful silent fallback if offline or aborted
    return [];
  }
}

/**
 * Filters recent history items that match the user's current query.
 */
export function filterMatchingHistory(history: LaunchHistoryItem[], query: string, limit = 3): LaunchHistoryItem[] {
  const clean = query.trim().toLowerCase();
  if (!clean) return [];

  return history
    .filter((item) => item.query.toLowerCase().includes(clean) || item.resolvedUrl.toLowerCase().includes(clean))
    .slice(0, limit);
}
