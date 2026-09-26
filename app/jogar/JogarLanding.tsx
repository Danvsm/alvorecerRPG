"use client";

import Image from "next/image";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  CircleDollarSign,
  Clock3,
  MapPin,
  MessageCircle,
  Pizza,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Swords,
  Users,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { RECRUITMENT_CAMPAIGN, TABLE_CONTACT_URL } from "@/lib/recruitment";
import styles from "./jogar.module.css";
import { useScrollReveal } from "@/lib/useScrollReveal";
import RecruitmentCounter from "./RecruitmentCounter";

type Experience =
  "iniciante" | "algumas_vezes" | "intermediario" | "experiente";

type FormState = {
  fullName: string;
  preferredName: string;
  age: string;
  email: string;
  whatsapp: string;
  instagram: string;
  city: string;
  neighborhood: string;
  experienceLevel: Experience | "";
  availability: string;
  preferredTime: string;
  expectations: string;
  avoidedContent: string;
  discoverySource: string;
  contactConsent: boolean;
  website: string;
};

const initialForm: FormState = {
  fullName: "",
  preferredName: "",
  age: "",
  email: "",
  whatsapp: "",
  instagram: "",
  city: "",
  neighborhood: "",
  experienceLevel: "",
  availability: "",
  preferredTime: "",
  expectations: "",
  avoidedContent: "",
  discoverySource: "",
  contactConsent: false,
  website: "",
};

const experienceOptions: Array<{
  value: Experience;
  title: string;
  text: string;
}> = [
  {
    value: "iniciante",
    title: "Nunca joguei",
    text: "Quero conhecer RPG pela primeira vez.",
  },
  {
    value: "algumas_vezes",
    title: "Joguei algumas vezes",
    text: "Já participei de sessões ou aventuras curtas.",
  },
  {
    value: "intermediario",
    title: "Tenho experiência",
    text: "Já conheço a dinâmica de uma mesa de RPG.",
  },
  {
    value: "experiente",
    title: "Jogo há bastante tempo",
    text: "Já participei de campanhas e conheço vários jogos.",
  },
];

const stepTitles = [
  "Vamos conhecer você",
  "Contato e localização",
  "Sua experiência e agenda",
  "O que você busca na mesa",
];

function formatWhatsapp(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 13);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 11)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
}

