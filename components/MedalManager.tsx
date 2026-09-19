"use client";

import { Check, ImagePlus, Medal, Send, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Row } from "@/lib/types";

const MAX_MEDAL_BYTES = 1024 * 1024;
const MAX_DESCRIPTION = 200;

type MedalDialogStep = "actions" | "send" | "delete";

export default function MedalManager({
  medals,
  players,
  urls,
  busy,
  create,
  send,
  remove,
}: {
  medals: Row[];
  players: Row[];
  urls: Record<string, string>;
  busy: boolean;
  create: (input: {
    file: File;
    name: string;
    description: string;
  }) => Promise<void>;
  send: (input: { medalId: string; identityId: string }) => Promise<void>;
  remove: (medalId: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [selectedMedal, setSelectedMedal] = useState<Row | null>(null);
  const [dialogStep, setDialogStep] = useState<MedalDialogStep>("actions");
  const [recipientId, setRecipientId] = useState("");
  const [dialogError, setDialogError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  useEffect(() => {
    if (!selectedMedal) return;
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
  }, [selectedMedal]);

  const chooseFile = (selected?: File) => {
    setError("");
    if (!selected) {
      setFile(undefined);
      if (preview) URL.revokeObjectURL(preview);
      setPreview("");
      return;
    }

    if (selected.type !== "image/png") {
      setError("A medalha precisa ser enviada em PNG.");
      return;
    }
    if (selected.size > MAX_MEDAL_BYTES) {
      setError("O PNG da medalha deve ter no máximo 1 MB.");
      return;
    }

    if (preview) URL.revokeObjectURL(preview);
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  };

  const openMedal = (medal: Row) => {
    setSelectedMedal(medal);
    setDialogStep("actions");
    setRecipientId("");
    setDialogError("");
  };

  const closeDialog = () => {
    if (busy) return;
    dialogRef.current?.close();
    setSelectedMedal(null);
    setDialogStep("actions");
    setRecipientId("");
    setDialogError("");
  };

  const sendMedal = async () => {
    if (!selectedMedal) return;
    if (!recipientId) {
      setDialogError("Selecione um jogador.");
      return;
    }

    setDialogError("");
    try {
      await send({
        medalId: String(selectedMedal.id),
        identityId: recipientId,
      });
      closeDialog();
    } catch (reason) {
      setDialogError((reason as Error).message);
    }
  };

  const deleteMedal = async () => {
    if (!selectedMedal) return;

    setDialogError("");
    try {
      await remove(String(selectedMedal.id));
      closeDialog();
    } catch (reason) {
      setDialogError((reason as Error).message);
    }
  };

  return (
    <div className="medal-manager">
      <form
        className="medal-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");

          const title = name.trim();
          const text = description.trim();

          if (!title) {
            setError("Informe o título da medalha.");
            return;
          }
          if (!file) {
            setError("Selecione o PNG da medalha.");
            return;
          }
          if (text.length > MAX_DESCRIPTION) {
            setError("A descrição aceita no máximo 200 caracteres.");
            return;
          }

          try {
            await create({ file, name: title, description: text });
            setName("");
            setDescription("");
            setFile(undefined);
            if (preview) URL.revokeObjectURL(preview);
            setPreview("");
            event.currentTarget.reset();
          } catch (reason) {
            setError((reason as Error).message);
          }
        }}
      >
        <div className="medal-upload-preview">
          {preview ? (
            <img src={preview} alt="Prévia da medalha" />
          ) : (
            <span>
              <Medal aria-hidden="true" />
              Prévia
            </span>
          )}
        </div>

        <div className="medal-form-fields">
          <label>
            Título da medalha
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              required
              disabled={busy}
              placeholder="Ex.: Guardião do Primeiro Alvorecer"
            />
          </label>

          <label>
            PNG da medalha
            <input
              type="file"
              accept="image/png"
              required
              disabled={busy}
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
            <small>Somente PNG · máximo 1 MB</small>
          </label>

          <label className="medal-description-field">
            Descrição
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={MAX_DESCRIPTION}
              disabled={busy}
              placeholder="Uma frase curta explicando por que esta medalha é conquistada."
            />
            <small className="medal-character-count">
              {description.length}/{MAX_DESCRIPTION}
            </small>
          </label>

          <button className="primary" disabled={busy}>
            <ImagePlus size={17} />
            Cadastrar medalha
          </button>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      </form>

      <div className="medal-admin-grid">
        {medals.map((medal) => (
          <article
            aria-label={`Administrar medalha ${medal.name}`}
            className="medal-admin-card"
            key={medal.id}
            onClick={() => openMedal(medal)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openMedal(medal);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="medal-admin-art">
              {urls[medal.id] ? (
                <img src={urls[medal.id]} alt={medal.name} loading="lazy" />
              ) : (
                <Medal aria-hidden="true" />
              )}
            </div>
            <div>
              <strong>{medal.name}</strong>
              {medal.description && <p>{medal.description}</p>}
              <small>Clique para administrar</small>
            </div>
          </article>
        ))}
      </div>

      {!medals.length && (
        <p className="empty">Nenhuma medalha cadastrada nesta campanha.</p>
      )}

      {selectedMedal && (
        <dialog
          className="medal-action-dialog"
          ref={dialogRef}
          onCancel={(event) => {
            event.preventDefault();
            closeDialog();
          }}
        >
          <div className="medal-dialog-heading">
            <div className="medal-dialog-preview">
              {urls[selectedMedal.id] ? (
                <img
                  src={urls[selectedMedal.id]}
                  alt={String(selectedMedal.name)}
                />
              ) : (
                <Medal aria-hidden="true" />
              )}
            </div>
            <div>
              <small>Medalha selecionada</small>
              <h2>{selectedMedal.name}</h2>
            </div>
            <button
              aria-label="Fechar"
              disabled={busy}
              onClick={closeDialog}
              type="button"
            >
              <X size={20} />
            </button>
          </div>

          {dialogStep === "actions" && (
            <>
              <p>O que você deseja fazer com esta medalha?</p>
              <div className="medal-dialog-options">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setDialogStep("send");
                    setDialogError("");
                  }}
                  type="button"
                >
                  <Send size={18} />
                  Enviar medalha
                </button>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={() => {
                    setDialogStep("delete");
                    setDialogError("");
                  }}
                  type="button"
                >
                  <Trash2 size={18} />
                  Deletar medalha
                </button>
              </div>
            </>
          )}

          {dialogStep === "send" && (
            <>
              <div className="medal-dialog-copy">
                <h3>Escolha o jogador</h3>
                <p>
                  O jogador receberá a medalha e a notificação: “Parabéns pela
                  sua nova medalha.”
                </p>
              </div>

              <div className="medal-player-list">
                {players.map((player) => {
                  const selected = recipientId === String(player.id);
                  return (
                    <button
                      aria-pressed={selected}
                      className={
                        selected
                          ? "medal-player-option selected"
                          : "medal-player-option"
                      }
                      disabled={busy}
                      key={player.id}
                      onClick={() => {
                        setRecipientId(String(player.id));
                        setDialogError("");
                      }}
                      type="button"
                    >
                      <span>
                        <strong>{player.name}</strong>
                        {player.username && <small>{player.username}</small>}
                      </span>
                      {selected && <Check size={17} />}
                    </button>
                  );
                })}
                {!players.length && (
                  <p className="empty">Nenhum jogador disponível.</p>
                )}
              </div>

              <div className="dialog-actions">
                <button
                  disabled={busy}
                  onClick={() => {
                    setDialogStep("actions");
                    setRecipientId("");
                    setDialogError("");
                  }}
                  type="button"
                >
                  Voltar
                </button>
                <button
                  className="primary"
                  disabled={busy || !recipientId}
                  onClick={sendMedal}
                  type="button"
                >
                  <Send size={17} />
                  Enviar
                </button>
              </div>
            </>
          )}

          {dialogStep === "delete" && (
            <>
              <div className="medal-dialog-copy">
                <h3>Deletar definitivamente?</h3>
                <p>
                  A medalha será removida do banco, de todos os jogadores que a
                  possuem e não ficará mais disponível no Alvorecer.
                </p>
              </div>
              <div className="dialog-actions">
                <button
                  disabled={busy}
                  onClick={() => {
                    setDialogStep("actions");
                    setDialogError("");
                  }}
                  type="button"
                >
                  Voltar
                </button>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={deleteMedal}
                  type="button"
                >
                  <Trash2 size={17} />
                  Deletar medalha
                </button>
              </div>
            </>
          )}

          {dialogError && (
            <p className="error" role="alert">
              {dialogError}
            </p>
          )}
        </dialog>
      )}
    </div>
  );
}
