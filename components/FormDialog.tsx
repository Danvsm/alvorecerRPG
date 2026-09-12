"use client";
import { useEffect, useRef, useState } from "react";
import KeyValueField from "./KeyValueField";
import { X } from "lucide-react";
import type { Row, Form } from "@/lib/types";
export default function FormDialog({
  form,
  close,
  busy,
  run,
  generate,
}: {
  form: Form;
  close: () => void;
  busy: boolean;
  run: (f: () => Promise<void>) => Promise<void>;
  generate: () => Promise<Row>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      aria-labelledby="dialog-title"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="spread">
        <h2 id="dialog-title">{form.title}</h2>
        <button aria-label="Fechar" disabled={busy} onClick={close}>
          <X size={20} />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const values = new FormData(e.currentTarget);
          setError("");
          run(async () => {
            try {
              const d: Row = {};
              for (const f of form.fields) {
                const value = values.get(f.key);
                d[f.key] =
                  f.type === "number"
                    ? Number(value)
                    : f.type === "json"
                      ? JSON.parse(String(value || "{}"))
                      : value;
              }
              await form.submit(d);
            } catch (e) {
              setError((e as Error).message);
              throw e;
            }
          });
        }}
      >
        <div className="form-grid">
          {form.fields.map((f) => (
            <label key={f.key}>
              {f.label}
              {f.options ? (
                <select
                  name={f.key}
                  defaultValue={f.value || f.options[0]?.id || ""}
                  required={f.required}
                >
                  {!f.options.length && (
                    <option value="">Nenhuma opção cadastrada</option>
                  )}
                  {f.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              ) : f.type === "json" ? (
                <KeyValueField
                  name={f.key}
                  value={f.value || {}}
                  numeric={f.key === "attributes"}
                />
              ) : f.type === "textarea" ? (
                <textarea
                  name={f.key}
                  rows={4}
                  defaultValue={f.value}
                  required={f.required}
                />
              ) : (
                <input
                  name={f.key}
                  type={f.type || "text"}
                  defaultValue={f.value}
                  required={f.required}
                  minLength={f.type === "password" ? 6 : undefined}
                  maxLength={f.type === "password" ? 72 : undefined}
                  step={f.type === "number" ? 1 : undefined}
                />
              )}
              {f.type === "password" &&
                !["currentPassword", "confirm"].includes(f.key) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      const input =
                        e.currentTarget.parentElement?.querySelector("input");
                      run(async () => {
                        const r = await generate();
                        if (input) {
                          input.value = r.password;
                          input.type = "text";
                        }
                      });
                    }}
                  >
                    Gerar senha
                  </button>
                )}
            </label>
          ))}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Salvando..." : "Confirmar"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
