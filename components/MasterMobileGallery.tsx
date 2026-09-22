"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Smartphone } from "lucide-react";
import { browserDb } from "@/lib/client";

type Device = { id: string; device_name: string; last_seen_at?: string; active: boolean };
type Item = {
  id: string;
  device_id: string;
  display_name: string;
  mime_type: string;
  byte_size: number;
  modified_at: number;
  duration_ms: number;
  thumbnail_url?: string;
};
type Request = {
  id: string;
  item_id: string;
  status: "requested" | "uploading" | "ready" | "unavailable" | "expired" | "failed";
  requested_at: string;
  expires_at?: string;
  error_message?: string;
};

const labels: Record<Request["status"], string> = {
  requested: "Solicitado",
  uploading: "Enviando",
  ready: "Pronto para baixar",
  unavailable: "Original indisponível",
  expired: "Expirado",
  failed: "Falha no envio",
};

export default function MasterMobileGallery({ campaign }: { campaign: string }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [busy, setBusy] = useState("");
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
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível acessar a galeria");
      return payload;
    },
    [campaign],
  );
  const load = useCallback(async () => {
    setError("");
    try {
      const data = await call("catalog");
      setDevices(data.devices || []);
      setItems(data.items || []);
      setRequests(data.requests || []);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [call]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [load]);
  const latest = useMemo(() => {
    const result = new Map<string, Request>();
    requests.forEach((request) => {
      if (!result.has(request.item_id)) result.set(request.item_id, request);
    });
    return result;
  }, [requests]);
  const online = (deviceId: string) => {
    const device = devices.find((entry) => entry.id === deviceId);
    return Boolean(device?.last_seen_at && Date.now() - Date.parse(device.last_seen_at) < 30 * 60 * 1000);
  };
  async function requestOriginal(item: Item) {
    setBusy(item.id);
    setError("");
    try {
      await call("request_original", { item_id: item.id });
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function downloadOriginal(request: Request) {
    setBusy(request.id);
    setError("");
    try {
      const data = await call("download_original", { request_id: request.id });
      window.location.assign(data.url);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="panel master-mobile-gallery">
      <div className="spread">
        <div>
          <h2>Galeria do celular</h2>
          <p className="muted">Miniaturas privadas do aparelho autorizado do Mestre.</p>
        </div>
        <button onClick={() => void load()} aria-label="Atualizar galeria"><RefreshCw size={17} /> Atualizar</button>
      </div>
      <div className="mobile-device-list">
        {devices.length ? devices.map((device) => (
          <span className={online(device.id) ? "device-online" : "device-offline"} key={device.id}>
            <Smartphone size={15} /> {device.device_name} · {online(device.id) ? "Disponível" : "Celular offline"}
          </span>
        )) : <p className="muted">Abra o aplicativo Android como Pink para autorizar o aparelho.</p>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="mobile-gallery-grid">
        {items.map((item) => {
          const request = latest.get(item.id);
          const status = request ? labels[request.status] : online(item.device_id) ? "Disponível" : "Celular offline";
          return (
            <article className="mobile-gallery-card" key={item.id}>
              {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" loading="lazy" /> : <div className="mobile-gallery-placeholder" />}
              <div>
                <strong title={item.display_name}>{item.display_name}</strong>
                <small>{item.mime_type.startsWith("video/") ? "Vídeo" : "Foto"} · {(item.byte_size / 1024 / 1024).toFixed(1)} MB</small>
                <span className={`gallery-status status-${request?.status || "available"}`}>{status}</span>
                {request?.status === "ready" ? (
                  <button disabled={busy === request.id} onClick={() => void downloadOriginal(request)}><Download size={16} /> Baixar original</button>
                ) : (
                  <button disabled={busy === item.id || request?.status === "requested" || request?.status === "uploading"} onClick={() => void requestOriginal(item)}>Solicitar original</button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!items.length && devices.length > 0 && <p className="muted">Aguardando a primeira sincronização de miniaturas.</p>}
    </section>
  );
}
