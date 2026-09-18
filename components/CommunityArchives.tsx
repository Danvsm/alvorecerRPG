"use client";

import Image from "next/image";
import { Archive, Clock, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import type { Row } from "@/lib/types";
import styles from "./CommunityPanel.module.css";

type ArchivedPost = Row & {
  id: string;
  author_name: string;
  author_username?: string;
  image_path: string;
  caption: string;
  created_at: string;
  archived_at: string;
  expires_at: string;
};

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const remainingTime = (expiresAt: string, now: number) => {
  const milliseconds = Math.max(0, new Date(expiresAt).getTime() - now);
  const totalMinutes = Math.ceil(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
};

export default function CommunityArchives({ campaign }: { campaign: string }) {
  const [posts, setPosts] = useState<ArchivedPost[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const response = await retryNetworkRead(() =>
      browserDb().rpc("community_archived_posts", { c: campaign }),
    );
    if (response.error) {
      setError(readableErrorMessage(response.error));
      setLoading(false);
      return;
    }

    const loaded = (response.data || []) as ArchivedPost[];
    setPosts(loaded);
    if (!loaded.length) {
      setUrls({});
      setLoading(false);
      return;
    }

    const signed = await browserDb()
      .storage.from("community-posts")
      .createSignedUrls(
        loaded.map((post) => post.image_path),
        3600,
      );
    if (signed.error) setError(readableErrorMessage(signed.error));
    else
      setUrls(
        Object.fromEntries(
          loaded.map((post, index) => [
            post.id,
            signed.data?.[index]?.signedUrl || "",
          ]),
        ),
      );
    setLoading(false);
  }, [campaign]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <section className={styles.archives} aria-labelledby="archives-title">
      <div className={styles.archivesHeading}>
        <span>
          <Archive aria-hidden="true" />
        </span>
        <div>
          <small>ÁREA EXCLUSIVA DO MESTRE</small>
          <h1 id="archives-title">Arquivos</h1>
          <p>
            Publicações excluídas pelos jogadores permanecem aqui por 24 horas.
          </p>
        </div>
      </div>

      {loading && (
        <p className={styles.feedStatus}>
          <LoaderCircle aria-hidden="true" /> Carregando arquivos...
        </p>
      )}

      {!loading && !posts.length && !error && (
        <div className={styles.emptyFeed}>
          <Archive aria-hidden="true" />
          <strong>Nenhuma publicação arquivada.</strong>
          <span>Exclusões feitas pelo Mestre não passam por esta área.</span>
        </div>
      )}

      <div className={styles.archiveGrid}>
        {posts.map((post) => (
          <article className={styles.archiveCard} key={post.id}>
            {urls[post.id] && (
              <Image
                src={urls[post.id]}
                width={900}
                height={900}
                sizes="(max-width: 700px) 100vw, 420px"
                alt={`Publicação arquivada de ${post.author_name}`}
                unoptimized
              />
            )}
            <div className={styles.archiveDetails}>
              <strong>{post.author_name}</strong>
              <span>
                {post.author_username
                  ? `@${post.author_username}`
                  : "Sem username"}
              </span>
              <p>{post.caption}</p>
              <dl>
                <div>
                  <dt>Publicada</dt>
                  <dd>{dateTime.format(new Date(post.created_at))}</dd>
                </div>
                <div>
                  <dt>Excluída</dt>
                  <dd>{dateTime.format(new Date(post.archived_at))}</dd>
                </div>
              </dl>
              <em>
                <Clock aria-hidden="true" /> Exclusão definitiva em{" "}
                {remainingTime(post.expires_at, now)}
              </em>
            </div>
          </article>
        ))}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
