"use client";
import type { Row } from "@/lib/types";
const labels: Row = { life: "Vida", mana: "Mana", stamina: "Fôlego" };
export default function ConsumableActions({
  characterId,
  inventory,
  items,
  effects,
  use,
  busy,
}: {
  characterId: string;
  inventory: Row[];
  items: Row[];
  effects: Row[];
  use: (d: Row) => void;
  busy: boolean;
}) {
  const owned = inventory.filter(
    (i) =>
      i.character_id === characterId &&
      i.quantity > 0 &&
      items.some(
        (item) =>
          item.id === i.item_id && item.kind === "consumable" && item.active,
      ),
  );
  if (!owned.length) return null;
  return (
    <section className="panel">
      <h3>Ações rápidas</h3>
      {owned.map((i) => (
        <div className="list-row" key={i.id}>
          <div>
            <b>
              {items.find((item) => item.id === i.item_id)?.name} × {i.quantity}
            </b>
            <p>
              {effects
                .filter((e) => e.item_id === i.item_id)
                .map((e) => `Recupera ${e.amount} ${labels[e.resource_key]}`)
                .join(" · ")}
            </p>
          </div>
          <button
            disabled={busy}
            className="primary"
            onClick={() =>
              use({
                character_id: characterId,
                inventory_id: i.id,
                request_id: crypto.randomUUID(),
              })
            }
          >
            Usar
          </button>
        </div>
      ))}
    </section>
  );
}
