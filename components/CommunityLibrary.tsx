"use client";

import Image from "next/image";
import {
  Archive,
  ArrowLeft,
  BookOpen,
  FilePenLine,
  ImagePlus,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { browserDb } from "@/lib/client";
import { uploadCommunityArticleImage } from "@/lib/media";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import type { Row } from "@/lib/types";
import styles from "./CommunityLibrary.module.css";

export type EditorialCategory =
  "world_legends" | "players" | "character_stories" | "world_history";

export const editorialCategories: Record<
  EditorialCategory,
  { title: string; description: string }
> = {
  world_legends: {
    title: "Lendas do Mundo",
    description: "Relatos, mitos e segredos preservados através das eras.",
  },
  players: {
    title: "Jogadores",
    description: "Conheça as jornadas de quem dá vida ao Alvorecer.",
  },
  character_stories: {
    title: "Histórias dos personagens",
    description: "Passados, escolhas e destinos dos personagens da campanha.",
  },
  world_history: {
    title: "História do mundo",
    description: "Reinos, guerras e acontecimentos que moldaram Alvorecer.",
  },
};

const limits = { title: 100, summary: 240, body: 20000 } as const;

export default function CommunityLibrary({
  campaign,
  category,
  master,
}: {
  campaign: string;
  category: EditorialCategory;
  master: boolean;
}) {
  const [articles, setArticles] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const info = editorialCategories[category];

  const load = useCallback(async () => {
    setLoading(true);
    const response = await retryNetworkRead(() => {
      let query = browserDb()
        .from("community_articles")
        .select(
          "id,campaign_id,category,title,summary,body,cover_path,published_at,updated_at,archived_at",
        )
        .eq("campaign_id", campaign)
        .eq("category", category)
        .order("published_at", { ascending: false });
      if (!master) query = query.is("archived_at", null);
      return query;
    });

    if (response.error) {
      setError(readableErrorMessage(response.error));
      setLoading(false);
      return;
    }

    const next = response.data || [];
    setArticles(next);
    setSelected((current) =>
      current
        ? next.find((article) => article.id === current.id) || null
        : null,
    );
    const paths = [
      ...new Set(next.map((article) => article.cover_path).filter(Boolean)),
    ];
    if (paths.length) {
      const signed = await browserDb()
        .storage.from("community-articles")
        .createSignedUrls(paths, 3600);
      if (!signed.error) {
        setCoverUrls(
          Object.fromEntries(
            (signed.data || []).flatMap((entry, index) =>
              entry.signedUrl
                ? [[entry.path || paths[index], entry.signedUrl]]
                : [],
            ),
          ),
        );
      }
    } else setCoverUrls({});
    setError("");
    setLoading(false);
  }, [campaign, category, master]);

  useEffect(() => {
    void load();
    const channel = browserDb()
      .channel(`community-library:${campaign}:${category}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "campaign_events",
          filter: `campaign_id=eq.${campaign}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void browserDb().removeChannel(channel);
    };
  }, [campaign, category, load]);

  const activeArticles = useMemo(
    () => articles.filter((article) => !article.archived_at),
    [articles],
  );
  const archivedArticles = useMemo(
    () => articles.filter((article) => article.archived_at),
    [articles],
  );

  const action = async (op: string, details: Row) => {
    const response = await browserDb().rpc("community_article_action", {
      c: campaign,
      op,
      d: details,
    });
    if (response.error) throw new Error(response.error.message);
    return response.data as Row;
  };

  const archive = async (article: Row, restore = false) => {
    setBusy(true);
    setError("");
    try {
      await action(restore ? "restore" : "archive", { id: article.id });
      if (selected?.id === article.id) setSelected(null);
      await load();
    } catch (caught) {
      setError(readableErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (article: Row) => {
    if (!window.confirm(`Excluir definitivamente “${article.title}”?`)) return;
    setBusy(true);
    setError("");
    try {
      const result = await action("delete", { id: article.id });
      if (result.cover_path)
        await browserDb()
          .storage.from("community-articles")
          .remove([result.cover_path]);
      if (selected?.id === article.id) setSelected(null);
      await load();
    } catch (caught) {
      setError(readableErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return (
      <section className={styles.reader}>
        <button
          type="button"
          className={styles.backButton}
          onClick={() => setSelected(null)}
        >
          <ArrowLeft aria-hidden="true" /> Voltar para {info.title}
        </button>
        <article className={styles.article}>
          <div className={styles.articleCover}>
            {coverUrls[selected.cover_path] && (
              <Image
                src={coverUrls[selected.cover_path]}
                alt={`Capa de ${selected.title}`}
                fill
                sizes="(max-width: 760px) 100vw, 760px"
              />
            )}
            <span />
          </div>
          <header className={styles.articleHeader}>
            <small>{info.title}</small>
            <h1>{selected.title}</h1>
            <p>{selected.summary}</p>
            <time dateTime={selected.published_at}>
              Publicado em {formatDate(selected.published_at)}
            </time>
          </header>
          <div className={styles.articleBody}>{selected.body}</div>
          {master && (
            <div className={styles.articleActions}>
              <button type="button" onClick={() => setEditing(selected)}>
                <Pencil aria-hidden="true" /> Editar
              </button>
              <button type="button" onClick={() => void archive(selected)}>
                <Archive aria-hidden="true" /> Arquivar
              </button>
            </div>
          )}
        </article>
        {editing && (
          <ArticleEditor
            campaign={campaign}
            category={category}
            article={editing === "new" ? null : editing}
            busy={busy}
            close={() => setEditing(null)}
            saved={async () => {
              setEditing(null);
              await load();
            }}
            setBusy={setBusy}
            action={action}
          />
        )}
        {error && <p className={styles.error}>{error}</p>}
      </section>
    );
  }

  return (
    <section className={styles.library}>
      <header className={styles.libraryIntro}>
        <span className={styles.introIcon}>
          <BookOpen aria-hidden="true" />
        </span>
        <div>
          <small>ARQUIVO DE ALVORECER</small>
          <h1>{info.title}</h1>
          <p>{info.description}</p>
        </div>
        {master && (
          <button
            type="button"
            className={styles.writeButton}
            onClick={() => setEditing("new")}
          >
            <Plus aria-hidden="true" /> Escrever história
          </button>
        )}
      </header>

      {loading ? (
        <p className={styles.status}>Abrindo o arquivo...</p>
      ) : activeArticles.length ? (
        <div className={styles.articleGrid}>
          {activeArticles.map((article) => (
            <article className={styles.storyCard} key={article.id}>
              <button type="button" onClick={() => setSelected(article)}>
                <span className={styles.cardCover}>
                  {coverUrls[article.cover_path] && (
                    <Image
                      src={coverUrls[article.cover_path]}
                      alt=""
                      fill
                      sizes="(max-width: 680px) 100vw, 360px"
                    />
                  )}
                  <span className={styles.cardShade} />
                </span>
                <span className={styles.cardCopy}>
                  <small>{formatDate(article.published_at)}</small>
                  <strong>{article.title}</strong>
                  <span>{article.summary}</span>
                  <em>
                    Ler história <BookOpen aria-hidden="true" />
                  </em>
                </span>
              </button>
              {master && (
                <div className={styles.cardActions}>
                  <button type="button" onClick={() => setEditing(article)}>
                    <Pencil aria-hidden="true" /> Editar
                  </button>
                  <button type="button" onClick={() => void archive(article)}>
                    <Archive aria-hidden="true" /> Arquivar
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <BookOpen aria-hidden="true" />
          <h2>Nenhuma história publicada ainda</h2>
          <p>As primeiras páginas desta coleção ainda serão escritas.</p>
        </div>
      )}

      {master && archivedArticles.length > 0 && (
        <details className={styles.archived}>
          <summary>Histórias arquivadas ({archivedArticles.length})</summary>
          <div>
            {archivedArticles.map((article) => (
              <article key={article.id}>
                <span>
                  <strong>{article.title}</strong>
                  <small>{article.summary}</small>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void archive(article, true)}
                >
                  <RotateCcw aria-hidden="true" /> Reativar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(article)}
                >
                  <Trash2 aria-hidden="true" /> Excluir
                </button>
              </article>
            ))}
          </div>
        </details>
      )}

      {editing && (
        <ArticleEditor
          campaign={campaign}
          category={category}
          article={editing === "new" ? null : editing}
          busy={busy}
          close={() => setEditing(null)}
          saved={async () => {
            setEditing(null);
            await load();
          }}
          setBusy={setBusy}
          action={action}
        />
      )}
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}

function ArticleEditor({
  campaign,
  category,
  article,
  busy,
  close,
  saved,
  setBusy,
  action,
}: {
  campaign: string;
  category: EditorialCategory;
  article: Row | null;
  busy: boolean;
  close: () => void;
  saved: () => Promise<void>;
  setBusy: (value: boolean) => void;
  action: (op: string, details: Row) => Promise<Row>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(article?.title || "");
  const [summary, setSummary] = useState(article?.summary || "");
  const [body, setBody] = useState(article?.body || "");
  const [file, setFile] = useState<File | null>(null);
  const [editorError, setEditorError] = useState("");

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!article && !file) {
      setEditorError("Escolha uma imagem de capa");
      return;
    }
    setBusy(true);
    setEditorError("");
    let uploadedPath = "";
    try {
      if (file)
        uploadedPath = await uploadCommunityArticleImage(file, campaign);
      const result = await action(article ? "update" : "create", {
        ...(article ? { id: article.id } : {}),
        category,
        title,
        summary,
        body,
        ...(uploadedPath ? { cover_path: uploadedPath } : {}),
      });
      if (
        uploadedPath &&
        result.previous_cover_path &&
        result.previous_cover_path !== uploadedPath
      )
        await browserDb()
          .storage.from("community-articles")
          .remove([result.previous_cover_path]);
      await saved();
    } catch (caught) {
      if (uploadedPath)
        await browserDb()
          .storage.from("community-articles")
          .remove([uploadedPath]);
      setEditorError(readableErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className={styles.editorDialog}
      aria-labelledby="community-article-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <form onSubmit={submit}>
        <header>
          <span>
            <FilePenLine aria-hidden="true" />
          </span>
          <div>
            <small>PAINEL DO PINK</small>
            <h2 id="community-article-editor-title">
              {article ? "Editar história" : "Escrever história"}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Fechar"
            onClick={close}
            disabled={busy}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <label>
          <span>Título</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            minLength={3}
            maxLength={limits.title}
            required
          />
          <small>
            {title.length}/{limits.title}
          </small>
        </label>

        <label>
          <span>Descrição da publicação</span>
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            minLength={10}
            maxLength={limits.summary}
            rows={3}
            required
          />
          <small>
            {summary.length}/{limits.summary}
          </small>
        </label>

        <label>
          <span>Texto da história</span>
          <textarea
            className={styles.storyInput}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            minLength={50}
            maxLength={limits.body}
            rows={14}
            required
          />
          <small>
            {body.length.toLocaleString("pt-BR")}/
            {limits.body.toLocaleString("pt-BR")}
          </small>
        </label>

        <label className={styles.coverField}>
          <span>
            <ImagePlus aria-hidden="true" /> Imagem de capa
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required={!article}
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
          <small>
            {file
              ? file.name
              : article
                ? "Mantenha vazio para conservar a capa atual"
                : "PNG, JPG ou WebP. A imagem será otimizada automaticamente."}
          </small>
        </label>

        {editorError && (
          <p role="alert" className={styles.error}>
            {editorError}
          </p>
        )}

        <footer>
          <button type="button" onClick={close} disabled={busy}>
            Cancelar
          </button>
          <button
            type="submit"
            className={styles.publishButton}
            disabled={busy}
          >
            {busy
              ? "Salvando..."
              : article
                ? "Salvar alterações"
                : "Publicar história"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}
