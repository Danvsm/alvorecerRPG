import {admin} from "./server.ts";
export async function cleanup(req:Request) {
  const token=req.headers.get("x-cleanup-token");
  if(!token)return Response.json({error:"Não autorizado"},{status:401});
  const db=admin();const verified=await db.rpc("verify_media_cleanup",{token});
  if(verified.error||verified.data!==true)return Response.json({error:"Não autorizado"},{status:401});
  const pending=await db.from("chat_media").select("id,storage_path").is("deleted_at",null).lte("expires_at",new Date().toISOString()).order("expires_at").limit(100);
  if(pending.error)throw new Error("Falha ao listar imagens expiradas");
  let removed=0;
  for(const media of pending.data||[]){
    const deletion=await db.storage.from("chat-media").remove([media.storage_path]);
    if(deletion.error)continue;
    const saved=await db.from("chat_media").update({deleted_at:new Date().toISOString()}).eq("id",media.id);
    if(!saved.error)removed++;
  }
  return Response.json({removed,pending:(pending.data||[]).length-removed});
}
