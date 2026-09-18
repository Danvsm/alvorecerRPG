"use client";
import { useState } from "react";
import { Bell } from "lucide-react";
import type { Row } from "@/lib/types";

export default function NotificationBell({
  notifications,
  save,
}: {
  notifications: Row[];
  save: (op: string, d: Row) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [limit, setLimit] = useState(20);
  const visible = notifications
    .filter((n) => !n.dismissed_at)
    .toSorted((a, b) => b.created_at.localeCompare(a.created_at));
  const run = async (op: string, d: Row = {}) => {
    setBusy(true);
    setError("");
    try {
      await save(op, d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="notification-container">
      <button
        aria-label="Notificações"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={19} />
        {visible.filter((n) => !n.read_at).length || ""}
      </button>
      {open && (
        <section className="notification-panel panel">
          <div className="spread">
            <h2>Notificações</h2>
            <button onClick={() => setOpen(false)}>Fechar</button>
          </div>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => run("notification_read_all")}
            >
              Marcar todas como lidas
            </button>
            <button disabled={busy} onClick={() => run("notification_clear")}>
              Limpar notificações
            </button>
          </div>
          {visible.slice(0, limit).map((n) => (
            <div className="list-row" key={n.id}>
              <div>
                <p>{n.title}</p>
                <small>{new Date(n.created_at).toLocaleString("pt-BR")}</small>
              </div>
              {!n.read_at && (
                <button
                  disabled={busy}
                  onClick={() => run("notification_read", { id: n.id })}
                >
                  Marcar como lida
                </button>
              )}
            </div>
          ))}
          {!visible.length && <p>Nenhuma notificação.</p>}
          {visible.length > limit && (
            <button onClick={() => setLimit((n) => n + 20)}>
              Carregar mais
            </button>
          )}
          {error && <p role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}
