"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Images, RefreshCw } from "lucide-react";
import { browserDb } from "@/lib/client";

type FeatureKey = "mobile_gallery" | "media_cleanup";
type Features = Record<FeatureKey, boolean>;

const featureCopy: Array<{
  key: FeatureKey;
  title: string;
  description: string;
  icon: typeof Images;
}> = [
  {
    key: "mobile_gallery",
    title: "Galeria do celular",
    description:
      "Desliga sincronização, polling, miniaturas e solicitações de originais do aplicativo.",
    icon: Images,
  },
  {
    key: "media_cleanup",
    title: "Limpeza automática de mídia",
    description:
      "Pausa o agendamento que verifica anexos, Stories, posts, gravações e miniaturas órfãs.",
    icon: RefreshCw,
  },
];

export default function ServerFeatureSettings({ campaign }: { campaign: string }) {
  const [features, setFeatures] = useState<Features | null>(null);
  const [saving, setSaving] = useState<FeatureKey | "">("");
  const [error, setError] = useState("");

  const call = useCallback(async (action: string, details: Record<string, unknown> = {}) => {
    const session = await browserDb().auth.getSession();
    const response = await fetch("/api/mobile-gallery", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.data.session?.access_token || ""}`,
      },
      body: JSON.stringify({ action, campaign_id: campaign, ...details }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível salvar a configuração");
    return payload;
  }, [campaign]);

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await call("feature_settings");
      setFeatures({
        mobile_gallery: data.features?.mobile_gallery !== false,
        media_cleanup: data.features?.media_cleanup !== false,
      });
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [call]);

  useEffect(() => { void load(); }, [load]);

  async function toggle(key: FeatureKey, enabled: boolean) {
    setSaving(key);
    setError("");
    try {
      await call("set_feature", { feature: key, enabled });
      setFeatures((current) => current ? { ...current, [key]: enabled } : current);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving("");
    }
  }

  return (
    <section className="panel">
      <div className="spread">
        <div>
          <p className="eyebrow">CONSUMO DO SERVIDOR</p>
          <h2>Recursos automáticos</h2>
          <p>
            Pause recursos opcionais para reduzir requisições, processamento,
            Egress e geração de logs no Supabase.
          </p>
        </div>
        <Activity size={24} aria-hidden="true" />
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {!features ? (
        <p className="muted">Carregando recursos...</p>
      ) : (
        <div className="web-access-player-list">
          {featureCopy.map(({ key, title, description, icon: Icon }) => {
            const enabled = features[key];
            return (
              <div className="list-row web-access-player" key={key}>
                <div>
                  <strong><Icon size={16} aria-hidden="true" /> {title}</strong>
                  <p className="muted">{description}</p>
                  <small>{enabled ? "Ativo — pode gerar consumo" : "Pausado — processamento interrompido"}</small>
                </div>
                <button
                  type="button"
                  className={enabled ? "secondary" : "primary"}
                  disabled={Boolean(saving)}
                  aria-pressed={enabled}
                  onClick={() => void toggle(key, !enabled)}
                >
                  {saving === key ? "Salvando..." : enabled ? "Desativar" : "Ativar"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <p className="muted">
        Login, banco principal, autenticação e funções essenciais do jogo não são afetados.
      </p>
    </section>
  );
}
