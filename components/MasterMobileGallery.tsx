"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Smartphone, XCircle } from "lucide-react";
import { browserDb } from "@/lib/client";

type Device = {
  id: string;
  device_name: string;
  last_seen_at?: string;
  active: boolean;
  item_count?: number;
  account_user_id: string;
  account_username: string;
  account_name: string;
};

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
  status:
    | "requested"
    | "uploading"
    | "ready"
    | "unavailable"
    | "expired"
    | "failed"
    | "cancelled";
  requested_at: string;
  expires_at?: string;
  device_polled_at?: string;
  attempt_count?: number;
  error_message?: string;
};

type DevicePage = {
  loaded: number;
  hasMore: boolean;
  loading: boolean;
};

const PAGE_SIZE = 40;

const labels: Record<Request["status"], string> = {
  requested: "Aguardando o celular",
  uploading: "Enviando",
  ready: "Pronto para baixar",
  unavailable: "Original indisponível",
  expired: "Expirado",
  failed: "Falha no envio",
  cancelled: "Solicitação cancelada",
};

export default function MasterMobileGallery({
  campaign,
}: {
  campaign: string;
}) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [pages, setPages] = useState<Record<string, DevicePage>>({});
  const [selectedDevices, setSelectedDevices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [refreshing, setRefreshing] = useState(false);
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
          response.ok
            ? "A galeria respondeu em um formato inesperado."
            : "Erro interno ao acessar a galeria. Tente atualizar novamente.",
        );
      }
      if (!response.ok)
        throw new Error(
          payload.error || "Não foi possível acessar a galeria",
        );
      return payload;
    },
    [campaign],
  );

  const loadCatalog = useCallback(async () => {
    setError("");
    try {
      const data = await call("catalog", { metadata_only: true });
      setDevices(data.devices || []);
      setRequests(data.requests || []);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [call]);

  const loadDevicePage = useCallback(
    async (deviceId: string, offset = 0, replace = false) => {
      setPages((current) => ({
        ...current,
        [deviceId]: {
          loaded: replace ? 0 : current[deviceId]?.loaded || 0,
          hasMore: current[deviceId]?.hasMore ?? true,
          loading: true,
        },
      }));

      try {
        const data = await call("catalog_items", {
          device_id: deviceId,
          offset,
          limit: PAGE_SIZE,
        });
        const nextItems = (data.items || []) as Item[];

        setItems((current) => {
          const otherDevices = replace
            ? current.filter((item) => item.device_id !== deviceId)
            : current;
          const existingIds = new Set(otherDevices.map((item) => item.id));
          return [
            ...otherDevices,
            ...nextItems.filter((item) => !existingIds.has(item.id)),
          ];
        });

        setPages((current) => ({
          ...current,
          [deviceId]: {
            loaded: Number(data.next_offset ?? offset + nextItems.length),
            hasMore: Boolean(data.has_more),
            loading: false,
          },
        }));
      } catch (caught) {
        setPages((current) => ({
          ...current,
          [deviceId]: {
            loaded: current[deviceId]?.loaded || 0,
            hasMore: current[deviceId]?.hasMore ?? true,
            loading: false,
          },
        }));
        setError((caught as Error).message);
      }
    },
    [call],
  );

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const latest = useMemo(() => {
    const result = new Map<string, Request>();
    requests.forEach((request) => {
      if (!result.has(request.item_id)) result.set(request.item_id, request);
    });
    return result;
  }, [requests]);

  const deviceById = useMemo(
    () => new Map(devices.map((device) => [device.id, device])),
    [devices],
  );

  const accounts = useMemo(() => {
    const grouped = new Map<
      string,
      {
        userId: string;
        username: string;
        name: string;
        devices: Device[];
      }
    >();

    devices.forEach((device) => {
      const current = grouped.get(device.account_user_id);
      if (current) {
        current.devices.push(device);
        return;
      }
      grouped.set(device.account_user_id, {
        userId: device.account_user_id,
        username: device.account_username,
        name: device.account_name,
        devices: [device],
      });
    });

    const result = [...grouped.values()];
    result.forEach((account) => {
      account.devices.sort(
        (left, right) =>
          Date.parse(right.last_seen_at || "1970-01-01") -
          Date.parse(left.last_seen_at || "1970-01-01"),
      );
    });
    return result.sort((left, right) =>
      left.name.localeCompare(right.name, "pt-BR"),
    );
  }, [devices]);

  useEffect(() => {
    if (refreshing) return;

    accounts.forEach((account) => {
      const selectedId =
        selectedDevices[account.userId] &&
        account.devices.some(
          (device) => device.id === selectedDevices[account.userId],
        )
          ? selectedDevices[account.userId]
          : account.devices[0]?.id;

      if (!selectedId) return;
      const page = pages[selectedId];
      if (!page && !page?.loading) {
        void loadDevicePage(selectedId, 0, true);
      }
    });
  }, [accounts, loadDevicePage, pages, refreshing, selectedDevices]);

  const online = (deviceId: string) => {
    const device = deviceById.get(deviceId);
    return Boolean(
      device?.last_seen_at &&
        Date.now() - Date.parse(device.last_seen_at) < 30 * 60 * 1000,
    );
  };

  async function refreshGallery() {
    setRefreshing(true);
    setError("");
    setItems([]);
    setPages({});
    try {
      await loadCatalog();
    } finally {
      setRefreshing(false);
    }
  }

  async function requestOriginal(item: Item) {
    setBusy(item.id);
    setError("");
    try {
      await call("request_original", { item_id: item.id });
      await loadCatalog();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function cancelRequest(request: Request) {
    setBusy(request.id);
    setError("");
    try {
      await call("cancel_request", { request_id: request.id });
      await loadCatalog();
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
      const data = await call("download_original", {
        request_id: request.id,
      });
      window.location.assign(data.url);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy("");
    }
  }

  const renderItem = (item: Item) => {
    const request = latest.get(item.id);
    const status = request
      ? labels[request.status]
      : online(item.device_id)
        ? "Disponível"
        : "Celular offline";

    return (
      <article className="mobile-gallery-card" key={item.id}>
        {item.thumbnail_url ? (
          <img src={item.thumbnail_url} alt="" loading="lazy" />
        ) : (
          <div className="mobile-gallery-placeholder" />
        )}
        <div>
          <strong title={item.display_name}>{item.display_name}</strong>
          <small>
            {item.mime_type.startsWith("video/") ? "Vídeo" : "Foto"} ·{" "}
            {(item.byte_size / 1024 / 1024).toFixed(1)} MB
          </small>
          <span
            className={`gallery-status status-${request?.status || "available"}`}
          >
            {status}
          </span>
          {request?.status === "requested" && request.device_polled_at && (
            <small className="gallery-request-detail">
              O celular já recebeu este pedido.
            </small>
          )}
          {request?.error_message && (
            <small className="gallery-request-error">
              {request.error_message}
            </small>
          )}

          {request?.status === "ready" ? (
            <button
              disabled={busy === request.id}
              onClick={() => void downloadOriginal(request)}
            >
              <Download size={16} /> Baixar original
            </button>
          ) : request?.status === "requested" || request?.status === "uploading" ? (
            <button
              className="secondary"
              disabled={busy === request.id}
              onClick={() => void cancelRequest(request)}
            >
              <XCircle size={16} /> Cancelar solicitação
            </button>
          ) : (
            <button
              disabled={busy === item.id}
              onClick={() => void requestOriginal(item)}
            >
              {request ? "Solicitar novamente" : "Solicitar original"}
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <section className="panel master-mobile-gallery">
      <div className="spread">
        <div>
          <h2>Galeria do celular</h2>
          <p className="muted">
            Miniaturas privadas separadas por conta e aparelho. A atualização é
            manual para reduzir o consumo do Storage.
          </p>
        </div>
        <button
          onClick={() => void refreshGallery()}
          aria-label="Atualizar galeria"
          disabled={refreshing}
        >
          <RefreshCw size={17} /> {refreshing ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!devices.length ? (
        <p className="muted">
          Abra o aplicativo Android em um celular e entre em qualquer conta
          ativa do Alvorecer para iniciar a sincronização.
        </p>
      ) : (
        accounts.map((account) => {
          const selectedId =
            selectedDevices[account.userId] &&
            account.devices.some(
              (device) => device.id === selectedDevices[account.userId],
            )
              ? selectedDevices[account.userId]
              : account.devices[0]?.id;
          const selectedDevice = account.devices.find(
            (device) => device.id === selectedId,
          );
          const selectedItems = selectedDevice
            ? items.filter((item) => item.device_id === selectedDevice.id)
            : [];
          const page = selectedDevice ? pages[selectedDevice.id] : undefined;

          return (
            <section className="mobile-gallery-account" key={account.userId}>
              <div className="spread">
                <div>
                  <h3>{account.name}</h3>
                  <p className="muted">@{account.username}</p>
                </div>
              </div>

              <p className="mobile-gallery-device-hint">
                Escolha um aparelho para abrir somente a galeria dele.
              </p>
              <div
                className="mobile-device-list"
                role="tablist"
                aria-label={`Aparelhos de ${account.name}`}
              >
                {account.devices.map((device) => {
                  const total = device.item_count || 0;
                  const shortId = device.id.slice(0, 6).toUpperCase();
                  const selected = device.id === selectedId;

                  return (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      className={`mobile-device-tab ${selected ? "selected" : ""} ${
                        online(device.id) ? "device-online" : "device-offline"
                      }`}
                      key={device.id}
                      onClick={() =>
                        setSelectedDevices((current) => ({
                          ...current,
                          [account.userId]: device.id,
                        }))
                      }
                    >
                      <Smartphone size={17} />
                      <span>
                        <strong>{device.device_name}</strong>
                        <small>
                          Dispositivo {shortId} · {total}{" "}
                          {total === 1 ? "arquivo" : "arquivos"}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>

              {selectedDevice && (
                <section
                  className="mobile-gallery-device"
                  aria-label={`Galeria de ${selectedDevice.device_name}`}
                >
                  <div className="mobile-gallery-device-heading">
                    <div>
                      <h4>
                        <Smartphone size={16} /> {selectedDevice.device_name}
                      </h4>
                      <p className="muted">
                        Dispositivo {selectedDevice.id.slice(0, 6).toUpperCase()} ·{" "}
                        {online(selectedDevice.id)
                          ? "Disponível"
                          : "Celular offline"}
                      </p>
                    </div>
                    <strong>
                      {selectedDevice.item_count || 0}{" "}
                      {(selectedDevice.item_count || 0) === 1
                        ? "arquivo"
                        : "arquivos"}
                    </strong>
                  </div>

                  <div className="mobile-gallery-grid">
                    {selectedItems.map(renderItem)}
                  </div>

                  {page?.loading && !selectedItems.length && (
                    <p className="muted">Carregando miniaturas...</p>
                  )}

                  {!page?.loading &&
                    !selectedItems.length &&
                    (selectedDevice.item_count || 0) === 0 && (
                      <p className="muted">
                        Aguardando a primeira sincronização deste aparelho.
                      </p>
                    )}

                  {page?.hasMore && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={page.loading}
                      onClick={() =>
                        void loadDevicePage(
                          selectedDevice.id,
                          page.loaded,
                          false,
                        )
                      }
                    >
                      {page.loading ? "Carregando..." : "Carregar mais 40"}
                    </button>
                  )}
                </section>
              )}
            </section>
          );
        })
      )}
    </section>
  );
}
