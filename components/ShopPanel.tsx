"use client";
import { useState } from "react";
import type { Row, Form } from "@/lib/types";
import ItemThumbnail from "./ItemThumbnail";
import { uploadItemImage } from "@/lib/media";
import { formatDracmas, parseDracmas } from "@/lib/currency";
export default function ShopPanel({
  shops,
  products,
  items,
  characters,
  master,
  campaign,
  busy,
  save,
  open,
}: {
  shops: Row[];
  products: Row[];
  items: Row[];
  characters: Row[];
  master: boolean;
  campaign: string;
  busy: boolean;
  save: (op: string, d: Row) => Promise<unknown>;
  open: (f: Form) => void;
}) {
  const [selected, setSelected] = useState(""),
    [character, setCharacter] = useState(""),
    [error, setError] = useState("");
  const shop = shops.find((s) => s.id === selected) || shops[0];
  const buyer = characters.find((c) => c.id === character) || characters[0];
  function editShop(s: Row = {}) {
    open({
      title: s.id ? "Editar loja" : "Criar loja",
      fields: [
        { key: "name", label: "Nome", value: s.name, required: true },
        {
          key: "description",
          label: "Descrição",
          value: s.description,
          type: "textarea",
        },
        {
          key: "active",
          label: "Estado",
          value: String(s.active ?? true),
          options: [
            { id: "true", name: "Ativa" },
            { id: "false", name: "Inativa" },
          ],
        },
      ],
      submit: async (d) => {
        await save("shop", { ...d, active: d.active === "true", id: s.id });
      },
    });
  }
  function editProduct(p: Row = {}) {
    open({
      title: p.id ? "Editar produto" : "Adicionar produto",
      fields: [
        {
          key: "item_id",
          label: "Item",
          options: items,
          value: p.item_id,
          required: true,
        },
        { key: "name", label: "Nome (opcional)", value: p.name },
        {
          key: "description",
          label: "Descrição",
          type: "textarea",
          value: p.description,
        },
        {
          key: "price_text",
          label: "Preço em Dracmas",
          value: p.id
            ? formatDracmas(p.price_cents).replace(" Dracmas", "")
            : "0,00",
          required: true,
        },
        {
          key: "stock",
          label: "Estoque (vazio = ilimitado)",
          value: p.stock ?? "",
        },
        {
          key: "active",
          label: "Estado",
          value: String(p.active ?? true),
          options: [
            { id: "true", name: "Ativo" },
            { id: "false", name: "Inativo" },
          ],
        },
      ],
      submit: async (d) => {
        await save("product", {
          ...d,
          price_cents: parseDracmas(String(d.price_text)),
          active: d.active === "true",
          id: p.id,
          shop_id: shop.id,
          image: p.image || null,
        });
      },
    });
  }
  return (
    <>
      <div className="toolbar">
        <select
          aria-label="Loja"
          value={shop?.id || ""}
          onChange={(e) => setSelected(e.target.value)}
        >
          {shops
            .filter((s) => master || s.active)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {!s.active ? " (inativa)" : ""}
              </option>
            ))}
        </select>
        {master && (
          <button className="primary" onClick={() => editShop()}>
            Criar loja
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {shop && (master || shop.active) ? (
        <>
          <div className="panel">
            <h2>{shop.name}</h2>
            <p>{shop.description}</p>
            {master ? (
              <div className="actions">
                <button onClick={() => editShop(shop)}>Editar loja</button>
                <button onClick={() => editProduct()}>Adicionar produto</button>
              </div>
            ) : (
              <label>
                Comprar para
                <select
                  value={buyer?.id || ""}
                  onChange={(e) => setCharacter(e.target.value)}
                >
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {formatDracmas(c.dracmas_cents)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="cards">
            {products
              .filter((p) => p.shop_id === shop.id && (master || p.active))
              .map((p) => (
                <article className="panel" key={p.id}>
                  <ItemThumbnail
                    path={
                      p.image || items.find((i) => i.id === p.item_id)?.image
                    }
                    name={p.name}
                  />
                  <h2>{p.name}</h2>
                  <p>{p.description}</p>
                  <strong>{formatDracmas(p.price_cents)}</strong>
                  <p>
                    {p.stock === null
                      ? "Estoque ilimitado"
                      : `${p.stock} disponíveis`}
                  </p>
                  {master ? (
                    <>
                      <button onClick={() => editProduct(p)}>Editar</button>
                      <label className="button-label">
                        Imagem
                        <input
                          hidden
                          type="file"
                          accept="image/webp,image/png,image/jpeg"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            try {
                              const image = await uploadItemImage(f, campaign);
                              await save("product", { ...p, image });
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        />
                      </label>
                    </>
                  ) : (
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        !buyer ||
                        Number(buyer.dracmas_cents) < Number(p.price_cents) ||
                        p.stock === 0
                      }
                      onClick={() =>
                        open({
                          title: `Comprar ${p.name} por ${formatDracmas(p.price_cents)}?`,
                          fields: [],
                          submit: async () => {
                            await save("purchase", {
                              character_id: buyer.id,
                              product_id: p.id,
                              request_id: crypto.randomUUID(),
                            });
                          },
                        })
                      }
                    >
                      Comprar
                    </button>
                  )}
                </article>
              ))}
          </div>
        </>
      ) : (
        <p>Nenhuma loja ativa.</p>
      )}
    </>
  );
}
