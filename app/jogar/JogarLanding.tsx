"use client";

import Image from "next/image";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronLeft,
  Compass,
  ScrollText,
  Sparkles,
  Swords,
  Users,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import styles from "./jogar.module.css";

type Experience =
  | "iniciante"
  | "algumas_vezes"
  | "intermediario"
  | "experiente";

type FormState = {
  fullName: string;
  age: string;
  instagram: string;
  whatsapp: string;
  email: string;
  experienceLevel: Experience | "";
  systemsPlayed: string;
  about: string;
  contactConsent: boolean;
  website: string;
};

const initialForm: FormState = {
  fullName: "",
  age: "",
  instagram: "",
  whatsapp: "",
  email: "",
  experienceLevel: "",
  systemsPlayed: "",
  about: "",
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
    text: "Já participei de algumas sessões ou campanhas curtas.",
  },
  {
    value: "intermediario",
    title: "Intermediário",
    text: "Já conheço a dinâmica de mesa e alguns sistemas.",
  },
  {
    value: "experiente",
    title: "Experiente",
    text: "RPG já faz parte da minha rotina há bastante tempo.",
  },
];

function formatWhatsapp(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 13);
  if (!digits) return "";
  if (digits.length <= 2) return "(" + digits;
  if (digits.length <= 7)
    return "(" + digits.slice(0, 2) + ") " + digits.slice(2);
  if (digits.length <= 11)
    return (
      "(" +
      digits.slice(0, 2) +
      ") " +
      digits.slice(2, 7) +
      "-" +
      digits.slice(7)
    );
  return (
    "+" +
    digits.slice(0, 2) +
    " (" +
    digits.slice(2, 4) +
    ") " +
    digits.slice(4, 9) +
    "-" +
    digits.slice(9)
  );
}

