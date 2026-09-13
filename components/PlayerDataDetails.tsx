"use client";
import { useEffect, useState } from "react";
import { browserDb } from "@/lib/client";
import { formatDracmas } from "@/lib/currency";
import type { Row, Form } from "@/lib/types";

export function ageFromDate(date?: string) {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  const now = new Date();
  return (
    now.getFullYear() -
    y -
    (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)
      ? 1
      : 0)
  );
}
const duration = (seconds: number) =>
  `${Math.floor((seconds || 0) / 3600)}h${String(Math.floor(((seconds || 0) % 3600) / 60)).padStart(2, "0")}`;
export default function PlayerDataDetails({
  profile,
  campaign,
  characters,
  resources,
  open,
  refresh,
  editCharacter,
}: {
  profile: Row;
  campaign: string;
  characters: Row[];
  resources: Row[];
  open: (form: Form) => void;
  refresh: () => Promise<void>;
  editCharacter: (id: string) => void;
}) {
  const [summary, setSummary] = useState<Row>({}),
    [error, setError] = useState("");
  useEffect(() => {
    let valid = true;
    browserDb()
      .rpc("admin_player_summary", { c: campaign, target: profile.id })
      .then((r) => {
        if (valid) {
          if (r.error) setError(r.error.message);
          else setSummary(r.data || {});
        }
      });
    return () => {
      valid = false;
    };
  }, [campaign, profile]);
  const activity = summary.activity || {},
    finances = summary.finances || {};
  return (
    <>
      <details open>
        <summary>Dados pessoais</summary>
        <p>Nome completo: {profile.full_name || "Não informado"}</p>
        <p>E-mail: {profile.personal_email || "Não informado"}</p>
        <p>
          Nascimento:{" "}
          {profile.birth_date
            ? new Date(profile.birth_date + "T12:00:00").toLocaleDateString(
                "pt-BR",
              )
            : "Não informado"}
        </p>
        <p>Idade: {ageFromDate(profile.birth_date) ?? "Não informada"}</p>
        <p>Username: {profile.username}</p>
        <button
          onClick={() =>
            open({
              title: "Editar dados pessoais",
              fields: [
                {
                  key: "full_name",
                  label: "Nome completo",
                  value: profile.full_name,
                  required: true,
                },
                {
                  key: "email",
                  label: "E-mail",
                  type: "email",
                  value: profile.personal_email,
                  required: true,
                },
                {
                  key: "birth_date",
                  label: "Nascimento",
                  type: "date",
                  value: profile.birth_date,
                  required: true,
                },
                {
                  key: "username",
                  label: "Username",
                  value: profile.username,
                  required: true,
                },
              ],
              submit: async (d) => {
                const r = await browserDb().rpc("admin_player_data", {
                  c: campaign,
                  target: profile.id,
                  d,
                });
                if (r.error) throw new Error(r.error.message);
                await refresh();
              },
            })
          }
        >
          Editar dados
        </button>
      </details>
      <details>
        <summary>Personagem e progressão</summary>
        {characters.map((ch) => (
          <article key={ch.id} className="panel">
            <h3>{ch.name}</h3>
            <p>
              {ch.class} • {ch.race} • Nível {ch.level}
            </p>
            {resources
              .filter((r) => r.character_id === ch.id)
              .map((r) => (
                <p key={r.key}>
                  {({ life: "Vida", mana: "Mana", stamina: "Fôlego" } as Row)[
                    r.key
                  ] || r.key}
                  : {r.current} / {r.maximum}
                </p>
              ))}
            <p>XP disponível: {ch.xp}</p>
            <p>XP total conquistado: {ch.xp_total}</p>
            <button onClick={()=>open({title:`Corrigir progressão de ${ch.name}`,fields:[{key:"xp",label:"XP disponível",type:"number",value:ch.xp,required:true},{key:"xp_total",label:"XP total conquistado",type:"number",value:ch.xp_total,required:true},{key:"level",label:"Nível",type:"number",value:ch.level,required:true},{key:"reason",label:"Motivo",required:true}],submit:async d=>{const r=await browserDb().rpc("admin_character_progression",{c:campaign,target:ch.id,d});if(r.error)throw new Error(r.error.message);await refresh()}})}>Corrigir XP e nível</button>
            <button onClick={() => editCharacter(ch.id)}>
              Administrar personagem
            </button>
          </article>
        ))}
      </details>
      <details>
        <summary>Dracmas</summary>
        <p>
          Saldo atual:{" "}
          {formatDracmas(
            characters.reduce((n, ch) => n + Number(ch.dracmas_cents || 0), 0),
          )}
        </p>
        <p>Total recebido: {formatDracmas(finances.received || 0)}</p>
        <p>Total enviado/gasto: {formatDracmas(finances.spent || 0)}</p>
        {characters.map((ch) => (
          <button key={ch.id} onClick={() => editCharacter(ch.id)}>
            Ajustar saldo de {ch.name}
          </button>
        ))}
      </details>
      <details>
        <summary>Atividade</summary>
        {[
          ["Primeiro acesso", activity.first_access],
          ["Última entrada", activity.last_access],
          ["Última saída", activity.last_exit],
        ].map(([name, value]) => (
          <p key={name}>
            {name}:{" "}
            {value ? new Date(value).toLocaleString("pt-BR") : "Sem registro"}
          </p>
        ))}
        {[
          ["Hoje", activity.today],
          ["Últimos 7 dias", activity.week],
          ["Últimos 30 dias", activity.month],
          ["Tempo total", activity.total],
          ["Média por sessão", activity.average],
        ].map(([name, value]) => (
          <p key={name}>
            {name}: {duration(value)}
          </p>
        ))}
        <p>Sessões: {activity.sessions || 0}</p>
      </details>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
