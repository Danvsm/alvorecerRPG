"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  ChevronLeft,
  Flag,
  ImagePlus,
  MessageCircle,
  Mic,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import type { Row } from "@/lib/types";
import ChatImage from "./ChatImage";
import ChatAudio from "./ChatAudio";
import IdentityAvatar from "./IdentityAvatar";
import VoiceRecorder from "./VoiceRecorder";
import { optimizedWebp } from "@/lib/media";
import type { ChatAudioPayload } from "@/lib/chat-audio";

function mediaType(message: Row) {
  const relation = message.chat_media;
  const media = Array.isArray(relation) ? relation[0] : relation;
  return media?.media_type === "audio" ? "audio" : "image";
}

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
    [latestByConversation, setLatestByConversation] = useState<
      Record<string, Row>
    >({}),
    [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set()),
    [contactsInteractive, setContactsInteractive] = useState(true),
    [mutedConversations, setMutedConversations] = useState<Set<string>>(
      new Set(),
    ),
    [contactMenu, setContactMenu] = useState<{
      conversationId: string;
      identityId: string;
      name: string;
      x: number;
      y: number;
    } | null>(null),
    [actionDialog, setActionDialog] = useState<{
      type: "clear" | "report";
      conversationId: string;
      identityId: string;
      name: string;
    } | null>(null),
    [reportReason, setReportReason] = useState(""),
    [feedback, setFeedback] = useState(""),
    [messageMenu, setMessageMenu] = useState<{
      message: Row;
      x: number;
      y: number;
    } | null>(null),
    [messageDialog, setMessageDialog] = useState<{
      type: "report" | "delete";
      message: Row;
    } | null>(null),
    [messageReportReason, setMessageReportReason] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceHolding, setVoiceHolding] = useState(false);
  const [position, setPosition] = useState({ right: true, y: 75 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const handledRequestNonce = useRef(requestedPeer?.nonce ?? 0);
  const suppressContactUntil = useRef(0);
  const swallowBubbleClick = useRef(false);
  const contactUnlockTimer = useRef<number | null>(null);
  const contactPress = useRef<{
    timer: number | null;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const releaseVoice = () => setVoiceHolding(false);
    window.addEventListener("pointerup", releaseVoice);
    window.addEventListener("pointercancel", releaseVoice);
    return () => {
      window.removeEventListener("pointerup", releaseVoice);
      window.removeEventListener("pointercancel", releaseVoice);
    };
  }, []);
  const action = async (op: string, d: Row) => {
    const r = await browserDb().rpc("social_action", {
      c: campaign,
      op,
      d: { ...d, actor_id: actor },
    });
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };

  const pushReceivedMessage = async (conversationId: string) => {
    try {
      const sessionResult = await browserDb().auth.getSession();
      const token = sessionResult.data.session?.access_token;
      if (!token) return;

      await fetch("/api/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "chat_message",
          campaign,
          conversationId,
          actorId: actor,
        }),
        keepalive: true,
      });
    } catch {
      // A mensagem continua enviada mesmo se o aviso push falhar.
    }
  };

  const sendVoice = async (payload: ChatAudioPayload) => {
    if (busy || !selected)
      throw new Error("Abra uma conversa para enviar o áudio.");
    setBusy(true);
    setError("");
    try {
      const db = browserDb();
      const sessionResult = await db.auth.getSession();
      const token = sessionResult.data.session?.access_token;
      if (!token) throw new Error("Entre novamente.");

      const reservation = await db.rpc("chat_audio_reserve", {
        c: campaign,
        actor_id: actor,
        conversation_id: selected,
        requested_mime: payload.mimeType,
      });
      if (reservation.error) throw reservation.error;

      const upload = await db.storage
        .from("chat-audio")
        .upload(reservation.data.path, payload.blob, {
          contentType: payload.mimeType,
          cacheControl: "3600",
          upsert: false,
        });
      if (upload.error) throw upload.error;

      const response = await fetch("/api/chat-audio/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          campaign,
          actorId: actor,
          mediaId: reservation.data.id,
          durationMs: payload.durationMs,
          waveform: payload.waveform,
        }),
      });
      const responseText = await response.text();
      let result: Row = {};
      try {
        result = responseText ? JSON.parse(responseText) : {};
      } catch {
        result = {
          error: response.ok
            ? "O servidor respondeu em um formato inesperado."
            : "Não foi possível validar o áudio no servidor.",
        };
      }
      if (!response.ok) {
        throw new Error(result.error || "Não foi possível enviar o áudio.");
      }

      void pushReceivedMessage(selected);
      setRefresh((value) => value + 1);
      window.dispatchEvent(
        new CustomEvent("alvorecer:chat-updated", { detail: { campaign } }),
      );
    } finally {
      setBusy(false);
    }
  };

  const chatControl = async (
    controlAction:
      | "chat_mute"
      | "chat_clear"
      | "chat_report"
      | "chat_message_report"
      | "chat_message_delete",
    conversationId: string,
    extra: Record<string, unknown> = {},
  ) => {
    const sessionResult = await browserDb().auth.getSession();
    const token = sessionResult.data.session?.access_token;
    if (!token) throw new Error("Entre novamente.");

    const response = await fetch("/api/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: controlAction,
        campaign,
        conversationId,
        actorId: actor,
        ...extra,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Não foi possível concluir a ação.");
    }
    return payload as Row;
  };

  const showFeedback = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => {
      setFeedback((current) => (current === message ? "" : current));
    }, 2400);
  };

  const closeContactPress = () => {
    const press = contactPress.current;
    if (press?.timer != null) {
      window.clearTimeout(press.timer);
    }
    contactPress.current = null;
  };

  const openContactMenu = (
    conversationId: string,
    identityId: string,
    name: string,
    clientX: number,
    clientY: number,
  ) => {
    const width = 205;
    const height = 150;
    const x = Math.max(10, Math.min(clientX, window.innerWidth - width - 10));
    const y = Math.max(10, Math.min(clientY, window.innerHeight - height - 10));
    suppressContactUntil.current = performance.now() + 750;
    setContactMenu({ conversationId, identityId, name, x, y });
  };

  const toggleMute = async (
    conversationId: string,
    currentlyMuted: boolean,
  ) => {
    setBusy(true);
    setError("");
    try {
      await chatControl("chat_mute", conversationId, {
        muted: !currentlyMuted,
      });
      setMutedConversations((current) => {
        const next = new Set(current);
        if (currentlyMuted) next.delete(conversationId);
        else next.add(conversationId);
        return next;
      });
      showFeedback(
        currentlyMuted ? "Notificações reativadas." : "Conversa silenciada.",
      );
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy(false);
      setContactMenu(null);
    }
  };

  const confirmClear = async () => {
    if (!actionDialog || actionDialog.type !== "clear") return;
    setBusy(true);
    setError("");
    try {
      await chatControl("chat_clear", actionDialog.conversationId);
      setLatestByConversation((current) => {
        const next = { ...current };
        delete next[actionDialog.conversationId];
        return next;
      });
      if (selected === actionDialog.conversationId) {
        setMessages([]);
      }
      setRefresh((value) => value + 1);
      showFeedback("Conversa limpa.");
      setActionDialog(null);
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const submitReport = async () => {
    if (!actionDialog || actionDialog.type !== "report") return;
    if (reportReason.trim().length < 3) {
      setError("Explique o motivo da denúncia.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await chatControl("chat_report", actionDialog.conversationId, {
        reason: reportReason.trim(),
      });
      setReportReason("");
      setActionDialog(null);
      showFeedback("Denúncia enviada.");
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const openMessageMenu = (message: Row, clientX: number, clientY: number) => {
    const width = 176;
    const height = 104;
    const x = Math.max(10, Math.min(clientX, window.innerWidth - width - 10));
    const y = Math.max(10, Math.min(clientY, window.innerHeight - height - 10));
    setMessageMenu({ message, x, y });
  };

  const deleteOwnMessage = async () => {
    if (!messageDialog || messageDialog.type !== "delete" || !selected) return;

    const target = messageDialog.message;
    setBusy(true);
    setError("");
    try {
      await chatControl("chat_message_delete", selected, {
        messageId: target.id,
      });

      setMessages((current) =>
        current.filter((message) => message.id !== target.id),
      );
      setMessageDialog(null);
      setRefresh((value) => value + 1);
      window.dispatchEvent(
        new CustomEvent("alvorecer:chat-updated", {
          detail: { campaign },
        }),
      );
      showFeedback(target.media_id ? "Anexo excluído." : "Mensagem excluída.");
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const reportMessage = async () => {
    if (!messageDialog || messageDialog.type !== "report" || !selected) return;
    if (messageReportReason.trim().length < 3) {
      setError("Explique o motivo da denúncia.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await chatControl("chat_message_report", selected, {
        messageId: messageDialog.message.id,
        reason: messageReportReason.trim(),
      });
      setMessageReportReason("");
      setMessageDialog(null);
      showFeedback("Mensagem denunciada.");
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    onUnreadChange?.(unread);
  }, [onUnreadChange, unread]);

  useEffect(() => {
    let valid = true;
    retryNetworkRead(() =>
      browserDb()
        .from("conversation_mutes")
        .select("conversation_id")
        .eq("campaign_id", campaign),
    ).then((result) => {
      if (!valid || result.error) return;
      setMutedConversations(
        new Set(
          (result.data || []).map((entry: Row) =>
            String(entry.conversation_id),
          ),
        ),
      );
    });
    return () => {
      valid = false;
    };
  }, [campaign, actor, refresh]);

  useEffect(
    () => () => {
      if (contactUnlockTimer.current !== null) {
        window.clearTimeout(contactUnlockTimer.current);
      }
      closeContactPress();
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
          .select(
            "id,conversation_id,sender_id,body,media_id,created_at,chat_media(media_type)",
          )
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
      .select("*,chat_media(media_type)")
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
        const activityAt = latest?.created_at || conversation?.created_at || "";
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
  }, [actor, conversations, identities, latestByConversation, onlineUserIds]);

  const openContact = async (identityId: string) => {
    if (
      busy ||
      !contactsInteractive ||
      performance.now() < suppressContactUntil.current
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const conversation = await action("conversation", {
        recipient_id: identityId,
      });
      setVoiceOpen(false);
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
    const startToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
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
    setVoiceOpen(false);
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
    setVoiceOpen(false);
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
                  setVoiceOpen(false);
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
                    ? mediaType(latest) === "audio"
                      ? latest.sender_id === actor
                        ? "Você enviou um áudio"
                        : "Enviou um áudio"
                      : latest.sender_id === actor
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
                      onPointerDown={(event) => {
                        if (
                          !conversation ||
                          (event.pointerType === "mouse" && event.button !== 0)
                        ) {
                          return;
                        }
                        closeContactPress();
                        const startX = event.clientX;
                        const startY = event.clientY;
                        const timer = window.setTimeout(() => {
                          if (contactPress.current?.moved) return;
                          openContactMenu(
                            String(conversation.id),
                            String(identity.id),
                            String(identity.name),
                            startX,
                            startY,
                          );
                          if ("vibrate" in navigator) navigator.vibrate(18);
                        }, 520);
                        contactPress.current = {
                          timer,
                          x: startX,
                          y: startY,
                          moved: false,
                        };
                      }}
                      onPointerMove={(event) => {
                        if (!contactPress.current) return;
                        if (
                          Math.abs(event.clientX - contactPress.current.x) +
                            Math.abs(event.clientY - contactPress.current.y) >
                          12
                        ) {
                          contactPress.current.moved = true;
                          closeContactPress();
                        }
                      }}
                      onPointerUp={closeContactPress}
                      onPointerCancel={closeContactPress}
                      onContextMenu={(event) => {
                        if (!conversation) return;
                        event.preventDefault();
                        openContactMenu(
                          String(conversation.id),
                          String(identity.id),
                          String(identity.name),
                          event.clientX,
                          event.clientY,
                        );
                      }}
                      onKeyDown={(event) => {
                        if (
                          !conversation ||
                          !(
                            event.key === "ContextMenu" ||
                            (event.shiftKey && event.key === "F10")
                          )
                        ) {
                          return;
                        }
                        event.preventDefault();
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        openContactMenu(
                          String(conversation.id),
                          String(identity.id),
                          String(identity.name),
                          rect.right - 210,
                          rect.top + 18,
                        );
                      }}
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
                        <span className="chat-contact-meta">
                          {mutedConversations.has(String(conversation.id)) && (
                            <BellOff
                              size={14}
                              aria-label="Conversa silenciada"
                            />
                          )}
                          <time dateTime={activityAt}>
                            {contactTime(activityAt)}
                          </time>
                        </span>
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
          {selected && (
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
                      m.sender_id === actor
                        ? "chat-message mine chat-message-actionable"
                        : "chat-message chat-message-actionable"
                    }
                    key={m.id}
                    role="button"
                    tabIndex={0}
                    aria-label={
                      m.sender_id === actor
                        ? "Abrir opções da sua mensagem"
                        : "Abrir opções da mensagem"
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      openMessageMenu(m, event.clientX, event.clientY);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      openMessageMenu(
                        m,
                        rect.left + rect.width / 2,
                        rect.top + rect.height / 2,
                      );
                    }}
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
                    {m.media_id ? (
                      mediaType(m) === "audio" ? (
                        <ChatAudio id={m.media_id} />
                      ) : (
                        <ChatImage id={m.media_id} />
                      )
                    ) : (
                      <p>{m.body}</p>
                    )}
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
          )}
          {canSend && voiceOpen && (
            <VoiceRecorder
              disabled={busy}
              holding={voiceHolding}
              onClose={() => {
                setVoiceHolding(false);
                setVoiceOpen(false);
              }}
              onSend={sendVoice}
            />
          )}
          {canSend && !voiceOpen && (
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
                  void pushReceivedMessage(selected);
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
              <div className="chat-attachment-actions">
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
                        void pushReceivedMessage(selected);
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
                <button
                  type="button"
                  className="chat-voice-button"
                  onPointerDown={(event) => {
                    if (event.pointerType === "mouse" && event.button !== 0)
                      return;
                    event.preventDefault();
                    setVoiceHolding(true);
                    setVoiceOpen(true);
                  }}
                  disabled={busy}
                  aria-label="Segure para gravar mensagem de voz"
                >
                  <Mic aria-hidden="true" />
                </button>
              </div>
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
          {messageMenu && (
            <>
              <button
                type="button"
                className="chat-context-backdrop"
                aria-label="Fechar opções da mensagem"
                onClick={() => setMessageMenu(null)}
              />
              <div
                className="chat-message-context-menu"
                role="menu"
                style={{ left: messageMenu.x, top: messageMenu.y }}
              >
                {messageMenu.message.sender_id === actor ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setMessageDialog({
                        type: "delete",
                        message: messageMenu.message,
                      });
                      setMessageMenu(null);
                    }}
                  >
                    <Trash2 size={17} />
                    Excluir
                  </button>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setMessageReportReason("");
                      setMessageDialog({
                        type: "report",
                        message: messageMenu.message,
                      });
                      setMessageMenu(null);
                    }}
                  >
                    <Flag size={17} />
                    Denunciar
                  </button>
                )}
              </div>
            </>
          )}

          {contactMenu && (
            <>
              <button
                type="button"
                className="chat-context-backdrop"
                aria-label="Fechar opções da conversa"
                onClick={() => setContactMenu(null)}
              />
              <div
                className="chat-context-menu"
                role="menu"
                style={{ left: contactMenu.x, top: contactMenu.y }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActionDialog({
                      type: "clear",
                      conversationId: contactMenu.conversationId,
                      identityId: contactMenu.identityId,
                      name: contactMenu.name,
                    });
                    setContactMenu(null);
                  }}
                >
                  <Trash2 size={17} />
                  Limpar conversa
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    void toggleMute(
                      contactMenu.conversationId,
                      mutedConversations.has(contactMenu.conversationId),
                    )
                  }
                >
                  {mutedConversations.has(contactMenu.conversationId) ? (
                    <Bell size={17} />
                  ) : (
                    <BellOff size={17} />
                  )}
                  {mutedConversations.has(contactMenu.conversationId)
                    ? "Ativar notificações"
                    : "Silenciar"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setReportReason("");
                    setActionDialog({
                      type: "report",
                      conversationId: contactMenu.conversationId,
                      identityId: contactMenu.identityId,
                      name: contactMenu.name,
                    });
                    setContactMenu(null);
                  }}
                >
                  <Flag size={17} />
                  Denunciar
                </button>
              </div>
            </>
          )}

          {messageDialog?.type === "delete" && (
            <div className="chat-action-backdrop" role="presentation">
              <section
                className="chat-action-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="chat-delete-message-title"
              >
                <div className="chat-action-dialog-icon danger">
                  <Trash2 size={22} />
                </div>
                <h3 id="chat-delete-message-title">
                  {messageDialog.message.media_id
                    ? "Excluir anexo?"
                    : "Excluir mensagem?"}
                </h3>
                <p>Ela será removida para você e para a outra pessoa.</p>
                <div className="chat-action-dialog-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setMessageDialog(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => void deleteOwnMessage()}
                  >
                    {busy ? "Excluindo..." : "Excluir"}
                  </button>
                </div>
              </section>
            </div>
          )}

          {messageDialog?.type === "report" && (
            <div className="chat-action-backdrop" role="presentation">
              <section
                className="chat-action-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="chat-report-message-title"
              >
                <div className="chat-action-dialog-icon">
                  <Flag size={22} />
                </div>
                <h3 id="chat-report-message-title">Denunciar mensagem</h3>
                <p>Conte o motivo da denúncia.</p>
                <label className="chat-report-field">
                  <span className="visually-hidden">Motivo da denúncia</span>
                  <textarea
                    rows={4}
                    maxLength={500}
                    value={messageReportReason}
                    onChange={(event) =>
                      setMessageReportReason(event.target.value)
                    }
                    placeholder="Escreva o motivo..."
                    autoFocus
                  />
                  <small>{messageReportReason.length}/500</small>
                </label>
                <div className="chat-action-dialog-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setMessageReportReason("");
                      setMessageDialog(null);
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy || messageReportReason.trim().length < 3}
                    onClick={() => void reportMessage()}
                  >
                    {busy ? "Enviando..." : "Enviar denúncia"}
                  </button>
                </div>
              </section>
            </div>
          )}

          {actionDialog?.type === "clear" && (
            <div className="chat-action-backdrop" role="presentation">
              <section
                className="chat-action-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="chat-clear-title"
              >
                <div className="chat-action-dialog-icon danger">
                  <Trash2 size={22} />
                </div>
                <h3 id="chat-clear-title">Limpar conversa?</h3>
                <p>
                  Tem certeza que deseja limpar a conversa? As mensagens serão
                  removidas para você e para a outra pessoa.
                </p>
                <div className="chat-action-dialog-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setActionDialog(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => void confirmClear()}
                  >
                    {busy ? "Limpando..." : "Limpar conversa"}
                  </button>
                </div>
              </section>
            </div>
          )}

          {actionDialog?.type === "report" && (
            <div className="chat-action-backdrop" role="presentation">
              <section
                className="chat-action-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="chat-report-title"
              >
                <div className="chat-action-dialog-icon">
                  <Flag size={22} />
                </div>
                <h3 id="chat-report-title">Denunciar conversa</h3>
                <p>Conte o motivo da denúncia.</p>
                <label className="chat-report-field">
                  <span className="visually-hidden">Motivo da denúncia</span>
                  <textarea
                    rows={4}
                    maxLength={500}
                    value={reportReason}
                    onChange={(event) => setReportReason(event.target.value)}
                    placeholder="Escreva o motivo..."
                    autoFocus
                  />
                  <small>{reportReason.length}/500</small>
                </label>
                <div className="chat-action-dialog-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setReportReason("");
                      setActionDialog(null);
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy || reportReason.trim().length < 3}
                    onClick={() => void submitReport()}
                  >
                    {busy ? "Enviando..." : "Enviar denúncia"}
                  </button>
                </div>
              </section>
            </div>
          )}

          {feedback && (
            <p className="chat-action-feedback" role="status">
              {feedback}
            </p>
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
