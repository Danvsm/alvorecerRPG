"use client";
import { useEffect, useState } from "react";
import { browserDb } from "@/lib/client";
import type { Row } from "@/lib/types";
import IdentityAvatar from "./IdentityAvatar";

export default function ProfileWall({
  campaign,
  profile,
  actor,
  identities,
  cosmetics,
  equipment,
  urls,
  master,
  revision,
}: {
  campaign: string;
  profile: string;
  actor: string;
  identities: Row[];
  cosmetics: Row[];
  equipment: Row[];
  urls: Record<string, string>;
  master: boolean;
  revision: unknown;
}) {
  const [comments, setComments] = useState<Row[]>([]),
    [limit, setLimit] = useState(20),
    [body, setBody] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let valid = true;
    browserDb()
      .from("profile_comments")
      .select("*")
      .eq("campaign_id", campaign)
      .eq("profile_id", profile)
      .order("created_at", { ascending: false })
      .limit(limit)
      .then((r) => {
        if (valid) {
          if (r.error) setError(r.error.message);
          else setComments(r.data || []);
        }
      });
    return () => {
      valid = false;
    };
  }, [campaign, profile, limit, revision, refresh]);
  const action = async (op: string, d: Row) => {
    setBusy(true);
    setError("");
    try {
      const r = await browserDb().rpc("social_action", { c: campaign, op, d });
      if (r.error) throw r.error;
      setRefresh((v) => v + 1);
      if (op === "comment") setBody("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h3>Mural</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action("comment", {
            actor_id: actor,
            recipient_id: profile,
            body,
          });
        }}
      >
        <label>
          Deixe uma mensagem
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            maxLength={2000}
          />
        </label>
        <button disabled={busy || !actor}>Publicar</button>
      </form>
      {comments.map((comment) => {
        const author = identities.find((i) => i.id === comment.author_id);
        return (
          <article className="panel" key={comment.id}>
            <div className="profile-comment-author">
              <IdentityAvatar
                identity={author}
                identityId={comment.author_id}
                avatarAlt={author?.name}
                cosmetics={cosmetics}
                equipment={equipment}
                urls={urls}
                size={36}
              />
              <span>
                <strong>{author?.name || "Perfil indisponível"}</strong>
                <small>
                  {new Date(comment.created_at).toLocaleString("pt-BR")}
                </small>
              </span>
            </div>
            <p style={{ whiteSpace: "pre-wrap" }}>{comment.body}</p>
            {master && (
              <button
                disabled={busy}
                onClick={() =>
                  action("moderate", {
                    id: comment.id,
                    hidden: !comment.hidden,
                  })
                }
              >
                {comment.hidden ? "Reexibir" : "Ocultar"}
              </button>
            )}
          </article>
        );
      })}
      {comments.length >= limit && (
        <button onClick={() => setLimit((n) => n + 20)}>Carregar mais</button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
