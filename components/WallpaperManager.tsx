"use client";

import {
  Archive,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { browserDb } from "@/lib/client";
import { uploadProfileWallpaper } from "@/lib/media";
import { versionedImageUrl } from "@/lib/image-cache";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import type { Row } from "@/lib/types";
import styles from "./WallpaperManager.module.css";

type Wallpaper = {
  id: string;
  campaign_id: string;
  name: string;
  storage_path: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  usage_count: number;
};

function normalizeWallpaper(row: Row): Wallpaper {
  return {
    id: String(row.id),
    campaign_id: String(row.campaign_id),
    name: String(row.name || "Wallpaper"),
    storage_path: String(row.storage_path || ""),
    active: Boolean(row.active),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || row.created_at || ""),
    archived_at: row.archived_at ? String(row.archived_at) : null,
    usage_count: Number(row.usage_count || 0),
  };
}

export default function WallpaperManager({
  campaign,
}: {
  campaign: string;
}) {
  const [wallpapers, setWallpapers] = useState<Wallpaper[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!campaign) return;
    setError("");
    const response = await retryNetworkRead(() =>
      browserDb().rpc("profile_wallpaper_catalog", { c: campaign }),
    );
    if (response.error) {
      setError(readableErrorMessage(response.error));
      return;
    }

    const catalog: Wallpaper[] = ((response.data || []) as Row[]).map(
      normalizeWallpaper,
    );
    setWallpapers(catalog);

    const paths = catalog.map((entry) => entry.storage_path).filter(Boolean);
    if (!paths.length) {
      setUrls({});
      return;
    }

    const signed = await browserDb()
      .storage.from("profile-wallpapers")
      .createSignedUrls(paths, 3600);
    if (signed.error) {
      setError(readableErrorMessage(signed.error));
      return;
    }

    setUrls(
      Object.fromEntries(
        catalog.map((entry, index) => [
          entry.id,
          versionedImageUrl(
            signed.data?.[index]?.signedUrl || "",
            entry.updated_at || entry.created_at || entry.storage_path,
          ),
        ]),
      ),
    );
  }, [campaign]);

  useEffect(() => {
    void load();
  }, [load]);

  const createWallpaper = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("wallpaperName") || "").trim();
    const file = data.get("wallpaperFile");

    setError("");
    setNotice("");
    if (!name) {
      setError("Informe um nome para o wallpaper.");
      return;
    }
    if (!(file instanceof File) || !file.size) {
      setError("Escolha uma imagem.");
      return;
    }

    setBusy("create");
    let path = "";
    try {
      path = await uploadProfileWallpaper(file, campaign);
      const response = await browserDb().rpc("profile_wallpaper_action", {
        c: campaign,
        op: "create",
        d: {
          name,
          storage_path: path,
        },
      });
      if (response.error) throw response.error;

      form.reset();
      setNotice("Wallpaper adicionado à lista.");
      await load();
    } catch (reason) {
      if (path) {
        await browserDb().storage.from("profile-wallpapers").remove([path]);
      }
      setError(readableErrorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  const toggleWallpaper = async (wallpaper: Wallpaper) => {
    if (busy) return;
    setBusy(wallpaper.id);
    setError("");
    setNotice("");
    try {
      const response = await browserDb().rpc("profile_wallpaper_action", {
        c: campaign,
        op: "update",
        d: {
          wallpaper_id: wallpaper.id,
          active: !wallpaper.active,
        },
      });
      if (response.error) throw response.error;

      const cleared = Number(response.data?.cleared_profiles || 0);
      setNotice(
        wallpaper.active && cleared
          ? `Wallpaper arquivado. ${cleared} perfil(is) voltou(aram) ao padrão.`
          : wallpaper.active
            ? "Wallpaper arquivado."
            : "Wallpaper reativado.",
      );
      await load();
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  return (
    <section className={styles.manager}>
      <form className={styles.uploadForm} onSubmit={createWallpaper}>
        <div>
          <strong>Novo wallpaper</strong>
          <small>WebP, JPG ou PNG, com no máximo 1 MB.</small>
        </div>
        <label>
          Nome
          <input
            name="wallpaperName"
            maxLength={80}
            required
            disabled={Boolean(busy)}
            placeholder="Ex.: Castelo ao entardecer"
          />
        </label>
        <label>
          Imagem
          <input
            name="wallpaperFile"
            type="file"
            accept="image/webp,image/jpeg,image/png"
            required
            disabled={Boolean(busy)}
          />
        </label>
        <button type="submit" className="primary" disabled={Boolean(busy)}>
          {busy === "create" ? (
            <LoaderCircle className={styles.spin} aria-hidden="true" />
          ) : (
            <ImagePlus aria-hidden="true" />
          )}
          Adicionar
        </button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className={styles.notice}>{notice}</p>}

      <div className={styles.grid}>
        {wallpapers.map((wallpaper) => (
          <article
            key={wallpaper.id}
            className={
              wallpaper.active
                ? styles.card
                : `${styles.card} ${styles.archived}`
            }
          >
            <div
              className={styles.preview}
              role="img"
              aria-label={wallpaper.name}
              style={
                urls[wallpaper.id]
                  ? { backgroundImage: `url("${urls[wallpaper.id]}")` }
                  : undefined
              }
            >
              {!urls[wallpaper.id] && <span>Carregando</span>}
            </div>
            <div className={styles.meta}>
              <strong>{wallpaper.name}</strong>
              <small>
                {wallpaper.active ? "Disponível" : "Arquivado"} ·{" "}
                {wallpaper.usage_count} em uso
              </small>
            </div>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void toggleWallpaper(wallpaper)}
            >
              {busy === wallpaper.id ? (
                <LoaderCircle className={styles.spin} aria-hidden="true" />
              ) : wallpaper.active ? (
                <Archive aria-hidden="true" />
              ) : (
                <RotateCcw aria-hidden="true" />
              )}
              {wallpaper.active ? "Arquivar" : "Reativar"}
            </button>
          </article>
        ))}
      </div>

      {!wallpapers.length && (
        <p className={styles.empty}>
          Nenhum wallpaper cadastrado ainda. O wallpaper padrão do Alvorecer
          continuará sendo usado.
        </p>
      )}
    </section>
  );
}
