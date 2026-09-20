"use client";

import {
  LoaderCircle,
  Minus,
  Plus,
  Save,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import type { Row } from "@/lib/types";
import styles from "./SessionCountManager.module.css";

type SessionProfile = {
  identity_id: string;
  name: string;
  username: string;
  kind: "master" | "player";
  session_count: number;
};

function normalizeProfile(row: Row): SessionProfile {
  return {
    identity_id: String(row.identity_id),
    name: String(row.name || "Perfil"),
    username: String(row.username || ""),
    kind: row.kind === "master" ? "master" : "player",
    session_count: Math.max(0, Number(row.session_count || 0)),
  };
}

export default function SessionCountManager({
  campaign,
}: {
  campaign: string;
}) {
  const [profiles, setProfiles] = useState<SessionProfile[]>([]);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!campaign) return;
    setLoading(true);
    setError("");
    try {
      const response = await retryNetworkRead(() =>
        browserDb().rpc("master_profile_session_catalog", { c: campaign }),
      );
      if (response.error) throw response.error;

      const loaded = ((response.data || []) as Row[]).map(normalizeProfile);
      setProfiles(loaded);
      setDrafts(
        Object.fromEntries(
          loaded.map((profile) => [profile.identity_id, profile.session_count]),
        ),
      );
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [campaign]);

  useEffect(() => {
    void load();
  }, [load]);

  const profileById = useMemo(
    () => Object.fromEntries(profiles.map((profile) => [profile.identity_id, profile])),
    [profiles],
  );

  const setValue = (identityId: string, value: number) => {
    const safe = Math.min(999999, Math.max(0, Math.trunc(Number(value) || 0)));
    setDrafts((current) => ({ ...current, [identityId]: safe }));
    setNotice("");
  };

  const adjust = (identityId: string, delta: number) => {
    const current =
      drafts[identityId] ?? profileById[identityId]?.session_count ?? 0;
    setValue(identityId, current + delta);
  };

  const save = async (profile: SessionProfile) => {
    if (saving) return;
    const value = drafts[profile.identity_id] ?? profile.session_count;
    setSaving(profile.identity_id);
    setError("");
    setNotice("");

    try {
      const response = await browserDb().rpc("master_profile_session_set", {
        c: campaign,
        target_identity: profile.identity_id,
        session_total: value,
      });
      if (response.error) throw response.error;

      setProfiles((current) =>
        current.map((entry) =>
          entry.identity_id === profile.identity_id
            ? { ...entry, session_count: value }
            : entry,
        ),
      );
      setNotice(`Sessões de ${profile.name} atualizadas para ${value}.`);
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setSaving("");
    }
  };

  return (
    <section className={styles.manager}>
      <div className={styles.heading}>
        <span className={styles.headingIcon}>
          <UsersRound aria-hidden="true" />
        </span>
        <div>
          <h2>Sessões dos perfis</h2>
          <p>
            Ajuste quantas sessões cada jogador já participou. O número aparece
            diretamente no perfil.
          </p>
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className={styles.notice}>{notice}</p>}

      {loading ? (
        <div className={styles.loading}>
          <LoaderCircle aria-hidden="true" />
          Carregando perfis...
        </div>
      ) : (
        <div className={styles.list}>
          {profiles.map((profile) => {
            const value = drafts[profile.identity_id] ?? profile.session_count;
            const changed = value !== profile.session_count;
            const rowSaving = saving === profile.identity_id;

            return (
              <div className={styles.row} key={profile.identity_id}>
                <div className={styles.identity}>
                  <strong>{profile.name}</strong>
                  <span>
                    {profile.kind === "master" ? "Mestre" : "Jogador"}
                    {profile.username ? ` · @${profile.username}` : ""}
                  </span>
                </div>

                <div className={styles.counter}>
                  <button
                    type="button"
                    aria-label={`Diminuir sessões de ${profile.name}`}
                    disabled={rowSaving || value <= 0}
                    onClick={() => adjust(profile.identity_id, -1)}
                  >
                    <Minus aria-hidden="true" />
                  </button>

                  <label>
                    <span className="visually-hidden">
                      Sessões de {profile.name}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={999999}
                      inputMode="numeric"
                      value={value}
                      disabled={rowSaving}
                      onChange={(event) =>
                        setValue(profile.identity_id, Number(event.target.value))
                      }
                    />
                  </label>

                  <button
                    type="button"
                    aria-label={`Aumentar sessões de ${profile.name}`}
                    disabled={rowSaving || value >= 999999}
                    onClick={() => adjust(profile.identity_id, 1)}
                  >
                    <Plus aria-hidden="true" />
                  </button>
                </div>

                <button
                  type="button"
                  className={styles.saveButton}
                  disabled={rowSaving || !changed}
                  onClick={() => void save(profile)}
                >
                  {rowSaving ? (
                    <LoaderCircle className={styles.spin} aria-hidden="true" />
                  ) : (
                    <Save aria-hidden="true" />
                  )}
                  <span>{rowSaving ? "Salvando" : "Salvar"}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !profiles.length && (
        <p className={styles.empty}>Nenhum perfil ativo encontrado.</p>
      )}
    </section>
  );
}
