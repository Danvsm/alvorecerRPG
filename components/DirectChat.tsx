"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ImagePlus, MessageCircle, Send, X } from "lucide-react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import type { Row } from "@/lib/types";
import ChatImage from "./ChatImage";
import IdentityAvatar from "./IdentityAvatar";
import { optimizedWebp } from "@/lib/media";

export default function DirectChat({
  campaign,
  identities,
  cosmetics,
  equipment,
  urls,
  actor,
  master,
  revision,
  requestedPeer,
  docked = false,
  hideBubble = false,
  onUnreadChange,
}: {
  campaign: string;
  identities: Row[];
  cosmetics: Row[];
  equipment: Row[];
  urls: Record<string, string>;
  actor: string;
  master: boolean;
  revision: unknown;
  requestedPeer?: { id: string; nonce: number };
  docked?: boolean;
  hideBubble?: boolean;
  onUnreadChange?: (count: number) => void;
}) {
  const [open, setOpen] = useState(false),
    [conversations, setConversations] = useState<Row[]>([]),
    [messages, setMessages] = useState<Row[]>([]),
    [unread, setUnread] = useState(0),
    [selected, setSelected] = useState(""),
    [body, setBody] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [limit, setLimit] = useState(50);
  const [position, setPosition] = useState({ right: true, y: 75 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const action = async (op: string, d: Row) => {
    const r = await browserDb().rpc("social_action", {
      c: campaign,
      op,
      d: { ...d, actor_id: actor },
    });
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  useEffect(() => {
    onUnreadChange?.(unread);
  }, [onUnreadChange, unread]);
  useEffect(() => {
    if (hideBubble) setOpen(false);
  }, [hideBubble]);
  useEffect(() => {
    if (!requestedPeer?.id || !actor) return;
    let valid = true;
    action("conversation", { recipient_id: requestedPeer.id })
      .then((r) => {
        if (valid) {
          setSelected(r.id);
          setOpen(true);
          setRefresh((v) => v + 1);
        }
      })
      .catch((e) => setError(readableErrorMessage(e)));
    return () => {
      valid = false;
    };
  }, [requestedPeer, actor]);
  useEffect(() => {
    let valid = true;
    Promise.all([
      browserDb()
        .from("direct_conversations")
        .select("*")
        .eq("campaign_id", campaign)
        .order("created_at", { ascending: false }),
      retryNetworkRead(() =>
        browserDb().rpc("unread_messages", { c: campaign, actor }),
      ),
    ]).then(([c, r]) => {
      if (!valid) return;
      const failed = [c, r].find((x) => x.error);
      if (failed?.error) {
        setError(readableErrorMessage(failed.error));
        return;
      }
      setConversations(c.data || []);
      setUnread(Number(r.data || 0));
    });
    return () => {
      valid = false;
    };
  }, [campaign, actor, revision, refresh]);
  useEffect(() => {
    if (!selected || !open) return;
    let valid = true;
    browserDb()
      .from("direct_messages")
      .select("*")
      .eq("conversation_id", selected)
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(async (r) => {
        if (!valid) return;
        if (r.error) {
          setError(readableErrorMessage(r.error));
          return;
        }
        setMessages((r.data || []).reverse());
        if (
          conversations.some(
            (c) =>
              c.id === selected && [c.first_id, c.second_id].includes(actor),
          )
        ) {
          try {
            await action("read", { conversation_id: selected });
            const unreadResult = await retryNetworkRead(() =>
              browserDb().rpc("unread_messages", {
                c: campaign,
                actor,
              }),
            );
            if (!unreadResult.error && valid)
              setUnread(Number(unreadResult.data || 0));
          } catch (e) {
            setError(readableErrorMessage(e));
          }
        }
      });
    return () => {
      valid = false;
    };
  }, [selected, open, actor, revision, refresh, limit, conversations]);
  useEffect(() => {
    setMessages([]);
  }, [selected]);

  useEffect(() => {
    if (!open || !selected) return;
    window.requestAnimationFrame(() =>
      messagesEndRef.current?.scrollIntoView({ block: "end" }),
    );
  }, [messages, open, selected]);

    const selectedConversation = conversations.find((c) => c.id === selected);
  const selectedPeerIds = selectedConversation
    ? [selectedConversation.first_id, selectedConversation.second_id].filter(
        (id) => id !== actor,
      )
    : [];
  const selectedPeer =
    selectedPeerIds.length === 1
      ? identities.find((identity) => identity.id === selectedPeerIds[0])
      : undefined;
  const selectedPeerName =
    selectedPeer?.name ||
    selectedPeerIds
      .map(
        (id) =>
          identities.find((identity) => identity.id === id)?.name ||
          "Perfil indisponível",
      )
      .join(" e ") ||
    "Conversa";

  const canSend =
    selectedConversation &&
    [selectedConversation.first_id, selectedConversation.second_id].includes(
      actor,
    );
  return (
    <>
      {!hideBubble && (
        <button
          className={`chat-bubble${docked ? " combat-docked" : ""}`}
          style={{
            top: `${position.y}%`,
            left: position.right ? "auto" : 12,
            right: position.right ? 12 : "auto",
            touchAction: "none",
          }}
          aria-label={`Mensagens, ${unread} não lidas`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, moved: false };
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            if (
              Math.abs(e.clientX - drag.current.x) +
                Math.abs(e.clientY - drag.current.y) >
              8
            )
              drag.current.moved = true;
            if (drag.current.moved)
              setPosition({
                right: e.clientX > window.innerWidth / 2,
                y: Math.max(
                  10,
                  Math.min(85, (e.clientY / window.innerHeight) * 100),
                ),
              });
          }}
          onPointerUp={() => {
            if (!drag.current?.moved) setOpen((v) => !v);
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen((v) => !v);
            }
          }}
        >
          <MessageCircle />
          {unread > 0 && <span>{unread}</span>}
        </button>
      )}
      {open && (
        <aside className="chat-window" aria-label="Mensagens diretas">
          <header className="chat-thread-header">
            <button
              type="button"
              className="chat-thread-back"
              onClick={() => setOpen(false)}
              aria-label="Voltar às conversas"
            >
              <ChevronLeft />
            </button>
            <div className="chat-thread-peer">
              {selectedPeer && (
                <IdentityAvatar
                  identity={selectedPeer}
                  cosmetics={cosmetics}
                  equipment={equipment}
                  urls={urls}
                  size={46}
                />
              )}
              <div>
                <strong>{selected ? selectedPeerName : "Mensagens"}</strong>
                {selected && <small>Conversa direta</small>}
              </div>
            </div>
            <button
              type="button"
              className="chat-thread-close"
              onClick={() => setOpen(false)}
              aria-label="Fechar mensagens"
            >
              <X />
            </button>
          </header>
          {!selected && (
            <div className="chat-conversation-picker">
              <label>
                Escolha uma conversa
                <select
                  aria-label="Conversa"
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setLimit(50);
                  }}
                >
                  <option value="">Selecione</option>
                  {conversations
                    .filter(
                      (c) =>
                        master ||
                        [c.first_id, c.second_id].includes(actor),
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {[c.first_id, c.second_id]
                          .filter((id) => id !== actor)
                          .map(
                            (id) =>
                              identities.find((i) => i.id === id)?.name ||
                              "Perfil indisponível",
                          )
                          .join(" e ")}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          )}
          <div className="chat-messages">
            {messages.length >= limit && (
              <button onClick={() => setLimit((n) => n + 50)}>
                Carregar anteriores
              </button>
            )}
            {messages.map((m) => {
              const sender = identities.find((i) => i.id === m.sender_id);
              return (
                <div
                  className={
                    m.sender_id === actor ? "chat-message mine" : "chat-message"
                  }
                  key={m.id}
                >
                  <div className="chat-message-author">
                    <IdentityAvatar
                      identity={sender}
                      identityId={m.sender_id}
                      avatarAlt={sender?.name}
                      cosmetics={cosmetics}
                      equipment={equipment}
                      urls={urls}
                      size={30}
                    />
                    <small>{sender?.name || "Perfil indisponível"}</small>
                  </div>
                  {m.media_id ? <ChatImage id={m.media_id} /> : <p>{m.body}</p>}
                  <small>
                    {new Date(m.created_at).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          {canSend && (
            <form
              className="chat-composer"
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy || !body.trim()) return;
                setBusy(true);
                setError("");
                try {
                  await action("message", {
                    conversation_id: selected,
                    body: body.trim(),
                  });
                  setBody("");
                  setRefresh((v) => v + 1);
                  window.dispatchEvent(
                    new CustomEvent("alvorecer:chat-updated", {
                      detail: { campaign },
                    }),
                  );
                } catch (e) {
                  setError(readableErrorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="chat-image-button" aria-label="Enviar imagem">
                <ImagePlus aria-hidden="true" />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file || busy) return;
                    setBusy(true);
                    setError("");
                    try {
                      const blob = await optimizedWebp(file, 800);
                      const db = browserDb();
                      const r = await db.rpc("chat_media_action", {
                        c: campaign,
                        op: "reserve",
                        d: { actor_id: actor, conversation_id: selected },
                      });
                      if (r.error) throw r.error;
                      const upload = await db.storage
                        .from("chat-media")
                        .upload(r.data.path, blob, {
                          contentType: "image/webp",
                        });
                      if (upload.error) throw upload.error;
                      const sent = await db.rpc("chat_media_action", {
                        c: campaign,
                        op: "send",
                        d: { actor_id: actor, media_id: r.data.id },
                      });
                      if (sent.error) throw sent.error;
                      setRefresh((v) => v + 1);
                      window.dispatchEvent(
                        new CustomEvent("alvorecer:chat-updated", {
                          detail: { campaign },
                        }),
                      );
                    } catch (e) {
                      setError(readableErrorMessage(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </label>
              <label className="chat-text-field">
                <span className="visually-hidden">Mensagem</span>
                <textarea
                  required
                  maxLength={4000}
                  rows={1}
                  placeholder="Mensagem..."
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
              <button
                type="submit"
                className="chat-send-button"
                disabled={busy || !body.trim()}
                aria-label="Enviar mensagem"
              >
                <Send aria-hidden="true" />
              </button>
            </form>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </aside>
      )}
    </>
  );
}
