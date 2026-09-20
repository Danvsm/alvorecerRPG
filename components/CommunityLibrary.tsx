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
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
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
  currentUserId,
  master,
}: {
  campaign: string;
  category: EditorialCategory;
  currentUserId: string;
  master: boolean;
}) {
  const [articles, setArticles] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [actionTarget, setActionTarget] = useState<Row | null>(null);
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [playerArticleCount, setPlayerArticleCount] = useState(0);
  const coverObjectUrls = useRef<Record<string, string>>({});
  const holdTimer = useRef<number | null>(null);
  const holdStart = useRef({ x: 0, y: 0 });
  const holdTriggered = useRef(false);
  const info = editorialCategories[category];

  const cancelHold = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const startHold = (event: ReactPointerEvent, article: Row) => {
    if (!canEditArticle(article) || event.button !== 0) return;
    cancelHold();
    holdTriggered.current = false;
    holdStart.current = { x: event.clientX, y: event.clientY };
    holdTimer.current = window.setTimeout(() => {
      holdTriggered.current = true;
      setActionTarget(article);
      navigator.vibrate?.(24);
      holdTimer.current = null;
    }, 550);
  };

  const moveHold = (event: ReactPointerEvent) => {
    if (
      Math.abs(event.clientX - holdStart.current.x) > 10 ||
      Math.abs(event.clientY - holdStart.current.y) > 10
    )
      cancelHold();
  };

  useEffect(
    () => () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [response, statusResponse] = await Promise.all([
      retryNetworkRead(() => {
        let query = browserDb()
          .from("community_articles")
          .select(
            "id,campaign_id,category,title,summary,body,cover_path,created_by,published_at,updated_at,archived_at",
          )
          .eq("campaign_id", campaign)
          .eq("category", category)
          .order("published_at", { ascending: false });
        if (!master) query = query.is("archived_at", null);
        return query;
      }),
      category === "players" && !master
        ? retryNetworkRead(() =>
            browserDb().rpc("community_article_player_status", { c: campaign }),
          )
        : Promise.resolve(null),
    ]);

    if (response.error || statusResponse?.error) {
      setError(readableErrorMessage(response.error || statusResponse?.error));
      setLoading(false);
      return;
    }

    setPlayerArticleCount(Number((statusResponse?.data as Row)?.count || 0));

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
    const loadedCovers = await Promise.all(
      paths.map(async (path) => {
        const downloaded = await browserDb()
          .storage.from("community-articles")
          .download(path);
        return downloaded.error || !downloaded.data
          ? ([path, ""] as const)
          : ([path, URL.createObjectURL(downloaded.data)] as const);
      }),
    );
    const nextCoverUrls = Object.fromEntries(
      loadedCovers.filter((entry) => entry[1]),
    );
    Object.values(coverObjectUrls.current).forEach((url) =>
      URL.revokeObjectURL(url),
    );
    coverObjectUrls.current = nextCoverUrls;
    setCoverUrls(nextCoverUrls);
    setError(
      paths.length > Object.keys(nextCoverUrls).length
        ? "Uma ou mais capas não puderam ser carregadas. Tente abrir novamente."
        : "",
    );
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
      Object.values(coverObjectUrls.current).forEach((url) =>
        URL.revokeObjectURL(url),
      );
      coverObjectUrls.current = {};
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
  const canEditArticle = useCallback(
    (article: Row) =>
      master ||
      (category === "players" && article.created_by === currentUserId),
    [category, currentUserId, master],
  );
  const playerLimitReached = !master && playerArticleCount >= 3;
  const canWrite = master || (category === "players" && !playerLimitReached);

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
      setActionTarget(null);
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
      setActionTarget(null);
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
                width={1600}
                height={850}
                sizes="(max-width: 760px) 100vw, 760px"
                unoptimized
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
        </article>
        {editing && (
          <ArticleEditor
            campaign={campaign}
            category={category}
            article={editing === "new" ? null : editing}
            currentUserId={currentUserId}
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
        {(master || category === "players") && (
          <button
            type="button"
            className={styles.writeButton}
            disabled={!canWrite}
            onClick={() => setEditing("new")}
          >
            <Plus aria-hidden="true" />
            {playerLimitReached ? "Limite de 3 atingido" : "Escrever história"}
          </button>
        )}
      </header>

      {!master && category === "players" && (
        <p className={styles.playerLimit}>
          Você publicou {playerArticleCount} de 3 histórias permitidas.
        </p>
      )}

      {(master || activeArticles.some(canEditArticle)) &&
        activeArticles.length > 0 && (
          <p className={styles.manageHint}>
            {master
              ? "Segure um card para gerenciar."
              : "Segure uma história sua para editar."}
          </p>
        )}

      {loading ? (
        <p className={styles.status}>Abrindo o arquivo...</p>
      ) : activeArticles.length ? (
        <div className={styles.articleGrid}>
          {activeArticles.map((article) => (
            <article className={styles.storyCard} key={article.id}>
              <button
                type="button"
                onClick={() => {
                  if (holdTriggered.current) {
                    holdTriggered.current = false;
                    return;
                  }
                  setSelected(article);
                }}
                onPointerDown={(event) => startHold(event, article)}
                onPointerMove={moveHold}
                onPointerUp={cancelHold}
                onPointerCancel={cancelHold}
                onPointerLeave={cancelHold}
                onContextMenu={(event) => {
                  if (!canEditArticle(article)) return;
                  event.preventDefault();
                  cancelHold();
                  setActionTarget(article);
                }}
              >
                <span className={styles.cardCover}>
                  {coverUrls[article.cover_path] && (
                    <Image
                      src={coverUrls[article.cover_path]}
                      alt=""
                      width={1600}
                      height={1000}
                      sizes="(max-width: 680px) 100vw, 360px"
                      unoptimized
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
          currentUserId={currentUserId}
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
      {actionTarget && (
        <ArticleActions
          article={actionTarget}
          busy={busy}
          close={() => setActionTarget(null)}
          edit={() => {
            setEditing(actionTarget);
            setActionTarget(null);
          }}
          archive={master ? () => void archive(actionTarget) : undefined}
          remove={master ? () => void remove(actionTarget) : undefined}
        />
      )}
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}

function ArticleActions({
  article,
  busy,
  close,
  edit,
  archive,
  remove,
}: {
  article: Row;
  busy: boolean;
  close: () => void;
  edit: () => void;
  archive?: () => void;
  remove?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.actionDialog}
      aria-labelledby="community-article-actions-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) close();
      }}
    >
      <div>
        <span className={styles.actionGrip} aria-hidden="true" />
        <header>
          <small>GERENCIAR PUBLICAÇÃO</small>
          <h2 id="community-article-actions-title">{article.title}</h2>
        </header>
        <button type="button" onClick={edit} disabled={busy}>
          <Pencil aria-hidden="true" />
          <span>
            <strong>Editar</strong>
            <small>Alterar texto, descrição ou imagem</small>
          </span>
        </button>
        {archive && (
          <button type="button" onClick={archive} disabled={busy}>
            <Archive aria-hidden="true" />
            <span>
              <strong>Arquivar</strong>
              <small>Ocultar sem apagar a publicação</small>
            </span>
          </button>
        )}
        {remove && (
          <button
            type="button"
            className={styles.destructiveAction}
            onClick={remove}
            disabled={busy}
          >
            <Trash2 aria-hidden="true" />
            <span>
              <strong>Excluir</strong>
              <small>Remover definitivamente</small>
            </span>
          </button>
        )}
        <button
          type="button"
          className={styles.cancelAction}
          onClick={close}
          disabled={busy}
        >
          Cancelar
        </button>
      </div>
    </dialog>
  );
}

function ArticleEditor({
  campaign,
  category,
  article,
  currentUserId,
  busy,
  close,
  saved,
  setBusy,
  action,
}: {
  campaign: string;
  category: EditorialCategory;
  article: Row | null;
  currentUserId: string;
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
        uploadedPath = await uploadCommunityArticleImage(
          file,
          campaign,
          article?.created_by || currentUserId,
        );
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
            <small>{article ? "EDIÇÃO DA HISTÓRIA" : "NOVA HISTÓRIA"}</small>
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
