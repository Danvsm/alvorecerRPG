"use client";

import { ArrowLeft, Eye, Flag, MessageCircle, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import type { Row } from "@/lib/types";
import IdentityAvatar from "./IdentityAvatar";

function shortTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  if (sameDay) {
    return date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

export default function ConversationMonitor({
  campaign,
  identities,
  cosmetics,
  equipment,
  urls,
}: {
  campaign: string;
  identities: Row[];
  cosmetics: Row[];
  equipment: Row[];
  urls: Record<string, string>;
}) {
  const [conversations, setConversations] = useState<Row[]>([]);
  const [latestByConversation, setLatestByConversation] = useState<
    Record<string, Row>
  >({});
  const [selected, setSelected] = useState("");
  const [messages, setMessages] = useState<Row[]>([]);
  const [reports, setReports] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState("");
  const messageEndRef = useRef<HTMLDivElement>(null);

  const identityById = useMemo(
    () => new Map(identities.map((identity) => [identity.id, identity])),
    [identities],
  );

  const loadConversations = useCallback(async () => {
    if (!campaign) return;
    setLoadingList(true);
    setError("");

    try {
      const conversationResult = await retryNetworkRead(() =>
        browserDb()
          .from("direct_conversations")
          .select("*")
          .eq("campaign_id", campaign)
          .order("created_at", { ascending: false }),
      );

      if (conversationResult.error) throw conversationResult.error;

      const next = conversationResult.data || [];
      setConversations(next);

      const ids = next.map((conversation) => conversation.id);
      if (!ids.length) {
        setLatestByConversation({});
        setSelected("");
        return;
      }

      const latestResult = await retryNetworkRead(() =>
        browserDb()
          .from("direct_messages")
          .select("id,conversation_id,sender_id,body,media_id,created_at")
          .in("conversation_id", ids)
          .order("created_at", { ascending: false })
          .limit(500),
      );

      if (latestResult.error) throw latestResult.error;

      const latest: Record<string, Row> = {};
      for (const message of latestResult.data || []) {
        if (!latest[message.conversation_id]) {
          latest[message.conversation_id] = message;
        }
      }
      setLatestByConversation(latest);

      if (selected && !ids.includes(selected)) {
        setSelected("");
        setMessages([]);
      }
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setLoadingList(false);
    }
  }, [campaign, selected]);

  const loadReports = useCallback(async () => {
    if (!campaign) return;

    try {
      const result = await retryNetworkRead(() =>
        browserDb()
          .from("conversation_reports")
          .select(
            "id,campaign_id,conversation_id,reporter_identity_id,reported_identity_id,reason,status,created_at",
          )
          .eq("campaign_id", campaign)
          .order("created_at", { ascending: false })
          .limit(100),
      );

      if (result.error) throw result.error;
      setReports(result.data || []);
    } catch (reason) {
      setError(readableErrorMessage(reason));
    }
  }, [campaign]);

  const loadMessages = useCallback(async (conversationId: string) => {
    if (!conversationId) {
      setMessages([]);
      return;
    }

    setLoadingMessages(true);
    setError("");

    try {
      const result = await retryNetworkRead(() =>
        browserDb()
          .from("direct_messages")
          .select("id,conversation_id,sender_id,body,media_id,created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(200),
      );

      if (result.error) throw result.error;
      setMessages([...(result.data || [])].reverse());
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    void loadMessages(selected);
  }, [loadMessages, selected]);

  useEffect(() => {
    if (!campaign) return;

    const db = browserDb();
    const channel = db
      .channel(`master-conversation-monitor-${campaign}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages" },
        (payload) => {
          const message = payload.new as Row;
          setLatestByConversation((current) => ({
            ...current,
            [message.conversation_id]: message,
          }));

          if (message.conversation_id === selected) {
            setMessages((current) => {
              if (current.some((item) => item.id === message.id)) return current;
              return [...current, message].slice(-200);
            });
          }

          void loadConversations();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_conversations" },
        () => void loadConversations(),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_reports",
          filter: `campaign_id=eq.${campaign}`,
        },
        () => void loadReports(),
      )
      .subscribe();

    return () => {
      void db.removeChannel(channel);
    };
  }, [campaign, loadConversations, loadReports, selected]);

  useEffect(() => {
    if (!selected) return;
    window.requestAnimationFrame(() =>
      messageEndRef.current?.scrollIntoView({ block: "end" }),
    );
  }, [messages, selected]);

  const rows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");

    return conversations
      .map((conversation) => {
        const first = identityById.get(conversation.first_id);
        const second = identityById.get(conversation.second_id);
        const latest = latestByConversation[conversation.id];
        const activityAt = latest?.created_at || conversation.created_at || "";
        const title = `${first?.name || "Perfil indisponível"} × ${
          second?.name || "Perfil indisponível"
        }`;

        return { conversation, first, second, latest, activityAt, title };
      })
      .filter((entry) => {
        if (!normalized) return true;
        const haystack = [
          entry.title,
          entry.latest?.body || "",
          entry.first?.subtitle || "",
          entry.second?.subtitle || "",
        ]
          .join(" ")
          .toLocaleLowerCase("pt-BR");
        return haystack.includes(normalized);
      })
      .sort(
        (left, right) =>
          new Date(right.activityAt).getTime() -
          new Date(left.activityAt).getTime(),
      );
  }, [conversations, identityById, latestByConversation, query]);

  const selectedConversation = conversations.find(
    (conversation) => conversation.id === selected,
  );
  const selectedFirst = selectedConversation
    ? identityById.get(selectedConversation.first_id)
    : undefined;
  const selectedSecond = selectedConversation
    ? identityById.get(selectedConversation.second_id)
    : undefined;

  const identityName = (id: string) =>
    identityById.get(id)?.name || "Perfil indisponível";

  return (
    <section className="conversation-monitor" aria-label="Monitoramento de conversas">
      <div className="monitor-toolbar">
        <div>
          <span className="monitor-test-badge">
            <Eye size={14} />
            Modo de teste
          </span>
          <p>
            Leitura de conversas da campanha para validação do chat. Acesso
            exclusivo do mestre.
          </p>
        </div>
        <button
          type="button"
          disabled={loadingList}
          onClick={() => {
            void loadConversations();
            void loadReports();
          }}
        >
          <RefreshCw size={16} className={loadingList ? "spin" : ""} />
          Atualizar
        </button>
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {reports.length > 0 && (
        <section className="monitor-reports" aria-label="Denúncias de conversa">
          <header>
            <span>
              <Flag size={17} />
              Denúncias
            </span>
            <strong>{reports.length}</strong>
          </header>
          <div className="monitor-report-list">
            {reports.map((report) => (
              <article className="monitor-report" key={report.id}>
                <div className="monitor-report-people">
                  <strong>{identityName(String(report.reporter_identity_id))}</strong>
                  <span>denunciou</span>
                  <strong>{identityName(String(report.reported_identity_id))}</strong>
                </div>
                <p>{String(report.reason || "")}</p>
                <time dateTime={String(report.created_at)}>
                  {new Date(String(report.created_at)).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </article>
            ))}
          </div>
        </section>
      )}

      <div
        className={`monitor-grid ${selected ? "has-selection" : ""}`}
      >
        <aside className="monitor-conversations">
          <label className="monitor-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar conversa..."
            />
          </label>

          <div className="monitor-conversation-list">
            {rows.map(({ conversation, first, second, latest, activityAt }) => (
              <button
                type="button"
                key={conversation.id}
                className={
                  selected === conversation.id
                    ? "monitor-conversation active"
                    : "monitor-conversation"
                }
                onClick={() => setSelected(conversation.id)}
              >
                <span className="monitor-avatar-pair" aria-hidden="true">
                  <IdentityAvatar
                    identity={first}
                    cosmetics={cosmetics}
                    equipment={equipment}
                    urls={urls}
                    size={42}
                  />
                  <IdentityAvatar
                    identity={second}
                    cosmetics={cosmetics}
                    equipment={equipment}
                    urls={urls}
                    size={42}
                  />
                </span>

                <span className="monitor-conversation-copy">
                  <strong>
                    {first?.name || "Perfil indisponível"}{" "}
                    <span>×</span>{" "}
                    {second?.name || "Perfil indisponível"}
                  </strong>
                  <small>
                    {latest?.media_id
                      ? "Imagem enviada"
                      : latest?.body || "Conversa sem mensagens"}
                  </small>
                </span>

                <time dateTime={activityAt}>{shortTime(activityAt)}</time>
              </button>
            ))}

            {!rows.length && !loadingList && (
              <p className="monitor-empty">Nenhuma conversa encontrada.</p>
            )}
          </div>
        </aside>

        <article className="monitor-thread">
          {selectedConversation ? (
            <>
              <header className="monitor-thread-header">
                <button
                  type="button"
                  className="monitor-back"
                  onClick={() => setSelected("")}
                  aria-label="Voltar para conversas"
                >
                  <ArrowLeft />
                </button>

                <div>
                  <strong>
                    {selectedFirst?.name || "Perfil indisponível"} ×{" "}
                    {selectedSecond?.name || "Perfil indisponível"}
                  </strong>
                  <small>
                    {messages.length} mensagem(ns) carregada(s) · últimas 200
                  </small>
                </div>

                <MessageCircle size={22} aria-hidden="true" />
              </header>

              <div className="monitor-messages">
                {messages.map((message) => {
                  const sender = identityById.get(message.sender_id);
                  return (
                    <div className="monitor-message" key={message.id}>
                      <div className="monitor-message-author">
                        <IdentityAvatar
                          identity={sender}
                          cosmetics={cosmetics}
                          equipment={equipment}
                          urls={urls}
                          size={32}
                        />
                        <div>
                          <strong>{identityName(message.sender_id)}</strong>
                          <time dateTime={message.created_at}>
                            {new Date(message.created_at).toLocaleString(
                              "pt-BR",
                              {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </time>
                        </div>
                      </div>

                      {message.body && <p>{message.body}</p>}
                      {message.media_id && (
                        <span className="monitor-media-note">
                          Imagem anexada à mensagem
                        </span>
                      )}
                    </div>
                  );
                })}

                {!messages.length && !loadingMessages && (
                  <p className="monitor-empty">Essa conversa ainda está vazia.</p>
                )}

                {loadingMessages && (
                  <p className="monitor-empty">Carregando mensagens...</p>
                )}
                <div ref={messageEndRef} />
              </div>
            </>
          ) : (
            <div className="monitor-thread-placeholder">
              <Eye size={34} />
              <strong>Selecione uma conversa</strong>
              <p>
                As mensagens aparecerão aqui em modo somente leitura para teste.
              </p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
