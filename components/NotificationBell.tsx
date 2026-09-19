"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Bell,
  Check,
  ChevronRight,
  Coins,
  Gift,
  Mail,
  Sparkles,
  Trash2,
  Megaphone,
  Swords,
  AlertTriangle,
} from "lucide-react";
import type { Row } from "@/lib/types";

type NotificationFilter = "all" | "unread";
type NotificationGroup = "Hoje" | "Ontem" | "Mais antigas";

const GROUP_ORDER: NotificationGroup[] = ["Hoje", "Ontem", "Mais antigas"];
const notificationKinds: Record<
  string,
  {
    Icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
    subtitle: string;
  }
> = {
  message: { Icon: Mail, subtitle: "Você recebeu uma nova mensagem." },
  reward: {
    Icon: Gift,
    subtitle: "Uma nova recompensa foi adicionada ao seu personagem.",
  },
  wallet: { Icon: Coins, subtitle: "Houve uma atualização na sua carteira." },
  cosmetic: {
    Icon: Sparkles,
    subtitle: "Um novo item foi adicionado à sua coleção.",
  },
  announcement: {
    Icon: Megaphone,
    subtitle: "Você recebeu um novo aviso do mestre.",
  },
  event: {
    Icon: Swords,
    subtitle: "Um novo acontecimento da campanha espera por você.",
  },
  warning: {
    Icon: AlertTriangle,
    subtitle: "Um aviso importante precisa da sua atenção.",
  },
};

function calendarDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function groupForDate(value: string, now = new Date()): NotificationGroup {
  const today = calendarDay(now);
  const day = calendarDay(new Date(value));
  const difference = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (difference <= 0) return "Hoje";
  if (difference === 1) return "Ontem";
  return "Mais antigas";
}

function notificationTime(value: string, group: NotificationGroup) {
  const date = new Date(value);
  if (group === "Mais antigas") {
    return date.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
    });
  }
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotificationBell({
  notifications,
  save,
}: {
  notifications: Row[];
  save: (op: string, d: Row) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(20);

  const visible = useMemo(
    () =>
      notifications
        .filter((notification) => !notification.dismissed_at)
        .toSorted((a, b) =>
          String(b.created_at).localeCompare(String(a.created_at)),
        ),
    [notifications],
  );
  const unreadCount = visible.filter(
    (notification) => !notification.read_at,
  ).length;

  const filtered = useMemo(
    () =>
      filter === "unread"
        ? visible.filter((notification) => !notification.read_at)
        : visible,
    [filter, visible],
  );
  const grouped = useMemo(() => {
    const groups = new Map<NotificationGroup, Row[]>();
    filtered.slice(0, limit).forEach((notification) => {
      const group = groupForDate(String(notification.created_at));
      groups.set(group, [...(groups.get(group) || []), notification]);
    });
    return groups;
  }, [filtered, limit]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const run = async (op: string, data: Row = {}) => {
    setBusy(true);
    setError("");
    try {
      await save(op, data);
    } catch (caughtError) {
      setError((caughtError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chooseFilter = (nextFilter: NotificationFilter) => {
    setFilter(nextFilter);
    setLimit(20);
  };

  return (
    <div className="notification-container">
      <button
        aria-label="Notificações"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Bell size={19} />
        {unreadCount || ""}
      </button>

      {open &&
        createPortal(
          <section
            aria-labelledby="notification-title"
            aria-modal="true"
            className="notification-panel"
            role="dialog"
          >
            <div className="notification-screen">
              <header className="notification-header">
                <button
                  aria-label="Voltar"
                  className="notification-back"
                  onClick={() => setOpen(false)}
                >
                  <ArrowLeft aria-hidden size={25} />
                </button>

                <div className="notification-heading">
                  <h2 id="notification-title">Notificações</h2>
                  <p>Acompanhe tudo que acontece no seu mundo.</p>
                </div>

                <div className="notification-header-actions">
                  <button
                    aria-label="Marcar todas como lidas"
                    className="notification-round-action"
                    disabled={busy || unreadCount === 0}
                    onClick={() => run("notification_read_all")}
                  >
                    <span>
                      <Check aria-hidden size={22} />
                    </span>
                    <small>
                      Marcar todas
                      <br />
                      como lidas
                    </small>
                  </button>
                  <button
                    aria-label="Limpar notificações"
                    className="notification-round-action"
                    disabled={busy || visible.length === 0}
                    onClick={() => run("notification_clear")}
                  >
                    <span>
                      <Trash2 aria-hidden size={21} />
                    </span>
                    <small>
                      Limpar
                      <br />
                      tudo
                    </small>
                  </button>
                </div>
              </header>

              <nav
                aria-label="Filtros de notificações"
                className="notification-tabs"
              >
                <button
                  aria-pressed={filter === "all"}
                  className="notification-tab"
                  onClick={() => chooseFilter("all")}
                >
                  <Bell aria-hidden size={19} />
                  Todas
                  {unreadCount > 0 && <strong>{unreadCount}</strong>}
                </button>
                <button
                  aria-pressed={filter === "unread"}
                  className="notification-tab"
                  onClick={() => chooseFilter("unread")}
                >
                  <Bell aria-hidden size={19} />
                  Não lidas
                </button>
              </nav>

              <div aria-live="polite" className="notification-groups">
                {GROUP_ORDER.map((group) => {
                  const entries = grouped.get(group);
                  if (!entries?.length) return null;
                  return (
                    <section className="notification-group" key={group}>
                      <h3>{group}</h3>
                      <div className="notification-list">
                        {entries.map((notification) => {
                          const kind = String(notification.kind || "default");
                          const style = notificationKinds[kind] || {
                            Icon: Bell,
                            subtitle:
                              "Uma nova atualização aconteceu no seu mundo.",
                          };
                          const Icon = style.Icon;
                          const unread = !notification.read_at;
                          return (
                            <button
                              className="notification-card"
                              data-kind={kind}
                              data-unread={unread || undefined}
                              disabled={busy}
                              key={String(notification.id)}
                              onClick={() =>
                                unread &&
                                run("notification_read", {
                                  id: notification.id,
                                })
                              }
                            >
                              <span className="notification-symbol">
                                <Icon aria-hidden size={25} />
                              </span>
                              {unread && (
                                <span
                                  aria-label="Não lida"
                                  className="notification-unread-dot"
                                />
                              )}
                              <span className="notification-copy">
                                <strong>
                                  {String(
                                    notification.title || "Nova notificação",
                                  )}
                                </strong>
                                <span>
                                  {String(notification.body || style.subtitle)}
                                </span>
                              </span>
                              <time dateTime={String(notification.created_at)}>
                                {notificationTime(
                                  String(notification.created_at),
                                  group,
                                )}
                              </time>
                              <ChevronRight
                                aria-hidden
                                className="notification-chevron"
                                size={22}
                              />
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}

                {!filtered.length && (
                  <div className="notification-empty">
                    <Bell aria-hidden size={30} />
                    <strong>
                      {filter === "unread"
                        ? "Tudo em dia"
                        : "Nenhuma notificação"}
                    </strong>
                    <p>
                      {filter === "unread"
                        ? "Você não possui notificações não lidas."
                        : "As novidades do seu mundo aparecerão aqui."}
                    </p>
                  </div>
                )}

                {filtered.length > limit && (
                  <button
                    className="notification-load-more"
                    onClick={() => setLimit((current) => current + 20)}
                  >
                    Carregar mais
                  </button>
                )}
                {error && (
                  <p className="notification-error" role="alert">
                    {error}
                  </p>
                )}
              </div>
            </div>
          </section>,
          document.body,
        )}
    </div>
  );
}
