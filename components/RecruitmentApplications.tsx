"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Save,
  UserRoundSearch,
} from "lucide-react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage } from "@/lib/network";
import {
  recruitmentStatusLabel,
  recruitmentStatuses,
  type RecruitmentStatus,
} from "@/lib/recruitment";
import styles from "./RecruitmentApplications.module.css";

type Application = {
  id: string;
  full_name: string;
  preferred_name: string | null;
  age: number;
  email: string;
  whatsapp: string;
  instagram: string | null;
  city: string | null;
  neighborhood: string | null;
  experience_level: string;
  availability: string | null;
  preferred_time: string | null;
  expectations: string | null;
  avoided_content: string | null;
  discovery_source: string | null;
  campaign_name: string;
  status: RecruitmentStatus;
  private_notes: string;
  created_at: string;
  updated_at: string;
};

type Draft = { status: RecruitmentStatus; notes: string };

const experienceLabel: Record<string, string> = {
  iniciante: "Nunca jogou",
  algumas_vezes: "Jogou algumas vezes",
  intermediario: "Tem experiência",
  experiente: "Joga há bastante tempo",
};

export default function RecruitmentApplications({
  campaign,
}: {
  campaign: string;
}) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const result = await browserDb().rpc("master_recruitment_applications", {
      c: campaign,
    });
    if (result.error) {
      setError(readableErrorMessage(result.error));
      setLoading(false);
      return;
    }

    const rows = (result.data || []) as Application[];
    setApplications(rows);
    setDrafts(
      Object.fromEntries(
        rows.map((application) => [
          application.id,
          {
            status: application.status,
            notes: application.private_notes || "",
          },
        ]),
      ),
    );
    setLoading(false);
  }, [campaign]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(
    () => ({
      total: applications.length,
      new: applications.filter((item) => item.status === "new").length,
      active: applications.filter((item) =>
        ["reviewing", "contacted"].includes(item.status),
      ).length,
      approved: applications.filter((item) => item.status === "approved")
        .length,
    }),
    [applications],
  );

  const changeDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
    setMessage("");
  };

  const save = async (application: Application) => {
    const draft = drafts[application.id];
    if (!draft || saving) return;
    setSaving(application.id);
    setError("");
    setMessage("");
    const result = await browserDb().rpc(
      "master_recruitment_application_update",
      {
        c: campaign,
        target: application.id,
        next_status: draft.status,
        notes: draft.notes,
      },
    );
    if (result.error) {
      setError(readableErrorMessage(result.error));
      setSaving("");
      return;
    }
    setApplications((current) =>
      current.map((item) =>
        item.id === application.id
          ? {
              ...item,
              status: draft.status,
              private_notes: draft.notes.trim(),
              updated_at: new Date().toISOString(),
            }
          : item,
      ),
    );
    setMessage(
      `Inscrição de ${application.preferred_name || application.full_name} atualizada.`,
    );
    setSaving("");
  };

  return (
    <section className={styles.panel}>
      <div className={styles.intro}>
        <div>
          <p>
            Candidatos de <strong>A Promessa do Amanhecer</strong>
          </p>
          <span>
            Contatos e respostas ficam visíveis somente para o Mestre.
          </span>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw aria-hidden="true" />
          Atualizar
        </button>
      </div>

      <div className={styles.stats}>
        <div>
          <strong>{counts.total}</strong>
          <span>Total</span>
        </div>
        <div>
          <strong>{counts.new}</strong>
          <span>Novas</span>
        </div>
        <div>
          <strong>{counts.active}</strong>
          <span>Em andamento</span>
        </div>
        <div>
          <strong>{counts.approved}</strong>
          <span>Aprovadas</span>
        </div>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className={styles.message} role="status">
          {message}
        </p>
      )}

      {loading ? (
        <p className={styles.empty}>Carregando inscrições...</p>
      ) : applications.length ? (
        <div className={styles.list}>
          {applications.map((application) => {
            const draft = drafts[application.id] || {
              status: application.status,
              notes: application.private_notes || "",
            };
            const phone = application.whatsapp.replace(/\D/g, "");
            const whatsappTarget =
              phone.startsWith("55") && phone.length >= 12
                ? phone
                : `55${phone}`;
            return (
              <article className={styles.card} key={application.id}>
                <div className={styles.cardTop}>
                  <div className={styles.avatar} aria-hidden="true">
                    {(application.preferred_name || application.full_name)
                      .slice(0, 1)
                      .toUpperCase()}
                  </div>
                  <div>
                    <h2>
                      {application.preferred_name || application.full_name}
                    </h2>
                    <p>
                      {application.full_name} · {application.age} anos
                    </p>
                  </div>
                  <span
                    className={styles.status}
                    data-status={application.status}
                  >
                    {recruitmentStatusLabel[application.status] ||
                      application.status}
                  </span>
                </div>

                <div className={styles.quickInfo}>
                  <a href={`mailto:${application.email}`}>
                    <Mail aria-hidden="true" /> {application.email}
                  </a>
                  <a
                    href={`https://wa.me/${whatsappTarget}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Phone aria-hidden="true" /> {application.whatsapp}
                  </a>
                  <span>
                    <MapPin aria-hidden="true" />
                    {[application.neighborhood, application.city]
                      .filter(Boolean)
                      .join(", ") || "Local não informado"}
                  </span>
                  <span>
                    <CalendarDays aria-hidden="true" />
                    {new Date(application.created_at).toLocaleString("pt-BR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                </div>

                <details className={styles.answers}>
                  <summary>Ver respostas completas</summary>
                  <dl>
                    <div>
                      <dt>Experiência</dt>
                      <dd>
                        {experienceLabel[application.experience_level] ||
                          application.experience_level}
                      </dd>
                    </div>
                    <div>
                      <dt>Disponibilidade</dt>
                      <dd>{application.availability || "Não informado"}</dd>
                    </div>
                    <div>
                      <dt>Horário preferido</dt>
                      <dd>{application.preferred_time || "Não informado"}</dd>
                    </div>
                    <div>
                      <dt>O que espera da mesa</dt>
                      <dd>{application.expectations || "Não informado"}</dd>
                    </div>
                    <div>
                      <dt>Conteúdos que prefere evitar</dt>
                      <dd>
                        {application.avoided_content || "Nenhum informado"}
                      </dd>
                    </div>
                    <div>
                      <dt>Como conheceu</dt>
                      <dd>{application.discovery_source || "Não informado"}</dd>
                    </div>
                    <div>
                      <dt>Instagram</dt>
                      <dd>{application.instagram || "Não informado"}</dd>
                    </div>
                  </dl>
                </details>

                <div className={styles.management}>
                  <label>
                    Status
                    <select
                      value={draft.status}
                      onChange={(event) =>
                        changeDraft(application.id, {
                          status: event.target.value as RecruitmentStatus,
                        })
                      }
                    >
                      {recruitmentStatuses.map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Notas privadas do Mestre
                    <textarea
                      value={draft.notes}
                      onChange={(event) =>
                        changeDraft(application.id, {
                          notes: event.target.value.slice(0, 4000),
                        })
                      }
                      rows={3}
                      placeholder="Anotações sobre contato, perfil e próximos passos."
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void save(application)}
                    disabled={saving === application.id}
                  >
                    <Save aria-hidden="true" />
                    {saving === application.id ? "Salvando..." : "Salvar"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.empty}>
          <UserRoundSearch aria-hidden="true" />
          <strong>Nenhuma inscrição recebida.</strong>
          <span>Novos candidatos aparecerão aqui automaticamente.</span>
        </div>
      )}
    </section>
  );
}
