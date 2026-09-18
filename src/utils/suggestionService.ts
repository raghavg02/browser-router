import { LaunchHistoryItem } from "./historyStorage";

export type GoogleSuggestionType = "QUERY" | "NAVIGATION" | "CALCULATOR";

export interface GoogleSuggestion {
  id: string;
  text: string;
  type: GoogleSuggestionType;
  url?: string;
  title?: string;
  relevance: number;
}

interface CacheEntry {
  suggestions: GoogleSuggestion[];
  timestamp: number;
}

const suggestionCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache
const MAX_CACHE_ENTRIES = 150;

/**
 * Parses and cleans a URL into a compact, human-readable display string (e.g. "https://www.figma.com/" -> "figma.com")
 */
function formatDisplayUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${host}${path}`;
  } catch {
    return rawUrl
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/$/, "");
  }
}

/**
 * Fetches real-time, live Google Chrome Omnibar suggestions:
 * - Relevance-ranked search queries
 * - Dynamic navigational website links with live page titles (no hardcoded lists)
 * - Live calculator / math results
 */
export async function fetchGoogleSuggestions(
  query: string,
  limit = 4,
  signal?: AbortSignal,
): Promise<GoogleSuggestion[]> {
  const clean = query.trim();
  if (!clean || clean.length < 1) return [];

  const cacheKey = clean.toLowerCase();
  const cached = suggestionCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.suggestions.slice(0, limit);
  }

  // Skip live query lookup if the user entered an explicit URL with protocol or localhost
  if (clean.includes("://") || clean.startsWith("localhost:") || clean.startsWith("localhost/")) {
    return [];
  }

  const url = `https://suggestqueries.google.com/complete/search?client=chrome&hl=en&q=${encodeURIComponent(clean)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500); // 1.5s max timeout

    if (signal) {
      signal.addEventListener("abort", () => controller.abort());
    }

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return [];

    type GoogleSuggestData = [
      string, // query
      string[], // suggestions
      string[], // descriptions
      unknown[], // extra info
      {
        "google:suggesttype"?: string[];
        "google:suggestrelevance"?: number[];
      }?,
    ];

    const data = (await response.json()) as GoogleSuggestData;
    if (!Array.isArray(data) || !Array.isArray(data[1])) {
      return [];
    }

    const rawSuggestions = data[1];
    const rawDescriptions = Array.isArray(data[2]) ? data[2] : [];
    const meta = data[4] || {};
    const suggestTypes = meta["google:suggesttype"] || [];
    const suggestRelevance = meta["google:suggestrelevance"] || [];

    const results: GoogleSuggestion[] = [];
    const seenTexts = new Set<string>();

    for (let i = 0; i < rawSuggestions.length; i++) {
      const itemText = rawSuggestions[i]?.trim();
      if (!itemText) continue;

      const rawType = suggestTypes[i] || "";
      const rawDesc = rawDescriptions[i]?.trim() || "";
      const relevance = typeof suggestRelevance[i] === "number" ? suggestRelevance[i] : 1000 - i;

      let type: GoogleSuggestionType = "QUERY";
      let destinationUrl: string | undefined;
      let displayTitle = itemText;
      let cleanText = itemText;

      if (rawType === "NAVIGATION" || itemText.startsWith("http://") || itemText.startsWith("https://")) {
        type = "NAVIGATION";
        destinationUrl =
          itemText.startsWith("http://") || itemText.startsWith("https://") ? itemText : `https://${itemText}`;
        cleanText = formatDisplayUrl(destinationUrl);
        displayTitle = rawDesc || cleanText;
      } else if (rawType === "CALCULATOR" || itemText.startsWith("= ") || rawDesc.toLowerCase() === "calculator") {
        type = "CALCULATOR";
        cleanText = itemText.replace(/^=\s*/, "");
        displayTitle = itemText;
      } else {
        type = "QUERY";
        // If the query suggestion is identical to what the user already typed, skip it
        if (cleanText.toLowerCase() === clean.toLowerCase()) {
          continue;
        }
      }

      const dedupeKey = `${type}:${cleanText.toLowerCase()}`;
      if (seenTexts.has(dedupeKey)) continue;
      seenTexts.add(dedupeKey);

      results.push({
        id: `google_${type.toLowerCase()}_${i}_${cleanText.substring(0, 30)}`,
        text: cleanText,
        type,
        url: destinationUrl,
        title: displayTitle !== cleanText ? displayTitle : undefined,
        relevance,
      });
    }

    // Sort strictly by relevance descending
    results.sort((a, b) => b.relevance - a.relevance);

    // Cache in memory for instant typing/backspacing
    if (suggestionCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = suggestionCache.keys().next().value;
      if (oldestKey) suggestionCache.delete(oldestKey);
    }
    suggestionCache.set(cacheKey, {
      suggestions: results,
      timestamp: Date.now(),
    });

    return results.slice(0, limit);
  } catch {
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
