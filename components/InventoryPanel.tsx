"use client";

import { BookOpen, Package, Sparkles } from "lucide-react";
import ItemThumbnail from "./ItemThumbnail";
import type { Row } from "@/lib/types";

const kindLabels: Row = {
  consumable: "Consumível",
  equipment: "Equipamento",
  material: "Material",
  common: "Item comum",
  quest: "Item de missão",
  other: "Outro",
};
const resourceLabels: Row = { life: "Vida", mana: "Mana", stamina: "Fôlego" };

export default function InventoryPanel({
  character,
  inventory,
  items,
  effects,
  busy,
  master,
  useItem,
  editItem,
  addItem,
  editNotes,
}: {
  character: Row;
  inventory: Row[];
  items: Row[];
  effects: Row[];
  busy: boolean;
  master: boolean;
  useItem: (inventory: Row) => Promise<void>;
  editItem?: (inventory: Row) => void;
  addItem?: () => void;
  editNotes: () => void;
}) {
  const owned = inventory.filter(
    (entry) => entry.character_id === character.id,
  );
  return (
    <div className="inventory-page">
      <section className="panel inventory-panel">
        <div className="spread">
          <div>
            <p className="eyebrow">ITENS DE {character.name.toUpperCase()}</p>
            <h2>Inventário</h2>
          </div>
          {master && addItem && (
            <button onClick={addItem}>Adicionar item</button>
          )}
        </div>
        <div className="inventory-list">
          {owned.map((entry) => {
            const item = items.find(
              (candidate) => candidate.id === entry.item_id,
            );
            if (!item) return null;
            const itemEffects = effects.filter(
              (effect) => effect.item_id === item.id,
            );
            return (
              <details className="inventory-item" key={entry.id}>
                <summary>
                  <span className="inventory-thumb">
                    <ItemThumbnail path={item.image} name={item.name} />
                    {!item.image && <Package size={22} />}
                  </span>
                  <span className="inventory-name">
                    <strong>{item.name}</strong>
                    <small>{kindLabels[item.kind] || "Item"}</small>
                  </span>
                  <b>× {entry.quantity}</b>
                </summary>
                <div className="inventory-details">
                  {item.description && <p>{item.description}</p>}
                  {entry.notes && (
                    <p>
                      <b>Observações:</b> {entry.notes}
                    </p>
                  )}
                  {itemEffects.length > 0 && (
                    <div className="effect-list">
                      {itemEffects.map((effect) => (
                        <span key={effect.id}>
                          <Sparkles size={14} /> Recupera {effect.amount}{" "}
                          {resourceLabels[effect.resource_key]}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="actions">
                    {item.kind === "consumable" &&
                      item.active &&
                      itemEffects.length > 0 && (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => void useItem(entry)}
                        >
                          Usar consumível
                        </button>
                      )}
                    {master && editItem && (
                      <button onClick={() => editItem(entry)}>
                        Editar quantidade
                      </button>
                    )}
                  </div>
                </div>
              </details>
            );
          })}
          {!owned.length && (
            <p className="empty">Nenhum item neste inventário.</p>
          )}
        </div>
      </section>
      <section className="panel notes-panel">
        <div className="spread">
          <div>
            <p className="eyebrow">REGISTRO DA AVENTURA</p>
            <h2>Anotações</h2>
          </div>
          <BookOpen size={22} />
        </div>
        <p className="notes">
          {character.notes || "Nenhuma anotação registrada."}
        </p>
        <button onClick={editNotes}>Editar anotações</button>
      </section>
    </div>
  );
}
