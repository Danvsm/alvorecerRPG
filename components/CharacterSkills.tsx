"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ImagePlus, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { browserDb } from "@/lib/client";

type Skill = {
  id: string;
  character_id: string;
  skill_type: SkillType;
  title: string;
  description: string;
  level: number;
  cost_type: CostType;
  cost_amount: number;
  other_cost_label: string;
  image_path: string | null;
};
export type SkillType = "active" | "passive";
type CostType = "mana" | "stamina" | "life" | "fury" | "other";
type Draft = Pick<Skill, "title" | "description" | "level" | "cost_type" | "cost_amount" | "other_cost_label">;

const BUCKET = "character-skills";
const MAX_IMAGE_BYTES = 300 * 1024;
const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const costLabels: Record<CostType, string> = {
  mana: "Mana",
  stamina: "Fôlego",
  life: "Vida",
  fury: "Fúria",
  other: "Outro",
};
const emptyDraft: Draft = {
  title: "",
  description: "",
  level: 1,
  cost_type: "mana",
  cost_amount: 0,
  other_cost_label: "",
};

export default function CharacterSkills({ characterId, skillType }: { characterId: string; skillType: SkillType }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [image, setImage] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error: loadError } = await browserDb()
      .from("character_skills")
      .select("id,character_id,skill_type,title,description,level,cost_type,cost_amount,other_cost_label,image_path")
      .eq("character_id", characterId)
      .order("created_at", { ascending: true });
    if (loadError) throw loadError;
    const rows = (data || []) as Skill[];
    const paths = rows.filter((row) => row.image_path).map((row) => row.image_path!);
    const urls: Record<string, string> = {};
    if (paths.length) {
      const { data: signed, error: signedError } = await browserDb().storage
        .from(BUCKET)
        .createSignedUrls(paths, 3600);
      if (signedError) throw signedError;
      signed?.forEach((entry, index) => {
        if (entry.signedUrl) urls[paths[index]] = entry.signedUrl;
      });
    }
    setSkills(rows);
    setImageUrls(urls);
  }, [characterId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load()
      .catch(() => { if (active) setError("Não foi possível carregar as habilidades."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  const begin = (skill?: Skill) => {
    setEditing(skill?.id || "new");
    setDraft(skill ? {
      title: skill.title,
      description: skill.description,
      level: skill.level,
      cost_type: skill.cost_type,
      cost_amount: skill.cost_amount,
      other_cost_label: skill.other_cost_label,
    } : { ...emptyDraft });
    setImage(null);
    setRemoveImage(false);
    setError("");
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || saving) return;
    if (image && (!imageExtensions[image.type] || image.size > MAX_IMAGE_BYTES)) {
      setError("Escolha uma imagem JPG, PNG ou WebP de até 300 KB.");
      return;
    }
    setSaving(true);
    setError("");
    const existing = skills.find((skill) => skill.id === editing);
    const id = existing?.id || crypto.randomUUID();
    let uploadedPath: string | null = null;
    let persisted = false;
    try {
      if (image) {
        uploadedPath = `${characterId}/${id}/${crypto.randomUUID()}.${imageExtensions[image.type]}`;
        const { error: uploadError } = await browserDb().storage.from(BUCKET)
          .upload(uploadedPath, image, { contentType: image.type, upsert: false });
        if (uploadError) throw new Error(
          "Não foi possível enviar a imagem. Verifique o formato e o limite de 300 KB e tente novamente.",
        );
      }
      const payload = {
        skill_type: skillType,
        title: draft.title.trim(),
        description: draft.description.trim(),
        level: Number(draft.level),
        cost_type: skillType === "passive" ? "mana" : draft.cost_type,
        cost_amount: skillType === "passive" ? 0 : Number(draft.cost_amount),
        other_cost_label: skillType === "active" && draft.cost_type === "other" ? draft.other_cost_label.trim() : "",
        image_path: uploadedPath || (removeImage ? null : existing?.image_path || null),
      };
      const query = existing
        ? browserDb().from("character_skills").update(payload).eq("id", id).eq("character_id", characterId)
        : browserDb().from("character_skills").insert({ id, character_id: characterId, ...payload });
      const { data: saved, error: saveError } = await query.select("id").single();
      if (saveError || !saved) throw saveError || new Error("Habilidade não salva");
      persisted = true;
      if (existing?.image_path && existing.image_path !== payload.image_path) {
        await browserDb().storage.from(BUCKET).remove([existing.image_path]);
      }
      setEditing(null);
      await load();
    } catch (cause) {
      if (uploadedPath && !persisted) await browserDb().storage.from(BUCKET).remove([uploadedPath]);
      const message = cause && typeof cause === "object" && "message" in cause
        && typeof cause.message === "string" ? cause.message : null;
      setError(message || "Não foi possível salvar a habilidade.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (skill: Skill) => {
    if (!window.confirm(`Excluir a habilidade “${skill.title}”?`)) return;
    setSaving(true);
    setError("");
    try {
      const { data, error: deleteError } = await browserDb().from("character_skills")
        .delete().eq("id", skill.id).eq("character_id", characterId).select("id").single();
      if (deleteError || !data) throw deleteError || new Error("Habilidade não excluída");
      if (skill.image_path) await browserDb().storage.from(BUCKET).remove([skill.image_path]);
      if (editing === skill.id) setEditing(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir a habilidade.");
    } finally {
      setSaving(false);
    }
  };

  const visibleSkills = skills.filter((skill) => skill.skill_type === skillType);
  const label = skillType === "active" ? "ativa" : "passiva";

  return (
    <div className="character-skills">
      <div className="character-skills-heading">
        <div><h2>Habilidades {skillType === "active" ? "Ativas" : "Passivas"}</h2>
          <p>{skillType === "active" ? "Crie técnicas para a sua ficha e acompanhe o custo de cada uma." : "Registre efeitos permanentes ou automáticos da sua ficha."}</p></div>
        <span>{visibleSkills.length} {visibleSkills.length === 1 ? "habilidade" : "habilidades"}</span>
      </div>
      <p className="character-skills-limit">{skills.length} de 13 habilidades no total</p>
      {error && <p className="character-skills-error" role="alert">{error}</p>}
      {loading ? <p className="empty">Carregando habilidades…</p> : visibleSkills.length ? (
        <div className="character-skills-list">
          {visibleSkills.map((skill) => (
            <article className="character-skill" key={skill.id}>
              <div className="character-skill-image">
                {skill.image_path && imageUrls[skill.image_path]
                  ? <img src={imageUrls[skill.image_path]} alt="" loading="lazy" />
                  : <Sparkles size={26} aria-hidden="true" />}
              </div>
              <div className="character-skill-body">
                <div className="character-skill-title"><h3>{skill.title}</h3><span>Nível {skill.level}</span></div>
                <p>{skill.description}</p>
                {skillType === "active" && <span className={`character-skill-cost cost-${skill.cost_type}`}>
                  {skill.cost_amount} {skill.cost_type === "other" ? skill.other_cost_label : costLabels[skill.cost_type]}
                </span>}
              </div>
              <div className="character-skill-actions">
                <button type="button" aria-label={`Editar ${skill.title}`} title="Editar" onClick={() => begin(skill)} disabled={saving}><Pencil size={17} /></button>
                <button type="button" aria-label={`Excluir ${skill.title}`} title="Excluir" onClick={() => void remove(skill)} disabled={saving}><Trash2 size={17} /></button>
              </div>
            </article>
          ))}
        </div>
      ) : <p className="character-skills-empty">Nenhuma habilidade {label} cadastrada. Comece criando a primeira.</p>}

      {!loading && editing === null && skills.length < 13 && (
        <button className="character-skills-add" type="button" onClick={() => begin()}><Plus size={18} /> Adicionar habilidade {label}</button>
      )}

      {editing && (
        <form className="character-skill-form" onSubmit={(event) => void save(event)}>
          <div className="character-skill-form-heading"><h3>{editing === "new" ? `Nova habilidade ${label}` : `Editar habilidade ${label}`}</h3>
            <button type="button" aria-label="Fechar formulário" onClick={() => setEditing(null)} disabled={saving}><X size={18} /></button></div>
          <label>Título<input required maxLength={80} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>Descrição<textarea required maxLength={2000} rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <div className="character-skill-form-grid">
            <label>Nível<input required type="number" min={1} max={99} value={draft.level} onChange={(event) => setDraft({ ...draft, level: Number(event.target.value) })} /></label>
            {skillType === "active" && <label>Recurso<select value={draft.cost_type} onChange={(event) => setDraft({ ...draft, cost_type: event.target.value as CostType })}>
              {Object.entries(costLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
            </select></label>}
            {skillType === "active" && <label>Custo<input required type="number" min={0} max={99999} value={draft.cost_amount} onChange={(event) => setDraft({ ...draft, cost_amount: Number(event.target.value) })} /></label>}
            {skillType === "active" && draft.cost_type === "other" && <label>Nome do recurso<input required maxLength={40} value={draft.other_cost_label} onChange={(event) => setDraft({ ...draft, other_cost_label: event.target.value })} /></label>}
          </div>
          <label className="character-skill-upload"><ImagePlus size={20} /> <span>{image?.name || (editing === "new" ? "Adicionar imagem" : "Trocar imagem")}</span><small>JPG, PNG ou WebP · até 300 KB</small>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
              const file = event.target.files?.[0] || null;
              if (file && (!imageExtensions[file.type] || file.size > MAX_IMAGE_BYTES)) {
                setError("Escolha uma imagem JPG, PNG ou WebP de até 300 KB.");
                event.target.value = "";
                return;
              }
              setError(""); setImage(file); setRemoveImage(false);
            }} /></label>
          {editing !== "new" && skills.find((skill) => skill.id === editing)?.image_path && !image && (
            <label className="character-skill-remove-image"><input type="checkbox" checked={removeImage} onChange={(event) => setRemoveImage(event.target.checked)} /> Remover imagem atual</label>
          )}
          <div className="character-skill-form-actions"><button type="button" onClick={() => setEditing(null)} disabled={saving}>Cancelar</button><button className="primary" type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar habilidade"}</button></div>
        </form>
      )}
    </div>
  );
}
