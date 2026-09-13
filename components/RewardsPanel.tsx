"use client";
import {useState} from "react";
import {browserDb} from "@/lib/client";
import {parseDracmas} from "@/lib/currency";
import type {Row} from "@/lib/types";
export default function RewardsPanel({campaign,characters,cosmetics,refresh}:{campaign:string;characters:Row[];cosmetics:Row[];refresh:()=>Promise<void>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  return <details className="panel"><summary>Conceder recompensa</summary><form onSubmit={async e=>{
    e.preventDefault();if(busy)return;const f=e.currentTarget,d=new FormData(f);setBusy(true);setError("");setMessage("");
    try {const result=await browserDb().rpc("grant_reward",{c:campaign,target:d.get("character"),request_id:crypto.randomUUID(),d:{xp:Number(d.get("xp")||0),cents:parseDracmas(String(d.get("dracmas")||"0")),cosmetics:d.getAll("cosmetics"),reason:d.get("reason"),origin:d.get("origin")}});if(result.error)throw new Error(result.error.message);await refresh();setMessage("Recompensa concedida");f.reset()}catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }}><label>Personagem<select name="character" required>{characters.map(ch=><option key={ch.id} value={ch.id}>{ch.name}</option>)}</select></label><label>XP<input type="number" name="xp" min={0} step={1} defaultValue={0}/></label><label>Dracmas<input name="dracmas" inputMode="decimal" defaultValue="0,00"/></label><label>Motivo<input name="reason" required maxLength={500}/></label><label>Origem<select name="origin"><option value="gift">Presente do Pink</option><option value="session">Sessão</option><option value="achievement">Conquista</option><option value="event">Evento</option><option value="supporter">Apoiador</option></select></label>
  <fieldset><legend>Cosméticos</legend>{cosmetics.filter(c=>c.active).map(c=><label key={c.id}><input type="checkbox" name="cosmetics" value={c.id}/>{c.name}</label>)}</fieldset><button disabled={busy||!characters.length}>Conceder recompensa</button></form>{error&&<p className="error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}</details>;
}
