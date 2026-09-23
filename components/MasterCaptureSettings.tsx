"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { browserDb } from "@/lib/client";

type AccountPolicy = {
  user_id: string;
  name: string;
  username: string;
  role: string;
  override_enabled: boolean | null;
  effective_enabled: boolean;
};

type CaptureSettings = {
  default_enabled: boolean;
  accounts: AccountPolicy[];
};

export default function MasterCaptureSettings({
  campaign,
}: {
  campaign: string;
}) {
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  const call = useCallback(
    async (action: string, details: Record<string, unknown> = {}) => {
      const session = await browserDb().auth.getSession();
      const response = await fetch("/api/mobile-gallery", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.data.session?.access_token || ""}`,
        },
        body: JSON.stringify({ action, campaign_id: campaign, ...details }),
      });
      const responseText = await response.text();
      let payload: Record<string, any> = {};
      try {
        payload = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(
          "Resposta inesperada ao salvar a proteção do aplicativo.",
        );
      }
      if (!response.ok)
        throw new Error(
          payload.error || "Não foi possível salvar a configuração",
        );
      return payload;
    },
    [campaign],
  );

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await call("capture_settings");
      setSettings({
        default_enabled: data.default_enabled !== false,
        accounts: data.accounts || [],
      });
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveDefault(enabled: boolean) {
    setSaving("default");
    setError("");
    try {
      await call("set_capture_default", { enabled });
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving("");
    }
  }

  async function saveAccount(
    userId: string,
    mode: "default" | "secure" | "open",
  ) {
    setSaving(userId);
    setError("");
    try {
      if (mode === "default") {
        await call("clear_capture_account", { user_id: userId });
      } else {
        await call("set_capture_account", {
          user_id: userId,
          enabled: mode === "secure",
        });
      }
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving("");
    }
  }

  return (
    <section className="panel capture-policy-panel">
      <div className="capture-policy-heading">
        <div>
          <h2>Captura de tela no aplicativo</h2>
          <p>
            Controle o bloqueio de print e gravação de tela do APK por conta.
          </p>
        </div>
        {settings?.default_enabled !== false ? (
          <ShieldCheck aria-hidden="true" />
        ) : (
          <ShieldOff aria-hidden="true" />
        )}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!settings ? (
        <p className="muted">Carregando configurações do aplicativo...</p>
      ) : (
        <>
          <div className="capture-policy-default">
            <div>
              <strong>Padrão da campanha</strong>
              <p>
                Contas novas e contas sem regra própria usam esta configuração
                automaticamente.
              </p>
            </div>
            <div
              className="capture-policy-options"
              role="group"
              aria-label="Padrão da campanha"
            >
              <button
                type="button"
                className={settings.default_enabled ? "active" : ""}
                aria-pressed={settings.default_enabled}
                disabled={Boolean(saving)}
                onClick={() => void saveDefault(true)}
              >
                Bloquear
              </button>
              <button
                type="button"
                className={!settings.default_enabled ? "active" : ""}
                aria-pressed={!settings.default_enabled}
                disabled={Boolean(saving)}
                onClick={() => void saveDefault(false)}
              >
                Permitir
              </button>
            </div>
          </div>

          <div className="capture-policy-account-list">
            {settings.accounts.map((account) => {
              const mode =
                account.override_enabled === null
                  ? "default"
                  : account.override_enabled
                    ? "secure"
                    : "open";
              return (
                <div className="capture-policy-account" key={account.user_id}>
                  <div>
                    <strong>{account.name}</strong>
                    <small>
                      @{account.username} ·{" "}
                      {account.role === "master" ? "Mestre" : "Jogador"}
                    </small>
                    <span>
                      Agora:{" "}
                      {account.effective_enabled
                        ? "prints bloqueados"
                        : "prints permitidos"}
                    </span>
                  </div>
                  <select
                    value={mode}
                    disabled={Boolean(saving)}
                    aria-label={`Proteção de captura para ${account.name}`}
                    onChange={(event) =>
                      void saveAccount(
                        account.user_id,
                        event.target.value as
                          | "default"
                          | "secure"
                          | "open",
                      )
                    }
                  >
                    <option value="default">Usar padrão da campanha</option>
                    <option value="secure">Bloquear prints</option>
                    <option value="open">Permitir prints</option>
                  </select>
                </div>
              );
            })}
          </div>

          <p className="muted capture-policy-note">
            O APK começa sempre protegido. Quando a conta é reconhecida, aplica
            a regra acima. Se a comunicação falhar, o bloqueio permanece ativo.
          </p>
        </>
      )}
    </section>
  );
}
