"use client";

import { Activity, Clock3, MessageSquare, Star, Users } from "lucide-react";
import { useMemo, useState } from "react";
import type { Row } from "@/lib/types";

const duration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600),
    minutes = Math.floor((seconds % 3600) / 60);
  return hours
    ? `${hours}h${String(minutes).padStart(2, "0")}`
    : `${minutes}min`;
};

export function ActivityDashboard({
  sessions,
  profiles,
  characters,
}: {
  sessions: Row[];
  profiles: Row[];
  characters: Row[];
}) {
  const now = Date.now(),
    week = now - 7 * 86400000;
  const recent = sessions.filter(
    (session) => Date.parse(session.started_at) >= week,
  );
  const today = recent.filter(
    (session) =>
      new Date(session.started_at).toDateString() === new Date().toDateString(),
  );
  const active = new Set(
    today
      .filter(
        (session) =>
          !session.ended_at &&
          now - Date.parse(session.last_heartbeat_at) < 120000,
      )
      .map((session) => session.user_id),
  ).size;
  const total = recent.reduce(
    (sum, session) => sum + Number(session.active_seconds || 0),
    0,
  );
  const grouped = useMemo(() => {
    const map = new Map<string, Row>();
    for (const session of recent) {
      if (!session.user_id) continue;
      const item = map.get(session.user_id) || {
        user_id: session.user_id,
        seconds: 0,
        accesses: 0,
        last: session.last_interaction_at,
      };
      item.seconds += Number(session.active_seconds || 0);
      item.accesses += 1;
      if (Date.parse(session.last_interaction_at) > Date.parse(item.last))
        item.last = session.last_interaction_at;
      map.set(session.user_id, item);
    }
    return [...map.values()].sort(
      (a, b) => Date.parse(b.last) - Date.parse(a.last),
    );
  }, [recent]);
  return (
    <section className="panel activity-dashboard">
      <div className="spread">
        <div>
          <p className="eyebrow">ATIVIDADE DOS JOGADORES</p>
          <h2>Uso recente</h2>
        </div>
        <Activity size={22} />
      </div>
      <div className="mini-stats">
        <span>
          <Users size={16} />
          <small>Ativos hoje</small>
          <b>{active}</b>
        </span>
        <span>
          <Clock3 size={16} />
          <small>Tempo médio</small>
          <b>
            {duration(recent.length ? Math.floor(total / recent.length) : 0)}
          </b>
        </span>
        <span>
          <Activity size={16} />
          <small>Acessos em 7 dias</small>
          <b>{recent.length}</b>
        </span>
      </div>
      <details>
        <summary>Ver atividade por jogador</summary>
        {grouped.map((item) => {
          const profile = profiles.find(
            (candidate) => candidate.id === item.user_id,
          );
          const character = characters.find(
            (candidate) => candidate.owner_id === item.user_id,
          );
          return (
            <div className="activity-row" key={item.user_id}>
              <div>
                <strong>
                  {character?.name ||
                    profile?.display_name ||
                    item.username_snapshot ||
                    "Jogador"}
                </strong>
                <small>@{profile?.username || "conta removida"}</small>
              </div>
              <span>
                <b>{duration(item.seconds)}</b>
                <small>{item.accesses} acesso(s)</small>
              </span>
              <time>{new Date(item.last).toLocaleString("pt-BR")}</time>
            </div>
          );
        })}
        {!grouped.length && (
          <p className="muted">
            A atividade aparecerá depois que os jogadores interagirem com o
            aplicativo.
          </p>
        )}
      </details>
    </section>
  );
}

export function FeedbackPrompt({
  feedback,
  submit,
}: {
  feedback?: Row;
  submit: (rating: number, comment: string) => Promise<void>;
}) {
  const [rating, setRating] = useState(Number(feedback?.rating || 0));
  const [comment, setComment] = useState(feedback?.comment || "");
  const [saved, setSaved] = useState(Boolean(feedback));
  if (saved) return null;
  return (
    <section className="feedback-prompt">
      <div>
        <MessageSquare size={18} />
        <strong>Como foi usar o Alvorecer hoje?</strong>
      </div>
      <div className="rating-row" aria-label="Avaliação de 1 a 5">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            className={rating === value ? "active" : ""}
            aria-label={`${value} de 5`}
            onClick={() => setRating(value)}
          >
            {["😞", "🙁", "😐", "🙂", "🤩"][value - 1]}
          </button>
        ))}
      </div>
      {rating > 0 && (
        <div className="feedback-comment">
          <input
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={1200}
            placeholder="Comentário opcional"
          />
          <button
            className="primary"
            onClick={async () => {
              await submit(rating, comment);
              setSaved(true);
            }}
          >
            Enviar
          </button>
        </div>
      )}
    </section>
  );
}

export function FeedbackDashboard({ feedback }: { feedback: Row[] }) {
  const average = feedback.length
    ? feedback.reduce((sum, item) => sum + Number(item.rating), 0) /
      feedback.length
    : 0;
  return (
    <section className="panel feedback-dashboard">
      <div className="spread">
        <div>
          <p className="eyebrow">FEEDBACK PÓS-SESSÃO</p>
          <h2>
            {feedback.length
              ? `${average.toFixed(1).replace(".", ",")} de 5`
              : "Sem avaliações"}
          </h2>
        </div>
        <Star size={22} />
      </div>
      {feedback.length > 0 && (
        <div className="rating-distribution">
          {[1, 2, 3, 4, 5].map((rating) => (
            <span key={rating}>
              <small>{rating}</small>
              <i
                style={{
                  height: `${Math.max(5, (feedback.filter((item) => item.rating === rating).length / feedback.length) * 70)}px`,
                }}
              />
              <b>{feedback.filter((item) => item.rating === rating).length}</b>
            </span>
          ))}
        </div>
      )}
      <details>
        <summary>
          Ver comentários ({feedback.filter((item) => item.comment).length})
        </summary>
        {feedback
          .filter((item) => item.comment)
          .slice(0, 20)
          .map((item) => (
            <blockquote key={item.id}>
              <p>{item.comment}</p>
              <small>
                {item.username_snapshot} ·{" "}
                {new Date(item.created_at).toLocaleDateString("pt-BR")}
              </small>
            </blockquote>
          ))}
      </details>
    </section>
  );
}
