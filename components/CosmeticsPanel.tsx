"use client";
import { useState } from "react";
import { Lock, Crown, Shield, Flame, Moon, Swords, Star } from "lucide-react";
import type { Row } from "@/lib/types";

const names: Record<string, string> = {
  frame: "Molduras",
  title: "Títulos",
  medal: "Medalhas",
};
const icons = {
  star: Star,
  crown: Crown,
  shield: Shield,
  flame: Flame,
  moon: Moon,
  sword: Swords,
};
export function CosmeticIcon({ item }: { item: Row }) {
  const Icon = icons[item.icon as keyof typeof icons] || Star;
  return <Icon size={28} style={{ color: item.color }} />;
}
export default function CosmeticsPanel({
  identity,
  cosmetics,
  grants,
  equipment,
  save,
  master,
  identities,
}: {
  identity?: Row;
  cosmetics: Row[];
  grants: Row[];
  equipment: Row[];
  identities: Row[];
  master: boolean;
  save: (operation: string, data: Row) => Promise<unknown>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const execute = async (op: string, data: Row) => {
    setBusy(true);
    setError("");
    try {
      await save(op, data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <h2>Minha coleção</h2>
      {Object.entries(names).map(([kind, label]) => (
        <details key={kind} open={kind === "frame"}>
          <summary>{label}</summary>
          <div className="avatar-grid">
            {cosmetics
              .filter((c) => c.kind === kind && c.active)
              .map((item) => {
                const owned = grants.some(
                  (g) =>
                    g.identity_id === identity?.id && g.cosmetic_id === item.id,
                );
                const equipped = equipment.some(
                  (e) =>
                    e.identity_id === identity?.id && e.cosmetic_id === item.id,
                );
                return (
                  <button
                    key={item.id}
                    className={
                      equipped ? "avatar-option selected" : "avatar-option"
                    }
                    disabled={!owned || busy}
                    aria-pressed={equipped}
                    onClick={() =>
                      execute("equip", {
                        identity_id: identity?.id,
                        cosmetic_id: item.id,
                      })
                    }
                  >
                    <CosmeticIcon item={item} />
                    <strong>{item.name}</strong>
                    <small>
                      {equipped ? (
                        "Equipado"
                      ) : owned ? (
                        "Equipar"
                      ) : (
                        <>
                          <Lock size={12} /> Bloqueado
                        </>
                      )}
                    </small>
                  </button>
                );
              })}
          </div>
          {!cosmetics.some((c) => c.kind === kind && c.active) && (
            <p>Nenhum cosmético disponível nesta categoria.</p>
          )}
        </details>
      ))}
      {master && (
        <details>
          <summary>Administrar cosméticos</summary>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              await execute("cosmetic", Object.fromEntries(new FormData(form)));
            }}
          >
            <label>
              Categoria
              <select name="kind">
                {Object.entries(names).map(([k, n]) => (
                  <option key={k} value={k}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nome
              <input name="name" required maxLength={100} />
            </label>
            <label>
              Descrição
              <textarea name="description" maxLength={2000} />
            </label>
            <label>
              Cor
              <input type="color" name="color" defaultValue="#D02A43" />
            </label>
            <label>
              Símbolo
              <select name="icon">
                <option value="star">Estrela</option>
                <option value="crown">Coroa</option>
                <option value="shield">Escudo</option>
                <option value="flame">Chama</option>
                <option value="moon">Lua</option>
                <option value="sword">Espadas</option>
              </select>
            </label>
            <button disabled={busy}>Criar cosmético</button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void execute(
                "grant",
                Object.fromEntries(new FormData(e.currentTarget)),
              );
            }}
          >
            <label>
              Destinatário
              <select name="identity_id" required>
                {identities
                  .filter((i) => i.active && i.kind !== "npc")
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Cosmético
              <select name="cosmetic_id" required>
                {cosmetics
                  .filter((c) => c.active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Origem
              <select name="origin">
                <option value="gift">Presente do Pink</option>
                <option value="session">Sessão</option>
                <option value="achievement">Conquista</option>
                <option value="event">Evento</option>
                <option value="supporter">Apoiador</option>
              </select>
            </label>
            <button disabled={busy || !cosmetics.length}>
              Conceder cosmético
            </button>
          </form>
        </details>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
