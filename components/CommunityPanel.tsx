"use client";
import { useEffect, useState } from "react";
import { browserDb } from "@/lib/client";
import type { Row } from "@/lib/types";
import IdentityBadge from "./IdentityBadge";
import { CosmeticIcon } from "./CosmeticsPanel";
import ProfileWall from "./ProfileWall";

export default function CommunityPanel({
  campaign,
  identities,
  cosmetics,
  grants,
  equipment,
  urls,
  actor,
  master,
  message,
}: {
  campaign: string;
  identities: Row[];
  cosmetics: Row[];
  grants: Row[];
  equipment: Row[];
  urls: Record<string, string>;
  actor: string;
  master: boolean;
  message: (id: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [ranking, setRanking] = useState<Row[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let valid = true;
    browserDb()
      .rpc("wealth_ranking", { c: campaign })
      .then((r) => {
        if (valid) {
          if (r.error) setError(r.error.message);
          else setRanking(r.data || []);
        }
      });
    return () => {
      valid = false;
    };
  }, [campaign, identities]);
  const current = identities.find((i) => i.id === selected && i.active);
  return (
    <>
      <section className="panel">
        <h2>Comunidade</h2>
        <label>
          Buscar perfil
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {identities
          .filter(
            (i) =>
              i.active &&
              i.name
                .toLocaleLowerCase("pt-BR")
                .includes(search.toLocaleLowerCase("pt-BR")),
          )
          .map((i) => (
            <button
              className="list-row"
              key={i.id}
              onClick={() => setSelected(i.id)}
            >
              <IdentityBadge
                identity={i}
                cosmetics={cosmetics}
                equipment={equipment}
                urls={urls}
              />
            </button>
          ))}
      </section>
      {current && (
        <section className="panel">
          <div className="spread">
            <h2>Perfil público</h2>
            <button onClick={() => setSelected("")}>Fechar</button>
          </div>
          <IdentityBadge
            identity={current}
            cosmetics={cosmetics}
            equipment={equipment}
            urls={urls}
          />
          <h3>Conquistas e coleção</h3>
          {current.id !== actor && (
            <button onClick={() => message(current.id)}>Mensagem</button>
          )}
          <div className="avatar-grid">
            {grants
              .filter((g) => g.identity_id === current.id)
              .map((g) => {
                const item = cosmetics.find((c) => c.id === g.cosmetic_id);
                return (
                  item && (
                    <div key={item.id}>
                      <CosmeticIcon item={item} />
                      <p>{item.name}</p>
                    </div>
                  )
                );
              })}
          </div>
          <ProfileWall
            campaign={campaign}
            profile={current.id}
            actor={actor}
            master={master}
            identities={identities}
            revision={identities}
          />
        </section>
      )}
      <section className="panel">
        <h2>Ranking de riqueza</h2>
        {ranking.map((r) => (
          <div className="list-row" key={r.identity_id}>
            <strong>{r.rank}º</strong>
            <button onClick={() => setSelected(r.identity_id)}>{r.name}</button>
          </div>
        ))}
        {error && <p role="alert">{error}</p>}
      </section>
    </>
  );
}