export default function JogarLanding() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(initialForm);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const items = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.revealed);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16 },
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  const progress = useMemo(() => (step / 3) * 100, [step]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (error) setError("");
  };

  const validateStep = (target: number) => {
    if (target === 1) {
      if (form.fullName.trim().length < 3) {
        setError("Escreva seu nome e sobrenome.");
        return false;
      }
      const age = Number(form.age);
      if (!Number.isInteger(age) || age < 1 || age > 120) {
        setError("Informe uma idade válida.");
        return false;
      }
      if (form.instagram.trim().length < 2) {
        setError("Informe seu Instagram.");
        return false;
      }
    }

    if (target === 2) {
      if (form.whatsapp.replace(/\D/g, "").length < 8) {
        setError("Informe um WhatsApp válido.");
        return false;
      }
      if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
        setError("Informe um e-mail válido.");
        return false;
      }
    }

    if (target === 3) {
      if (!form.experienceLevel) {
        setError("Conte qual é a sua experiência com RPG.");
        return false;
      }
      if (!form.contactConsent) {
        setError("Autorize o contato para concluir a inscrição.");
        return false;
      }
    }

    setError("");
    return true;
  };

  const next = () => {
    if (!validateStep(step)) return;
    setStep((current) => Math.min(3, current + 1));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validateStep(3) || sending) return;

    setSending(true);
    setError("");

    try {
      const response = await fetch("/api/interesse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          age: Number(form.age),
        }),
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
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true">
        <div className={styles.auroraOne} />
        <div className={styles.auroraTwo} />
        <div className={styles.grain} />
        <div className={styles.particles}>
          {Array.from({ length: 18 }).map((_, index) => (
            <span key={index} />
          ))}
        </div>
      </div>

      <header className={styles.header}>
        <a className={styles.brand} href="#inicio" aria-label="Alvorecer">
          <Image src="/alvorecer-mark.svg" width={38} height={38} alt="" />
          <span>
            <strong>ALVORECER</strong>
            <small>A Promessa do Amanhecer</small>
          </span>
        </a>
        <a className={styles.headerCta} href="#inscricao">
          Quero participar
        </a>
      </header>

      <section className={styles.hero} id="inicio">
        <div className={styles.heroBackdrop} aria-hidden="true" />
        <div className={styles.heroContent}>
          <p className={styles.kicker}>UMA HISTÓRIA ESTÁ PRESTES A COMEÇAR</p>
          <h1 className={styles.heroTitle} aria-label="Alvorecer">
            {"ALVORECER".split("").map((letter, index) => (
              <span
                key={index}
                style={{ "--letter": index } as CSSProperties}
                aria-hidden="true"
              >
                {letter}
              </span>
            ))}
          </h1>
          <p className={styles.campaignName}>A Promessa do Amanhecer</p>
          <p className={styles.heroCopy}>
            Há mundos que você observa. Este foi feito para ser vivido.
          </p>
          <div className={styles.heroActions}>
            <a className={styles.primaryCta} href="#mundo">
              Conhecer o Alvorecer <ArrowDown size={18} />
            </a>
            <a className={styles.secondaryCta} href="#inscricao">
              Manifestar interesse
            </a>
          </div>
        </div>

        <div className={styles.heroSigil} aria-hidden="true">
          <div className={styles.sigilRing} />
          <Image
            src="/alvorecer-mark.svg"
            width={158}
            height={158}
            alt=""
            priority
          />
        </div>

        <div className={styles.scrollHint} aria-hidden="true">
          <span />
          DESÇA PARA ENTRAR
        </div>
      </section>

      <section className={styles.manifesto} id="mundo">
        <div className={styles.sectionIntro} data-reveal>
          <span className={styles.sectionNumber}>01</span>
          <p>O MUNDO</p>
          <h2>A história não começa na ficha.</h2>
          <p className={styles.lead}>
            Ela começa quando pessoas diferentes sentam à mesma mesa e decidem
            descobrir o que existe depois do próximo passo.
          </p>
        </div>

        <div className={styles.worldStage} data-reveal>
          <div className={styles.worldImage} aria-hidden="true" />
          <div className={styles.worldShade} aria-hidden="true" />
          <div className={styles.worldTitle}>
            <small>ALVORECER</small>
            <strong>A Promessa do Amanhecer</strong>
          </div>
          <div className={styles.floatCard + " " + styles.cardOne}>
            <Compass size={22} />
            <strong>Um mundo para explorar</strong>
            <span>
              Fantasia, descoberta e espaço para seu personagem construir a
              própria trajetória.
            </span>
          </div>
          <div className={styles.floatCard + " " + styles.cardTwo}>
            <Swords size={22} />
            <strong>Escolhas com peso</strong>
            <span>
              Decisões, relações e consequências fazem cada sessão deixar uma
              marca na campanha.
            </span>
          </div>
          <div className={styles.floatCard + " " + styles.cardThree}>
            <Users size={22} />
            <strong>Uma história em grupo</strong>
            <span>
              O Alvorecer cresce com quem joga. Não existe aventura sem a mesa.
            </span>
          </div>
        </div>
      </section>

      <section className={styles.storySection}>
        <div className={styles.storyText} data-reveal>
          <span className={styles.sectionNumber}>02</span>
          <p>O CHAMADO</p>
          <h2>Você não precisa chegar sabendo tudo.</h2>
          <p>
            Nunca jogou RPG? Tudo bem. Já joga há anos? Também. A ideia deste
            cadastro é conhecer quem tem vontade de participar e entender quem
            pode combinar com uma próxima mesa.
          </p>
        </div>

        <div className={styles.storyCards}>
          <article data-reveal>
            <Sparkles />
            <span>Primeira vez</span>
            <strong>Curiosidade vale mais que currículo.</strong>
          </article>
          <article data-reveal>
            <ScrollText />
            <span>Alguma experiência</span>
            <strong>Conte quais sistemas e mesas já passaram por você.</strong>
          </article>
          <article data-reveal>
            <Users />
            <span>Mais importante</span>
            <strong>Vontade de construir uma boa história em grupo.</strong>
          </article>
        </div>
      </section>

      <section className={styles.formSection} id="inscricao">
        <div className={styles.formIntro} data-reveal>
          <span className={styles.sectionNumber}>03</span>
          <p>MANIFESTE SEU INTERESSE</p>
          <h2>Talvez o próximo nome da história seja o seu.</h2>
          <p>
            Este cadastro não cria uma conta e não garante uma vaga. Ele serve
            para conhecermos você e entrarmos em contato quando surgir uma
            oportunidade de mesa.
          </p>
        </div>

        <div className={styles.formShell} data-reveal>
          {done ? (
            <div className={styles.success}>
              <div className={styles.successIcon}>
                <Check size={34} />
              </div>
              <span>INSCRIÇÃO RECEBIDA</span>
              <h3>Seu nome entrou no chamado.</h3>
              <p>
                Se houver encaixe para uma próxima mesa, entraremos em contato
                pelos dados que você enviou.
              </p>
              <button
                type="button"
                onClick={() => {
                  setDone(false);
                  setStep(1);
                }}
              >
                Voltar ao início do formulário
              </button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <div className={styles.formTop}>
                <div>
                  <span>ETAPA {step} DE 3</span>
                  <strong>
                    {step === 1
                      ? "Quem atravessa o portal?"
                      : step === 2
                        ? "Como o chamado chega até você?"
                        : "Sua história com RPG"}
                  </strong>
                </div>
                <span className={styles.progressNumber}>
                  {Math.round(progress)}%
                </span>
              </div>

              <div className={styles.progressTrack} aria-hidden="true">
                <span style={{ width: String(progress) + "%" }} />
              </div>

              {step === 1 && (
                <div className={styles.formStep}>
                  <label>
                    Nome e sobrenome
                    <input
                      value={form.fullName}
                      onChange={(event) =>
                        update("fullName", event.target.value)
                      }
                      autoComplete="name"
                      placeholder="Como você se apresenta?"
                    />
                  </label>
                  <div className={styles.twoColumns}>
                    <label>
                      Idade
                      <input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max="120"
                        value={form.age}
                        onChange={(event) => update("age", event.target.value)}
                        placeholder="29"
                      />
                    </label>
                    <label>
                      Instagram
                      <input
                        value={form.instagram}
                        onChange={(event) =>
                          update("instagram", event.target.value)
                        }
                        autoComplete="off"
                        placeholder="@seuinstagram"
                      />
                    </label>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className={styles.formStep}>
                  <label>
                    WhatsApp
                    <input
                      value={form.whatsapp}
                      onChange={(event) =>
                        update("whatsapp", formatWhatsapp(event.target.value))
                      }
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="(21) 99999-9999"
                    />
                  </label>
                  <label>
                    E-mail
                    <input
                      type="email"
                      value={form.email}
                      onChange={(event) => update("email", event.target.value)}
                      autoComplete="email"
                      placeholder="voce@exemplo.com"
                    />
                  </label>
                  <p className={styles.formNote}>
                    Usaremos estes dados somente para falar com você sobre uma
                    possível participação no Alvorecer.
                  </p>
                </div>
              )}

              {step === 3 && (
                <div className={styles.formStep}>
                  <fieldset className={styles.experienceFieldset}>
                    <legend>Como você se considera no RPG?</legend>
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
                    Quais sistemas você já jogou?
                    <textarea
                      value={form.systemsPlayed}
                      onChange={(event) =>
                        update("systemsPlayed", event.target.value)
                      }
                      rows={3}
                      placeholder="Se for sua primeira vez, pode deixar em branco."
                    />
                  </label>

                  <label>
                    Quer contar mais alguma coisa sobre você?
                    <textarea
                      value={form.about}
                      onChange={(event) => update("about", event.target.value)}
                      rows={4}
                      placeholder="Opcional. Pode ser curto."
                    />
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
                      Autorizo o contato pelos dados informados sobre uma
                      possível participação no Alvorecer.
                    </span>
                  </label>

                  <label className={styles.honeypot} aria-hidden="true">
                    Website
                    <input
                      tabIndex={-1}
                      autoComplete="off"
                      value={form.website}
                      onChange={(event) => update("website", event.target.value)}
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
                    <ChevronLeft size={18} />
                    Voltar
                  </button>
                ) : (
                  <span />
                )}

                {step < 3 ? (
                  <button
                    type="button"
                    className={styles.continueButton}
                    onClick={next}
                  >
                    Continuar <ArrowRight size={18} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className={styles.continueButton}
                    disabled={sending}
                  >
                    {sending ? "Enviando..." : "Enviar meu interesse"}
                    {!sending && <ArrowRight size={18} />}
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </section>

      <footer className={styles.footer}>
        <Image src="/alvorecer-mark.svg" width={28} height={28} alt="" />
        <span>Alvorecer RPG</span>
        <small>A Promessa do Amanhecer</small>
      </footer>
    </main>
  );
}