export default function JogarLanding() {
  const motionRoot = useScrollReveal<HTMLElement>();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(initialForm);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const progress = step * 25;
  const formHeading = useRef<HTMLDivElement>(null);
  const previousStep = useRef(step);

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    formHeading.current?.focus({ preventScroll: true });
    formHeading.current?.scrollIntoView({
      block: "start",
      behavior: "instant",
    });
  }, [step]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (error) setError("");
  };

  const validateStep = (target: number) => {
    if (target === 1) {
      if (form.fullName.trim().length < 3) {
        setError("Informe seu nome e sobrenome.");
        return false;
      }
      if (form.preferredName.trim().length < 2) {
        setError("Informe como gostaria de ser chamado.");
        return false;
      }
      const age = Number(form.age);
      if (!Number.isInteger(age) || age < 1 || age > 120) {
        setError("Informe uma idade válida.");
        return false;
      }
    }

    if (target === 2) {
      if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
        setError("Informe um e-mail válido.");
        return false;
      }
      if (form.whatsapp.replace(/\D/g, "").length < 8) {
        setError("Informe um WhatsApp válido.");
        return false;
      }
      if (form.city.trim().length < 2) {
        setError("Informe sua cidade ou município.");
        return false;
      }
      if (form.neighborhood.trim().length < 2) {
        setError("Informe seu bairro.");
        return false;
      }
    }

    if (target === 3) {
      if (!form.experienceLevel) {
        setError("Selecione sua experiência com RPG.");
        return false;
      }
      if (form.availability.trim().length < 2) {
        setError("Informe sua disponibilidade.");
        return false;
      }
      if (!form.preferredTime) {
        setError("Informe sua preferência de horário.");
        return false;
      }
    }

    if (target === 4) {
      if (form.expectations.trim().length < 3) {
        setError("Conte o que espera de uma mesa de RPG.");
        return false;
      }
      if (!form.discoverySource) {
        setError("Informe como conheceu o projeto.");
        return false;
      }
      if (!form.contactConsent) {
        setError("Autorize o contato para concluir.");
        return false;
      }
    }

    setError("");
    return true;
  };

  const next = () => {
    if (!validateStep(step)) return;
    setStep((current) => Math.min(4, current + 1));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validateStep(4) || sending) return;

    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/interesse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, age: Number(form.age) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Não foi possível enviar agora.");
      }
      setDone(true);
      setForm(initialForm);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível enviar agora. Tente novamente.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <main className={styles.page} ref={motionRoot}>
      <header className={styles.header}>
        <a className={styles.brand} href="#inicio" aria-label="Alvorecer">
          <Image src="/alvorecer-mark.svg" width={38} height={38} alt="" />
          <span>
            <strong>ALVORECER</strong>
            <small>VSM PRODUÇÃO</small>
          </span>
        </a>
        <nav className={styles.headerNav} aria-label="Conheça a campanha">
          <a href="#campanha">A campanha</a>
          <a href="#participar">Como participar</a>
        </nav>
        <a className={styles.headerCta} href="#inscricao">
          Inscreva-se
        </a>
      </header>

      <section className={styles.hero} id="inicio">
        <Image
          className={styles.coverImage}
          src="/jogar/amanhecer-hero.webp"
          alt=""
          fill
          sizes="100vw"
          preload
        />
        <div className={styles.heroShade} aria-hidden="true" />
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>CAMPANHA PRESENCIAL DE RPG</p>
          <h1>
            <span>CONHEÇA O RPG</span>
            ALVORECER
          </h1>
          <p className={styles.byline}>
            Criado pela Produção VSM
            <br />
            Campanha: <strong>{RECRUITMENT_CAMPAIGN}</strong>
          </p>
          <p className={styles.heroCopy}>
            Um RPG de fantasia feito para quem está começando ou já teve algum
            contato com o gênero, com regras fáceis de aprender e um mundo cheio
            de escolhas.
          </p>
          <div className={styles.heroTags} aria-label="Informações principais">
            <span>Iniciantes bem-vindos</span>
            <span>Nova Iguaçu</span>
            <span>1ª temporada · 5 sessões</span>
          </div>
          <a className={styles.primaryCta} href="#inscricao">
            INSCREVA-SE <ArrowRight aria-hidden="true" />
          </a>
        </div>
      </section>

      <section className={styles.campaignSection} id="campanha">
        <div className={styles.campaignArt}>
          <Image
            className={styles.coverImage}
            src="/jogar/dama-de-sangue.webp"
            alt=""
            fill
            sizes="(max-width: 760px) 100vw, 45vw"
          />
          <div className={styles.bloodShade} aria-hidden="true" />
        </div>
        <div className={styles.sectionCopy} data-reveal>
          <p className={styles.eyebrow}>A PROMESSA DO AMANHECER</p>
          <h2>Uma campanha de aventura, mistério e escolhas.</h2>
          <p>
            Sete reinos guardam histórias antigas enquanto a presença da Dama de
            Sangue volta a caminhar. Cada decisão do grupo pode proteger o
            amanhecer — ou aproximar a escuridão.
          </p>
          <div className={styles.storyPoints}>
            <span>
              <Swords aria-hidden="true" /> Combates intensos
            </span>
            <span>
              <Sparkles aria-hidden="true" /> Mistérios do mundo
            </span>
            <span>
              <Users aria-hidden="true" /> Personagens marcantes
            </span>
          </div>
        </div>
      </section>

      <section className={styles.worldSection}>
        <div className={styles.worldArt}>
          <Image
            className={styles.coverImage}
            src="/jogar/mundo.webp"
            alt="Paisagem fantástica com reinos, montanhas e rios"
            fill
            sizes="100vw"
          />
          <div className={styles.worldShade} aria-hidden="true" />
          <div className={styles.worldCopy} data-reveal>
            <p className={styles.eyebrow}>CONHEÇA O MUNDO</p>
            <h2>Fantasia, descobertas e espaço para sua história.</h2>
            <p>
              Reinos, guildas, crenças e segredos criam um cenário que responde
              às escolhas da mesa.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.sessionSection}>
        <div className={styles.sessionArt}>
          <Image
            className={styles.coverImage}
            src="/jogar/sessao.webp"
            alt="Grupo reunido em volta de uma mesa de RPG"
            fill
            sizes="(max-width: 760px) 100vw, 52vw"
          />
        </div>
        <div className={styles.sessionCopy} data-reveal>
          <p className={styles.eyebrow}>COMO FUNCIONA A SESSÃO</p>
          <h2>Você não precisa chegar sabendo tudo.</h2>
          <ol>
            <li>
              <span>1</span>
              <div>
                <strong>Crie seu herói</strong>
                <p>Escolha sua ideia de personagem com apoio da mesa.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Entre na história</strong>
                <p>O Mestre apresenta o cenário, os desafios e as escolhas.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Viva a aventura</strong>
                <p>Converse, interprete e role o dado quando for necessário.</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section className={styles.conversionSection} id="participar">
        <div className={styles.conversionIntro} data-reveal>
          <Sun aria-hidden="true" />
          <h2>
            SEU AMANHECER
            <br />
            COMEÇA AGORA
          </h2>
          <p>
            Se você quer viver uma aventura fantástica, este pode ser o seu
            primeiro passo.
          </p>
        </div>

        <div className={styles.benefits}>
          <h3>UMA EXPERIÊNCIA PREPARADA PARA VOCÊ</h3>
          <div className={styles.benefitGrid}>
            <article data-reveal data-reveal-delay="0">
              <svg
                className={styles.d20Icon}
                viewBox="0 0 32 32"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M16 2 29 9v14L16 30 3 23V9Z M16 2 8 10h16ZM3 9l5 1-5 13m26-14-5 1 5 13M8 10l-2 12h20l-2-12M6 22l10 8 10-8" />
                <text
                  x="16"
                  y="20"
                  fill="currentColor"
                  stroke="none"
                  textAnchor="middle"
                  fontSize="9"
                  fontFamily="sans-serif"
                >
                  20
                </text>
              </svg>
              <h4>Mestre com +10 anos narrando</h4>
              <p>
                Histórias envolventes e uma mesa preparada também para novos
                jogadores.
              </p>
            </article>
            <article data-reveal data-reveal-delay="80">
              <Smartphone aria-hidden="true" />
              <h4>Aplicativo da campanha</h4>
              <p>
                Acompanhe personagem, sistema e informações importantes pelo
                aplicativo.
              </p>
            </article>
            <article data-reveal data-reveal-delay="160">
              <Sparkles aria-hidden="true" />
              <h4>Guelfor — seu guia no Alvorecer</h4>
              <p>
                Tire dúvidas sobre regras, ficha, habilidades e o sistema durante
                a campanha.
              </p>
            </article>
            <article data-reveal data-reveal-delay="240">
              <Pizza aria-hidden="true" />
              <h4>Lanche durante as sessões</h4>
              <p>
                Um ambiente preparado para jogar, conversar e aproveitar a noite
                com o grupo.
              </p>
            </article>
          </div>
        </div>

        <div className={styles.campaignFacts} data-reveal>
          <div>
            <Users aria-hidden="true" />
            <strong>1ª temporada</strong>
            <span>com 5 sessões presenciais</span>
          </div>
          <div>
            <CircleDollarSign aria-hidden="true" />
            <del className={styles.originalPrice}>De R$ 25,00</del>
            <span className={styles.pricePrefix}>por</span>
            <strong>R$ 9,80</strong>
            <span>por sessão no pacote promocional</span>
          </div>
          <div>
            <ShieldCheck aria-hidden="true" />
            <span className={styles.promotionLabel}>Valor promocional</span>
            <del className={styles.originalPrice}>De R$ 100,00</del>
            <span className={styles.pricePrefix}>por</span>
            <strong>R$ 49,00</strong>
            <span>pacote completo</span>
          </div>
          <div>
            <MapPin aria-hidden="true" />
            <strong>Figueira</strong>
            <span>Nova Iguaçu, RJ</span>
          </div>
        </div>

        <p className={styles.packageNote}>
          As sessões não são vendidas individualmente. A participação é pelo
          pacote completo de 5 encontros. O endereço exato será informado aos
          participantes apropriados; o espaço é reservado e preparado para as
          sessões.
        </p>

        <p className={styles.limitedPlaces}>
          <Users size={16} aria-hidden="true" />
          <span><strong>Vagas limitadas para esta temporada.</strong></span>
        </p>
        <div className={styles.finalActions}>
          <a className={styles.primaryCta} href="#inscricao">
            INSCREVA-SE <ArrowRight aria-hidden="true" />
          </a>
          {TABLE_CONTACT_URL ? (
            <a
              className={styles.contactCta}
              href={TABLE_CONTACT_URL}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle aria-hidden="true" /> FALAR COM O MESTRE
            </a>
          ) : (
            <button
              className={styles.contactCta}
              type="button"
              disabled
              title="Canal de contato em configuração"
            >
              <MessageCircle aria-hidden="true" /> FALAR COM O MESTRE
            </button>
          )}
        </div>
      </section>

      <section className={styles.formSection} id="inscricao">
        <div className={styles.formIntro} data-reveal>
          <p className={styles.eyebrow}>INSCRIÇÃO</p>
          <h2>Conte um pouco sobre você.</h2>
          <p>
            Suas respostas serão vistas somente pelo Mestre e usadas para
            organizar a seleção da campanha.
          </p>
        </div>

        <div className={styles.formShell}>
          {done ? (
            <div className={styles.success} role="status">
              <span>
                <Check aria-hidden="true" />
              </span>
              <p className={styles.eyebrow}>INSCRIÇÃO RECEBIDA</p>
              <h3>Seu primeiro passo foi registrado.</h3>
              <p>
                Sua inscrição para {RECRUITMENT_CAMPAIGN} está como “Nova”. O
                Mestre poderá analisar suas respostas e entrar em contato.
              </p>
              <button
                type="button"
                onClick={() => {
                  setDone(false);
                  setStep(1);
                }}
              >
                Enviar outra inscrição
              </button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <div
                className={styles.formTop}
                ref={formHeading}
                tabIndex={-1}
                role="group"
                aria-label={`Etapa ${step} de 4: ${stepTitles[step - 1]}`}
              >
                <div>
                  <span>ETAPA {step} DE 4</span>
                  <strong>{stepTitles[step - 1]}</strong>
                </div>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className={styles.progressTrack} aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </div>

              {step === 1 && (
                <div className={styles.formStep} key="identity">
                  <label>
                    Nome + sobrenome
                    <input
                      value={form.fullName}
                      onChange={(event) =>
                        update("fullName", event.target.value)
                      }
                      autoComplete="name"
                      maxLength={120}
                      required
                    />
                  </label>
                  <label>
                    Como gostaria de ser chamado
                    <input
                      value={form.preferredName}
                      onChange={(event) =>
                        update("preferredName", event.target.value)
                      }
                      maxLength={80}
                      required
                    />
                  </label>
                  <label className={styles.smallField}>
                    Idade
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="120"
                      value={form.age}
                      onChange={(event) => update("age", event.target.value)}
                      required
                    />
                  </label>
                </div>
              )}

              {step === 2 && (
                <div className={styles.formStep} key="contact">
                  <label>
                    E-mail
                    <input
                      type="email"
                      value={form.email}
                      onChange={(event) => update("email", event.target.value)}
                      autoComplete="email"
                      maxLength={254}
                      required
                    />
                  </label>
                  <label>
                    WhatsApp
                    <input
                      value={form.whatsapp}
                      onChange={(event) =>
                        update("whatsapp", formatWhatsapp(event.target.value))
                      }
                      inputMode="tel"
                      autoComplete="tel"
                      maxLength={32}
                      placeholder="(21) 99999-9999"
                      required
                    />
                  </label>
                  <label>
                    Instagram <small>opcional</small>
                    <input
                      value={form.instagram}
                      onChange={(event) =>
                        update("instagram", event.target.value)
                      }
                      maxLength={80}
                      placeholder="@seuinstagram"
                    />
                  </label>
                  <div className={styles.twoColumns}>
                    <label>
                      Cidade/Município
                      <input
                        value={form.city}
                        onChange={(event) => update("city", event.target.value)}
                        autoComplete="address-level2"
                        maxLength={100}
                        required
                      />
                    </label>
                    <label>
                      Bairro
                      <input
                        value={form.neighborhood}
                        onChange={(event) =>
                          update("neighborhood", event.target.value)
                        }
                        autoComplete="address-level3"
                        maxLength={100}
                        required
                      />
                    </label>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className={styles.formStep} key="experience">
                  <fieldset className={styles.experienceFieldset}>
                    <legend>Experiência com RPG</legend>
                    <div className={styles.experienceGrid}>
                      {experienceOptions.map((option) => (
                        <label
                          key={option.value}
                          className={
                            form.experienceLevel === option.value
                              ? styles.experienceSelected
                              : ""
                          }
                        >
                          <input
                            type="radio"
                            name="experience"
                            value={option.value}
                            checked={form.experienceLevel === option.value}
                            onChange={() =>
                              update("experienceLevel", option.value)
                            }
                          />
                          <strong>{option.title}</strong>
                          <span>{option.text}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label>
                    Disponibilidade
                    <textarea
                      value={form.availability}
                      onChange={(event) =>
                        update("availability", event.target.value)
                      }
                      rows={3}
                      maxLength={200}
                      placeholder="Ex.: sábados alternados e domingos."
                      required
                    />
                  </label>
                  <label>
                    Preferência de horário
                    <select
                      value={form.preferredTime}
                      onChange={(event) =>
                        update("preferredTime", event.target.value)
                      }
                      required
                    >
                      <option value="">Selecione</option>
                      <option value="Manhã">Manhã</option>
                      <option value="Tarde">Tarde</option>
                      <option value="Noite">Noite</option>
                      <option value="Flexível">Horário flexível</option>
                    </select>
                  </label>
                </div>
              )}

              {step === 4 && (
                <div className={styles.formStep} key="expectations">
                  <label>
                    O que espera de uma mesa de RPG?
                    <textarea
                      value={form.expectations}
                      onChange={(event) =>
                        update("expectations", event.target.value)
                      }
                      rows={5}
                      maxLength={1500}
                      required
                    />
                  </label>
                  <label>
                    Há algum conteúdo que prefere não encontrar durante o jogo?{" "}
                    <small>opcional</small>
                    <textarea
                      value={form.avoidedContent}
                      onChange={(event) =>
                        update("avoidedContent", event.target.value)
                      }
                      rows={4}
                      maxLength={1500}
                    />
                  </label>
                  <label>
                    Como conheceu o projeto?
                    <select
                      value={form.discoverySource}
                      onChange={(event) =>
                        update("discoverySource", event.target.value)
                      }
                      required
                    >
                      <option value="">Selecione</option>
                      <option value="Instagram">Instagram</option>
                      <option value="WhatsApp">WhatsApp</option>
                      <option value="QR Code">QR Code</option>
                      <option value="Indicação">Indicação</option>
                      <option value="Outro">Outro</option>
                    </select>
                  </label>
                  <label className={styles.consent}>
                    <input
                      type="checkbox"
                      checked={form.contactConsent}
                      onChange={(event) =>
                        update("contactConsent", event.target.checked)
                      }
                    />
                    <span>
                      Autorizo o contato pelos dados informados sobre esta
                      campanha.
                    </span>
                  </label>
                  <label className={styles.honeypot} aria-hidden="true">
                    Website
                    <input
                      tabIndex={-1}
                      autoComplete="off"
                      value={form.website}
                      onChange={(event) =>
                        update("website", event.target.value)
                      }
                    />
                  </label>
                </div>
              )}

              {error && (
                <p className={styles.error} role="alert" aria-live="polite">
                  {error}
                </p>
              )}

              <div className={styles.formActions}>
                {step > 1 ? (
                  <button
                    type="button"
                    className={styles.backButton}
                    onClick={() => {
                      setError("");
                      setStep((current) => Math.max(1, current - 1));
                    }}
                  >
                    <ChevronLeft aria-hidden="true" /> Voltar
                  </button>
                ) : (
                  <span />
                )}
                {step < 4 ? (
                  <button
                    type="button"
                    className={styles.continueButton}
                    onClick={next}
                  >
                    Continuar <ArrowRight aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className={styles.continueButton}
                    disabled={sending}
                  >
                    {sending ? "Enviando..." : "Enviar inscrição"}
                    {!sending && <ArrowRight aria-hidden="true" />}
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </section>

      <footer className={styles.footer}>
        <Image src="/alvorecer-mark.svg" width={32} height={32} alt="" />
        <span>
          <strong>Alvorecer RPG</strong>
          <small>Produção VSM · Nova Iguaçu, RJ</small>
        </span>
        <Clock3 aria-hidden="true" />
      </footer>
      <RecruitmentCounter refreshKey={done} />
    </main>
  );
}
