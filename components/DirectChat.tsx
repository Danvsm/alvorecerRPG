"use client";
import { useEffect, useMemo, useRef, useState } from "react";
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
    [limit, setLimit] = useState(50),
    [latestByConversation, setLatestByConversation] = useState<Record<string, Row>>({}),
    [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set()),
    [contactsInteractive, setContactsInteractive] = useState(true);
  const [position, setPosition] = useState({ right: true, y: 75 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const handledRequestNonce = useRef(requestedPeer?.nonce ?? 0);
  const suppressContactUntil = useRef(0);
  const swallowBubbleClick = useRef(false);
  const contactUnlockTimer = useRef<number | null>(null);
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

  useEffect(
    () => () => {
      if (contactUnlockTimer.current !== null) {
        window.clearTimeout(contactUnlockTimer.current);
      }
    },
    [],
  );
  useEffect(() => {
    if (hideBubble) {
      setOpen(false);
      setSelected("");
      setMessages([]);
    }
  }, [hideBubble]);
  useEffect(() => {
    if (!requestedPeer?.id || !actor) return;
    if (requestedPeer.nonce === handledRequestNonce.current) return;
    handledRequestNonce.current = requestedPeer.nonce;

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
      retryNetworkRead(() =>
        browserDb().rpc("community_presence", { c: campaign }),
      ),
    ]).then(async ([c, r, presence]) => {
      if (!valid) return;
      const failed = [c, r, presence].find((x) => x.error);
      if (failed?.error) {
        setError(readableErrorMessage(failed.error));
        return;
      }

      const nextConversations = c.data || [];
      setConversations(nextConversations);
      setUnread(Number(r.data || 0));
      setOnlineUserIds(
        new Set(
          (presence.data || [])
            .filter((entry: Row) => entry.online)
            .map((entry: Row) => entry.user_id),
        ),
      );

      const ids = nextConversations.map((entry) => entry.id);
      if (!ids.length) {
        setLatestByConversation({});
        return;
      }

      const latestResult = await retryNetworkRead(() =>
        browserDb()
          .from("direct_messages")
          .select("id,conversation_id,sender_id,body,media_id,created_at")
          .in("conversation_id", ids)
          .order("created_at", { ascending: false }),
      );

      if (!valid) return;
      if (latestResult.error) {
        setError(readableErrorMessage(latestResult.error));
        return;
      }

      const latest: Record<string, Row> = {};
      for (const message of latestResult.data || []) {
        if (!latest[message.conversation_id]) {
          latest[message.conversation_id] = message;
        }
      }
      setLatestByConversation(latest);
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

    const actorIdentity = identities.find((identity) => identity.id === actor);

  const contactRows = useMemo(() => {
    const conversationByPeer = new Map<string, Row>();
    for (const conversation of conversations) {
      const peerId =
        conversation.first_id === actor
          ? conversation.second_id
          : conversation.first_id;
      if (peerId) conversationByPeer.set(peerId, conversation);
    }

    return identities
      .filter((identity) => identity.active && identity.id !== actor)
      .map((identity) => {
        const conversation = conversationByPeer.get(identity.id);
        const latest = conversation
          ? latestByConversation[conversation.id]
          : undefined;
        const activityAt =
          latest?.created_at || conversation?.created_at || "";
        const online = Boolean(
          identity.user_id && onlineUserIds.has(identity.user_id),
        );
        return { identity, conversation, latest, activityAt, online };
      })
      .sort((left, right) => {
        const leftHasConversation = Boolean(left.conversation);
        const rightHasConversation = Boolean(right.conversation);

        if (leftHasConversation !== rightHasConversation) {
          return leftHasConversation ? -1 : 1;
        }

        if (leftHasConversation && rightHasConversation) {
          const recent =
            new Date(right.activityAt).getTime() -
            new Date(left.activityAt).getTime();
          if (recent !== 0) return recent;
        }

        if (left.online !== right.online) {
          return left.online ? -1 : 1;
        }

        return String(left.identity.name).localeCompare(
          String(right.identity.name),
          "pt-BR",
        );
      });
  }, [
    actor,
    conversations,
    identities,
    latestByConversation,
    onlineUserIds,
  ]);

  const openContact = async (identityId: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const conversation = await action("conversation", {
        recipient_id: identityId,
      });
      setSelected(conversation.id);
      setLimit(50);
      setRefresh((value) => value + 1);
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const contactTime = (value?: string) => {
    if (!value) return "";
    const date = new Date(value);
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startMessage = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );
    const days = Math.round(
      (startToday.getTime() - startMessage.getTime()) / 86_400_000,
    );
    if (days <= 0) {
      return date.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    if (days === 1) return "Ontem";
    if (days < 7) return `${days} d`;
    return date.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
    });
  };

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

  const lockContactList = () => {
    suppressContactUntil.current = performance.now() + 520;
    setContactsInteractive(false);

    if (contactUnlockTimer.current !== null) {
      window.clearTimeout(contactUnlockTimer.current);
    }

    contactUnlockTimer.current = window.setTimeout(() => {
      suppressContactUntil.current = 0;
      setContactsInteractive(true);
      contactUnlockTimer.current = null;
    }, 520);
  };

  const openChatList = () => {
    lockContactList();
    setSelected("");
    setMessages([]);
    setLimit(50);
    setError("");
    setOpen(true);
  };

  const closeChat = () => {
    if (contactUnlockTimer.current !== null) {
      window.clearTimeout(contactUnlockTimer.current);
      contactUnlockTimer.current = null;
    }
    suppressContactUntil.current = 0;
    setContactsInteractive(true);
    setSelected("");
    setMessages([]);
    setLimit(50);
    setOpen(false);
  };

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
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, moved: false };
          }}
          onPointerMove={(e) => {
            e.stopPropagation();
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
          onPointerUp={(e) => {
            e.preventDefault();
            e.stopPropagation();
            swallowBubbleClick.current = true;
            if (!drag.current?.moved) {
              if (open) closeChat();
              else openChatList();
            }
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            drag.current = null;
          }}
          onPointerCancel={(e) => {
            e.preventDefault();
            e.stopPropagation();
            drag.current = null;
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();

            if (swallowBubbleClick.current) {
              swallowBubbleClick.current = false;
              return;
            }

            if (open) closeChat();
            else openChatList();
          }}
        >
          <MessageCircle />
          {unread > 0 && <span>{unread}</span>}
        </button>
      )}
      {open && (
        <aside
          className="chat-window"
          aria-label="Mensagens diretas"
          onPointerUpCapture={(e) => {
            if (performance.now() < suppressContactUntil.current) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onClickCapture={(e) => {
            if (performance.now() < suppressContactUntil.current) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          <header className="chat-thread-header">
            <button
              type="button"
              className="chat-thread-back"
              onClick={() => {
                if (selected) {
                  lockContactList();
                  setSelected("");
                  setMessages([]);
                  setLimit(50);
                } else {
                  closeChat();
                }
              }}
              aria-label={selected ? "Voltar às conversas" : "Fechar mensagens"}
            >
              <ChevronLeft />
            </button>
            <div className="chat-thread-peer">
              {(selectedPeer || (!selected && actorIdentity)) && (
                <IdentityAvatar
                  identity={selectedPeer || actorIdentity}
                  cosmetics={cosmetics}
                  equipment={equipment}
                  urls={urls}
                  size={46}
                />
              )}
              <div>
                <strong>
                  {selected
                    ? selectedPeerName
                    : actorIdentity?.name || "Mensagens"}
                </strong>
                {selected ? (
                  <small>Conversa direta</small>
                ) : (
                  <small>Mensagens</small>
                )}
              </div>
            </div>
            <button
              type="button"
              className="chat-thread-close"
              onClick={closeChat}
              aria-label="Fechar mensagens"
            >
              <X />
            </button>
          </header>
          {!selected && (
            <div
              className="chat-contact-list"
              aria-label="Lista de conversas"
              data-interactive={contactsInteractive ? "true" : "false"}
            >
              {contactRows.map(
                ({ identity, conversation, latest, activityAt, online }) => {
                  const lastMessage = latest?.media_id
                    ? latest.sender_id === actor
                      ? "Você enviou uma imagem"
                      : "Enviou uma imagem"
                    : latest?.body
                      ? latest.sender_id === actor
                        ? `Você: ${latest.body}`
                        : latest.body
                      : "Iniciar conversa";

                  return (
                    <button
                      type="button"
                      className="chat-contact-row"
                      key={identity.id}
                      disabled={busy || !contactsInteractive}
                      onClick={(e) => {
                        if (performance.now() < suppressContactUntil.current) {
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                        }
                        void openContact(identity.id);
                      }}
                    >
                      <span className="chat-contact-avatar">
                        <IdentityAvatar
                          identity={identity}
                          cosmetics={cosmetics}
                          equipment={equipment}
                          urls={urls}
                          size={72}
                        />
                        {identity.user_id && (
                          <i
                            className={
                              online
                                ? "chat-contact-presence online"
                                : "chat-contact-presence"
                            }
                            aria-label={online ? "Online" : "Offline"}
                          />
                        )}
                      </span>

                      <span className="chat-contact-copy">
                        <strong>{identity.name}</strong>
                        <small>{lastMessage}</small>
                      </span>

                      {conversation && (
                        <time dateTime={activityAt}>
                          {contactTime(activityAt)}
                        </time>
                      )}
                    </button>
                  );
                },
              )}

              {!contactRows.length && (
                <p className="chat-contact-empty">
                  Nenhum perfil disponível para conversar.
                </p>
              )}
            </div>
          )}
          {selected && <div className="chat-messages">
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
          </div>}
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
