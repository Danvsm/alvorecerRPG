"use client";

import { BellRing, Check, MessageCircle, ShieldAlert, Sparkles, Swords, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ensureAlvorecerPushSubscription,
  showAlvorecerNotification,
} from "@/lib/browser-notifications";

const REMINDER_MS = 24 * 60 * 60 * 1000;

export default function NotificationPermissionPrompt({
  userId,
  campaign,
}: {
  userId: string;
  campaign: string;
}) {
  const [open, setOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [result, setResult] = useState<
    "granted" | "denied" | "setup_error" | ""
  >("");

  useEffect(() => {
    if (
      !userId ||
      typeof window === "undefined" ||
      !("Notification" in window)
    ) {
      return;
    }

    if (Notification.permission === "granted") {
      void ensureAlvorecerPushSubscription(campaign).catch(() => {
        setResult("setup_error");
        setOpen(true);
      });
      return;
    }

    const key = `alvorecer:notification-prompt:${userId}`;
    const lastDismissed = Number(window.localStorage.getItem(key) || 0);
    if (
      lastDismissed &&
      Date.now() - lastDismissed < REMINDER_MS
    ) {
      return;
    }

    setResult(Notification.permission === "denied" ? "denied" : "");

    const timer = window.setTimeout(() => setOpen(true), 900);
    return () => window.clearTimeout(timer);
  }, [campaign, userId]);

  const dismiss = () => {
    if (userId) {
      window.localStorage.setItem(
        `alvorecer:notification-prompt:${userId}`,
        String(Date.now()),
      );
    }
    setOpen(false);
  };

  const enable = async () => {
    if (!("Notification" in window)) return;
    setRequesting(true);

    try {
      const permission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      setResult(permission === "granted" ? "granted" : "denied");

      if (permission !== "granted") {
        setResult("denied");
        return;
      }

      window.localStorage.removeItem(
        `alvorecer:notification-prompt:${userId}`,
      );

      const subscription = await ensureAlvorecerPushSubscription(campaign);
      if (!subscription) {
        setResult("setup_error");
        return;
      }

      setResult("granted");

      await showAlvorecerNotification({
        title: "Notificações ativadas",
        body: "Pronto. Este aparelho está registrado para receber avisos mesmo com o Chrome fechado.",
        tag: "alvorecer-permission-test",
      });

      window.setTimeout(() => setOpen(false), 1200);
    } catch {
      setResult("setup_error");
      setOpen(true);
    } finally {
      setRequesting(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="notification-permission-backdrop">
      <section
        aria-labelledby="notification-permission-title"
        aria-modal="true"
        className="notification-permission-card"
        role="dialog"
      >
        <button
          aria-label="Agora não"
          className="notification-permission-close"
          onClick={dismiss}
          type="button"
        >
          <X aria-hidden size={20} />
        </button>

        <div className="notification-permission-icon" aria-hidden="true">
          <span />
          <BellRing size={34} />
        </div>

        {result === "granted" ? (
          <div className="notification-permission-success">
            <span>
              <Check size={22} />
            </span>
            <h2>Experiência completa ativada</h2>
            <p>Agora você pode receber avisos importantes do Alvorecer.</p>
          </div>
        ) : result === "setup_error" ? (
          <>
            <p className="notification-permission-eyebrow">NOTIFICAÇÕES</p>
            <h2 id="notification-permission-title">
              Falta concluir o registro deste aparelho
            </h2>
            <p className="notification-permission-lead">
              A permissão do navegador está liberada, mas o aparelho ainda não
              conseguiu criar a assinatura de push necessária para receber
              avisos com o Chrome fechado.
            </p>
            <button
              className="notification-permission-primary"
              disabled={requesting}
              onClick={() => void enable()}
              type="button"
            >
              <BellRing size={20} />
              {requesting ? "Tentando..." : "Tentar novamente"}
            </button>
            <button
              className="notification-permission-secondary"
              disabled={requesting}
              onClick={dismiss}
              type="button"
            >
              Agora não
            </button>
          </>
        ) : result === "denied" ? (
          <>
            <p className="notification-permission-eyebrow">NOTIFICAÇÕES</p>
            <h2 id="notification-permission-title">
              Você ainda está sem as notificações do Alvorecer
            </h2>
            <p className="notification-permission-lead">
              Se você mudou de ideia, ainda dá para ativar. Como o navegador já
              bloqueou a permissão, libere as notificações nas configurações do
              navegador para receber mensagens e avisos importantes.
            </p>
            <button
              className="notification-permission-secondary full"
              onClick={dismiss}
              type="button"
            >
              Entendi
            </button>
          </>
        ) : (
          <>
            <p className="notification-permission-eyebrow">
              NÃO FIQUE FORA DA AVENTURA
            </p>
            <h2 id="notification-permission-title">
              Ative as notificações para viver o Alvorecer por completo
            </h2>
            <p className="notification-permission-lead">
              Mensagens, acontecimentos da campanha e avisos importantes podem
              acontecer a qualquer momento. Ative agora para não descobrir tudo
              tarde demais.
            </p>

            <div className="notification-permission-benefits">
              <div>
                <span><MessageCircle size={19} /></span>
                <p>
                  <strong>Mensagens importantes</strong>
                  <small>Saiba quando alguém procurar você.</small>
                </p>
              </div>
              <div>
                <span><Swords size={19} /></span>
                <p>
                  <strong>Momentos da campanha</strong>
                  <small>Não perca movimentações e acontecimentos relevantes.</small>
                </p>
              </div>
              <div>
                <span><Sparkles size={19} /></span>
                <p>
                  <strong>Recompensas e novidades</strong>
                  <small>Receba avisos quando algo novo chegar para você.</small>
                </p>
              </div>
            </div>

            <button
              className="notification-permission-primary"
              disabled={requesting}
              onClick={() => void enable()}
              type="button"
            >
              <BellRing size={20} />
              {requesting ? "Ativando..." : "Ativar notificações"}
            </button>

            <button
              className="notification-permission-secondary"
              disabled={requesting}
              onClick={dismiss}
              type="button"
            >
              Agora não
            </button>

            <p className="notification-permission-footnote">
              <ShieldAlert size={14} />
              Você continua no controle e pode desativar quando quiser nas
              configurações do navegador.
            </p>
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}
