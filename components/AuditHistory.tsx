"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage } from "@/lib/network";
import type { Row } from "@/lib/types";

const PAGE_SIZE = 20;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export default function AuditHistory({ campaignId, characterId, refreshToken, renderRecord }: {
  campaignId: string;
  characterId?: string;
  refreshToken: unknown;
  renderRecord: (record: Row) => ReactNode;
}) {
  const [records, setRecords] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const cursor = useRef<Row | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);

  const loadPage = useCallback(async (reset: boolean) => {
    if (!reset && inFlight.current) return;
    const version = reset ? ++generation.current : generation.current;
    if (reset) {
      cursor.current = null;
      setRecords([]);
      setHasMore(false);
    }
    inFlight.current = true;
    setLoading(true);
    setError("");
    try {
      let query = browserDb().from("audit_logs")
        .select("id,created_at,character_id,character_label,actor_id,actor_label,action,detail")
        .eq("campaign_id", campaignId)
        .gte("created_at", new Date(Date.now() - RETENTION_MS).toISOString())
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE + 1);
      if (characterId) query = query.eq("character_id", characterId);
      const after = cursor.current;
      if (after) query = query.or(
        `created_at.lt.${after.created_at},and(created_at.eq.${after.created_at},id.lt.${after.id})`,
      );
      const { data, error: queryError } = await query;
      if (queryError) throw queryError;
      if (version !== generation.current) return;
      const rows = (data || []) as Row[];
      const page = rows.slice(0, PAGE_SIZE);
      setRecords((previous) => reset ? page : [...previous, ...page]);
      cursor.current = page.at(-1) || cursor.current;
      setHasMore(rows.length > PAGE_SIZE);
    } catch (cause) {
      if (version === generation.current) setError(readableErrorMessage(cause));
    } finally {
      if (version === generation.current) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }, [campaignId, characterId]);

  useEffect(() => {
    void loadPage(true);
    return () => { generation.current += 1; };
  }, [loadPage, refreshToken]);

  return (
    <div className="list">
      <p className="muted">Últimos 30 dias. Registros mais antigos são excluídos automaticamente.</p>
      {records.map(renderRecord)}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && !records.length && <p>Nenhuma alteração nos últimos 30 dias.</p>}
      {loading && <p role="status">Carregando histórico…</p>}
      {(hasMore || error) && <button className="load-more" disabled={loading}
        onClick={() => void loadPage(records.length === 0)}>
        {error ? "Tentar novamente" : "Carregar mais"}
      </button>}
    </div>
  );
}
