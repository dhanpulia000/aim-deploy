import { useState, useEffect, useMemo, useCallback } from "react";
import { createAuthHeaders } from "../utils/headers";
import {
  buildCafeGameLookups,
  type CrawlerGameDto
} from "../utils/cafeGameDisplay";

export function useCrawlerGames(token: string | null, enabled = true) {
  const [games, setGames] = useState<CrawlerGameDto[]>([]);

  const load = useCallback(async () => {
    if (!token) {
      setGames([]);
      return;
    }
    if (!enabled) {
      return;
    }
    try {
      const headers = createAuthHeaders(token) ?? {};
      const res = await fetch("/api/monitoring/crawler-games", {
        headers,
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) return;
      const j = await res.json();
      const raw = j.success ? j.data : j;
      setGames(Array.isArray(raw) ? raw : []);
    } catch {
      setGames([]);
    }
  }, [token, enabled]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [load, enabled]);

  const lookups = useMemo(() => buildCafeGameLookups(games), [games]);

  const defaultCafeGameCode = games[0]?.code ?? "PUBG_PC";

  return { games, lookups, reload: load, defaultCafeGameCode };
}
