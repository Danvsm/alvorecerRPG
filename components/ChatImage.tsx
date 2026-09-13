"use client";
import {useEffect,useState} from "react";
import {browserDb} from "@/lib/client";
export default function ChatImage({id}:{id:string}) {
 const [url,setUrl]=useState(""),[expired,setExpired]=useState(false),[error,setError]=useState("");
 useEffect(()=>{let valid=true;let timer:ReturnType<typeof setTimeout>;const load=async()=>{const r=await browserDb().from("chat_media").select("storage_path,expires_at,deleted_at").eq("id",id).single();if(!valid)return;if(r.error){setError("Imagem indisponível");return}const remaining=Date.parse(r.data.expires_at)-Date.now();if(r.data.deleted_at||remaining<=0){setExpired(true);return}const signed=await browserDb().storage.from("chat-media").createSignedUrl(r.data.storage_path,Math.max(1,Math.min(300,Math.floor(remaining/1000))));if(!valid)return;if(signed.error)setError("Não foi possível abrir a imagem");else setUrl(signed.data.signedUrl);timer=setTimeout(()=>{if(valid){setExpired(true);setUrl("")}},remaining)};void load();return()=>{valid=false;clearTimeout(timer)}},[id]);
 return expired?<p>Imagem expirada</p>:url?<img className="chat-image" src={url} alt="Imagem enviada na conversa" loading="lazy"/>:<p>{error||"Carregando imagem..."}</p>;
}
