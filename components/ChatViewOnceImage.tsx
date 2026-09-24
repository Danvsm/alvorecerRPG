"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, TimerReset } from "lucide-react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage } from "@/lib/network";

export default function ChatViewOnceImage({
  id,
  campaign,
  actor,
  mine,
}: {
  id: string;
  campaign: string;
  actor: string;
  mine: boolean;
}) {
  const [expired, setExpired] = useState(false);
  const [opening, setOpening] = useState(false);
  const [url, setUrl] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const openedRef = useRef(false);
  const consumedRef = useRef(false);

  useEffect(() => {
    let valid = true;
    void browserDb()
      .from("chat_media")
      .select(
        "deleted_at,removed_from_chat_at,view_once_opened_at,view_once_expires_at",
      )
      .eq("id", id)
      .single()
      .then((result) => {
        if (!valid || result.error) return;
        const deadline = result.data.view_once_expires_at
          ? Date.parse(result.data.view_once_expires_at)
          : 0;
        if (
          result.data.deleted_at ||
          result.data.removed_from_chat_at ||
          (deadline > 0 && deadline <= Date.now())
        ) {
          setExpired(true);
        }
      });
    return () => {
      valid = false;
    };
  }, [id]);

  const consume = useCallback(async () => {
    if (!openedRef.current || consumedRef.current || mine) return;
    consumedRef.current = true;
    setUrl("");
    setSeconds(0);
    setExpired(true);
    await browserDb()
      .rpc("chat_media_action", {
        c: campaign,
        op: "consume_once",
        d: { actor_id: actor, media_id: id },
      })
      .catch(() => {});
  }, [actor, campaign, id, mine]);

  useEffect(() => {
    if (!url || seconds <= 0) return;
    const timer = window.setInterval(() => {
      setSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          void consume();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [consume, seconds, url]);

  useEffect(
    () => () => {
      if (openedRef.current && !consumedRef.current) void consume();
    },
    [consume],
  );

  const open = async () => {
    if (mine || expired || opening || url) return;
    setOpening(true);
    setError("");
    try {
      const db = browserDb();
      const result = await db.rpc("chat_media_action", {
        c: campaign,
        op: "open_once",
        d: { actor_id: actor, media_id: id },
      });
      if (result.error) throw result.error;
      if (result.data?.expired || !result.data?.path) {
        setExpired(true);
        return;
      }

      const remaining = Math.max(
        1,
        Math.min(7, Number(result.data.seconds || 7)),
      );
      const signed = await db.storage
        .from("chat-media")
        .createSignedUrl(String(result.data.path), remaining);
      if (signed.error) throw signed.error;

      openedRef.current = true;
      setSeconds(remaining);
      setUrl(signed.data.signedUrl);
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setOpening(false);
    }
  };

  const label = mine
    ? "Foto de visualização única enviada"
    : expired
      ? "Foto de visualização única visualizada"
      : "Foto de visualização única";

  return (
    <>
      <button
        type="button"
        className="chat-view-once-message"
        disabled={mine || expired || opening}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void open();
        }}
      >
        <span className="chat-view-once-symbol">
          <TimerReset aria-hidden="true" />
          <b>1</b>
        </span>
        <span>
          <strong>{label}</strong>
          {!mine && !expired && (
            <small>{opening ? "Abrindo..." : "Toque para visualizar"}</small>
          )}
          {error && <small>{error}</small>}
        </span>
        {!mine && !expired && <Eye aria-hidden="true" />}
      </button>

      {url &&
        typeof document !== "undefined" &&
        createPortal(
          <section
            className="chat-view-once-overlay"
            aria-label="Foto de visualização única"
            role="dialog"
            aria-modal="true"
          >
            <header>
              <span>
                <TimerReset aria-hidden="true" />
                Visualização única
              </span>
              <strong>{seconds}s</strong>
            </header>
            <div className="chat-view-once-photo">
              <img
                src={url}
                alt="Foto de visualização única"
                draggable={false}
                onContextMenu={(event) => event.preventDefault()}
              />
            </div>
            <p>A foto desaparecerá automaticamente.</p>
          </section>,
          document.body,
        )}
    </>
  );
}
