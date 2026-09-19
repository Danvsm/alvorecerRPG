"use client";

import { ImagePlus, Medal } from "lucide-react";
import { useEffect, useState } from "react";
import type { Row } from "@/lib/types";

const MAX_MEDAL_BYTES = 1024 * 1024;
const MAX_DESCRIPTION = 200;

export default function MedalManager({
  medals,
  urls,
  busy,
  create,
}: {
  medals: Row[];
  urls: Record<string, string>;
  busy: boolean;
  create: (input: {
    file: File;
    name: string;
    description: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

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
          <article className="medal-admin-card" key={medal.id}>
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
            </div>
          </article>
        ))}
      </div>

      {!medals.length && (
        <p className="empty">Nenhuma medalha cadastrada nesta campanha.</p>
      )}
    </div>
  );
}
