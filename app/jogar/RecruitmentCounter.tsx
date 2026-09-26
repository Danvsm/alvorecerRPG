"use client";

import { useEffect, useState } from "react";
import { Users, X } from "lucide-react";
import styles from "./recruitment-counter.module.css";

const dismissalKey = "alvorecer-recruitment-counter-dismissed";

export default function RecruitmentCounter({ refreshKey }: { refreshKey: boolean }) {
  const [total, setTotal] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [nearForm, setNearForm] = useState(false);

  useEffect(() => {
    try { setDismissed(sessionStorage.getItem(dismissalKey) === "1"); }
    catch { setDismissed(false); }
    const form = document.getElementById("inscricao");
    if (!form || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => setNearForm(entry.isIntersecting));
    observer.observe(form);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (dismissed) return;
    let active = true;
    let controller: AbortController | null = null;
    async function refresh() {
      if (document.visibilityState !== "visible" || controller) return;
      controller = new AbortController();
      try {
        const response = await fetch("/api/interesse/contagem", {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unavailable");
        const data = await response.json();
        if (active && Number.isSafeInteger(data.total) && data.total >= 0) setTotal(data.total);
      } catch {
        if (active) setTotal(null);
      } finally { controller = null; }
    }
    void refresh();
    const interval = window.setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [dismissed, refreshKey]);

  function dismiss() {
    setDismissed(true);
    try { sessionStorage.setItem(dismissalKey, "1"); } catch {}
  }

  if (dismissed || nearForm || total === null) return null;
  return (
    <aside className={styles.notice} aria-label="Jogadores pré-inscritos">
      <span className={styles.icon}><Users size={20} aria-hidden="true" /></span>
      <div className={styles.copy}>
        <span><i className={styles.liveDot} aria-hidden="true" /> A aventura já começou</span>
        <strong><span key={total} className={styles.number}>{total.toLocaleString("pt-BR")}</span> Jogadores pré-inscritos</strong>
        <small>Faça parte dessa história.</small>
      </div>
      <button type="button" onClick={dismiss} aria-label="Fechar aviso de jogadores pré-inscritos" className={styles.close}>
        <X size={18} aria-hidden="true" />
      </button>
    </aside>
  );
}
