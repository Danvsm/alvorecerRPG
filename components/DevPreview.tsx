"use client";

import { useState } from "react";
import {
  BookOpen,
  ChevronRight,
  Coins,
  Eye,
  Heart,
  LayoutDashboard,
  Link as LinkIcon,
  Menu,
  Package,
  Settings,
  Shield,
  Skull,
  Sparkles,
  Star,
  Swords,
  Users,
  Zap,
} from "lucide-react";
import { Brand } from "./Common";

type Mode = "login" | "master" | "player";

const masterMenu = [
  ["Visão Geral", LayoutDashboard],
  ["Jogadores", Users],
  ["Personagens", Shield],
  ["Combate", Swords],
  ["Criaturas", Skull],
  ["Vantagens", Sparkles],
  ["Itens", Package],
  ["Campanha", BookOpen],
  ["Histórico", BookOpen],
  ["Convites", LinkIcon],
  ["Configurações", Settings],
] as const;

const playerMenu = [
  ["Início", LayoutDashboard],
  ["Minha Ficha", Shield],
  ["Vantagens", Sparkles],
  ["Inventário", Package],
  ["Histórico", BookOpen],
  ["Combate", Swords],
  ["Perfil", Users],
] as const;

const attrs = [
  ["Força", 5],
  ["Habilidade", 4],
  ["Armadura", 6],
  ["Vigor", 5],
  ["PDF", 2],
  ["Poder", 4],
  ["Consciência", 3],
  ["Esquiva", 4],
  ["Raciocínio", 5],
  ["Inteligência", 4],
  ["Aparência", 3],
];

const characters = [
  {
    name: "Kael",
    cls: "Guerreiro",
    race: "Humano",
    life: [42, 60],
    mana: [12, 20],
    stamina: [24, 30],
  },
  {
    name: "Aurora",
    cls: "Arcanista",
    race: "Elfa",
    life: [31, 45],
    mana: [38, 40],
    stamina: [17, 25],
  },
  {
    name: "Darian",
    cls: "Patrulheiro",
    race: "Humano",
    life: [18, 50],
    mana: [6, 15],
    stamina: [21, 28],
  },
];

function Resource({
  icon: Icon,
  name,
  current,
  max,
  tone,
}: {
  icon: any;
  name: string;
  current: number;
  max: number;
  tone: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round((current / max) * 100)));
  return (
    <div className="resource">
      <div className="spread">
        <span>
          <Icon size={16} /> {name}
        </span>
        <strong>
          {current}
          <small> / {max}</small>
        </strong>
      </div>
      <div className="track">
        <div className={tone} style={{ width: `${pct}%` }} />
      </div>
      <div className="stepper">
        {[-10, -5, -1, 1, 5, 10].map((n) => (
          <button key={n} type="button">
            {n > 0 ? "+" : ""}
            {n}
          </button>
        ))}
        <button type="button">...</button>
      </div>
    </div>
  );
}

function CharacterHeading({
  name = "Kael",
  cls = "Guerreiro",
  race = "Humano",
}) {
  return (
    <div className="character-heading">
      <div className="portrait empty-portrait">
        <Shield size={34} />
      </div>
      <div>
        <h2>{name}</h2>
        <p>
          {cls} · {race}
        </p>
      </div>
    </div>
  );
}

export default function DevPreview() {
  const [mode, setMode] = useState<Mode>("master");
  const [page, setPage] = useState("Visão Geral");
  const [menu, setMenu] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setPage(next === "player" ? "Início" : "Visão Geral");
    setMenu(false);
  }

  if (mode === "login") {
    return (
      <main className="auth">
        <div className="auth-panel">
          <div className="preview-switcher" aria-label="Modo de visualização">
            <button type="button" className="active">
              Login
            </button>
            <button type="button" onClick={() => switchMode("master")}>
              Mestre
            </button>
            <button type="button" onClick={() => switchMode("player")}>
              Jogador
            </button>
          </div>
          <Brand />
          <div className="auth-symbol">
            <Swords size={40} />
          </div>
          <p className="eyebrow">A PROMESSA DO AMANHECER</p>
          <h1>Sua próxima sessão começa aqui.</h1>
          <p>Entre para acompanhar sua ficha e sua campanha.</p>
          <form onSubmit={(e) => e.preventDefault()}>
            <label>
              Username
              <input defaultValue="kael" />
            </label>
            <label>
              Senha
              <input type="password" defaultValue="batata123" />
            </label>
            <button className="primary" type="submit">
              Entrar <ChevronRight size={18} />
            </button>
          </form>
          <small className="muted">Prévia local, nenhum dado é enviado.</small>
        </div>
      </main>
    );
  }

  const isMaster = mode === "master";
  const menuItems = isMaster ? masterMenu : playerMenu;
  const effectivePage = isMaster
    ? page
    : page === "Visão Geral"
      ? "Início"
      : page;

  return (
    <div className="app dev-preview">
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <Brand />
        <div className="campaign-switch">
          <small>CAMPANHA</small>
          <select defaultValue="Alvorecer">
            <option>Alvorecer</option>
          </select>
        </div>
        <nav>
          {menuItems.map(([name, Icon]) => (
            <button
              type="button"
              className={effectivePage === name ? "active" : ""}
              key={name}
              onClick={() => {
                setPage(name);
                setMenu(false);
              }}
            >
              <Icon size={18} /> {name}
            </button>
          ))}
          {!isMaster && (
            <>
              <span className="coming">
                Lojas <small>Em breve</small>
              </span>
              <span className="coming">
                Runas <small>Em breve</small>
              </span>
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          <span>{isMaster ? "Mestre" : "Jogador"}</span>
          <span className="badge">PREVIEW</span>
        </div>
      </aside>
      {menu && (
        <button
          type="button"
          className="scrim"
          aria-label="Fechar menu"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <button
            type="button"
            className="mobile-toggle"
            aria-label="Abrir menu"
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
          <span>
            ALVORECER <span className="divider">/</span> Campanha Alvorecer
          </span>
          <small className="online">Prévia local</small>
        </header>
        <main className="content">
          <div
            className="preview-switcher preview-switcher-app"
            aria-label="Modo de visualização"
          >
            <button type="button" onClick={() => switchMode("login")}>
              Login
            </button>
            <button
              type="button"
              className={isMaster ? "active" : ""}
              onClick={() => switchMode("master")}
            >
              Mestre
            </button>
            <button
              type="button"
              className={!isMaster ? "active" : ""}
              onClick={() => switchMode("player")}
            >
              Jogador
            </button>
          </div>
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {isMaster ? "PAINEL DO MESTRE" : "ÁREA DO JOGADOR"}
              </p>
              <h1>{effectivePage}</h1>
            </div>
          </div>

          {["Visão Geral", "Início"].includes(effectivePage) && (
            <Overview
              master={isMaster}
              onOpenCharacter={() =>
                setPage(isMaster ? "Personagens" : "Minha Ficha")
              }
            />
          )}
          {["Personagens", "Minha Ficha", "Inventário"].includes(
            effectivePage,
          ) && (
            <CharacterPage
              master={isMaster}
              inventoryOnly={effectivePage === "Inventário"}
            />
          )}
          {effectivePage === "Jogadores" && isMaster && <PlayersPage />}
          {effectivePage === "Combate" && <CombatPage master={isMaster} />}
          {effectivePage === "Vantagens" && (
            <CatalogPage title="Vantagens" master={isMaster} />
          )}
          {effectivePage === "Itens" && isMaster && (
            <CatalogPage title="Itens" master />
          )}
          {effectivePage === "Criaturas" && isMaster && (
            <CatalogPage title="Criaturas" master />
          )}
          {effectivePage === "Convites" && isMaster && <InvitesPage />}
          {effectivePage === "Configurações" && isMaster && <SettingsPage />}
          {effectivePage === "Campanha" && isMaster && <CampaignPage />}
          {effectivePage === "Histórico" && <HistoryPage />}
          {effectivePage === "Perfil" && !isMaster && <ProfilePage />}
        </main>
      </div>
    </div>
  );
}

function Overview({
  master,
  onOpenCharacter,
}: {
  master: boolean;
  onOpenCharacter: () => void;
}) {
  return (
    <>
      <div className="overview-title">
        <div>
          <p className="eyebrow">CAMPANHA ATUAL</p>
          <h2>Alvorecer</h2>
          <p>
            {master
              ? "Sua mesa, em um só lugar."
              : "Sua ficha e os acontecimentos da sessão."}
          </p>
        </div>
        <Swords size={48} />
      </div>
      <div className="stats">
        {master && (
          <div className="stat">
            <Users size={20} />
            <span>Jogadores</span>
            <strong>4</strong>
          </div>
        )}
        <div className="stat">
          <Shield size={20} />
          <span>Personagens</span>
          <strong>{master ? 4 : 1}</strong>
        </div>
        <div className="stat">
          <Swords size={20} />
          <span>Combates ativos</span>
          <strong>1</strong>
        </div>
        {master && (
          <div className="stat">
            <LinkIcon size={20} />
            <span>Convites pendentes</span>
            <strong>2</strong>
          </div>
        )}
      </div>
      {master && (
        <div className="actions">
          <button className="primary" type="button">
            + Criar jogador
          </button>
          <button type="button">
            <Swords size={18} /> Abrir combate
          </button>
          <button type="button">
            <LinkIcon size={18} /> Gerar convite
          </button>
        </div>
      )}
      <h2>{master ? "Personagens da campanha" : "Meu personagem"}</h2>
      <div className="cards">
        {characters.slice(0, master ? 3 : 1).map((c) => (
          <button
            type="button"
            className="character-card"
            key={c.name}
            onClick={onOpenCharacter}
          >
            <CharacterHeading name={c.name} cls={c.cls} race={c.race} />
            <div className="spread">
              <span>Vida</span>
              <b>
                {c.life[0]} / {c.life[1]}
              </b>
            </div>
            <div className="spread">
              <span>Mana</span>
              <b>
                {c.mana[0]} / {c.mana[1]}
              </b>
            </div>
            <div className="spread">
              <span>Fôlego</span>
              <b>
                {c.stamina[0]} / {c.stamina[1]}
              </b>
            </div>
          </button>
        ))}
      </div>
      <h2>Últimas alterações</h2>
      <HistoryPage compact />
    </>
  );
}

function CharacterPage({
  master,
  inventoryOnly,
}: {
  master: boolean;
  inventoryOnly: boolean;
}) {
  return (
    <>
      <div className="toolbar">
        <select defaultValue="Kael">
          <option>Kael</option>
          <option>Aurora</option>
        </select>
        {master && <button type="button">+ Personagem</button>}
      </div>
      <section className="panel">
        <CharacterHeading />
        <div className="actions">
          <button type="button">Escolher avatar</button>
          {master && <button type="button">Editar ficha</button>}
        </div>
        {!inventoryOnly && (
          <>
            <div className="resource-grid">
              <Resource
                icon={Heart}
                name="Vida"
                current={42}
                max={60}
                tone="green"
              />
              <Resource
                icon={Sparkles}
                name="Mana"
                current={12}
                max={20}
                tone="purple"
              />
              <Resource
                icon={Zap}
                name="Fôlego"
                current={24}
                max={30}
                tone="gold"
              />
            </div>
            <div className="balances">
              <div>
                <Star size={20} />
                <span>XP</span>
                <strong>350</strong>
              </div>
              <div>
                <Coins size={20} />
                <span>Dracmas</span>
                <strong>1.420,00</strong>
              </div>
            </div>
          </>
        )}
      </section>
      {!inventoryOnly && (
        <>
          <section className="panel">
            <div className="spread">
              <h2>Atributos</h2>
              {master && <button type="button">Gerenciar</button>}
            </div>
            <div className="attribute-grid">
              {attrs.map(([name, value]) => (
                <div className="attribute" key={String(name)}>
                  <span>{name}</span>
                  <strong>{value}</strong>
                  {master && <button type="button">Editar</button>}
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>Vantagens</h2>
            <div className="list-row">
              <div>
                <b>Visão Aguçada</b>
                <p>Percepção refinada em situações de risco.</p>
              </div>
              <span className="badge">Adquirida</span>
            </div>
            <div className="list-row">
              <div>
                <b>Tenacidade</b>
                <p>Resiste melhor a situações extremas.</p>
              </div>
              <span className="badge">Adquirida</span>
            </div>
          </section>
        </>
      )}
      <section className="panel">
        <div className="spread">
          <h2>Inventário</h2>
          {master && <button type="button">Adicionar item</button>}
        </div>
        <div className="list-row">
          <div>
            <b>Poção Rubra × 2</b>
            <p>Recuperação usada fora do painel de prévia.</p>
          </div>
          <button type="button">Detalhes</button>
        </div>
        <div className="list-row">
          <div>
            <b>Espada de Ferro × 1</b>
            <p>Arma principal de Kael.</p>
          </div>
          <button type="button">Detalhes</button>
        </div>
      </section>
      {!inventoryOnly && (
        <section className="panel">
          <h2>Informações</h2>
          <p>
            <b>Origem:</b> Vale de Eryon
          </p>
          <p>
            <b>Título:</b> Guardião do Primeiro Sol
          </p>
          <h2>Anotações</h2>
          <p className="notes">
            Prometeu retornar às ruínas quando os sete cristais despertarem.
          </p>
          <button type="button">Editar anotações</button>
        </section>
      )}
    </>
  );
}

function PlayersPage() {
  return (
    <>
      <div className="toolbar">
        <h2>Jogadores e credenciais</h2>
        <button className="primary" type="button">
          + Criar jogador
        </button>
      </div>
      <p className="muted">
        Exemplo visual das credenciais no painel do mestre.
      </p>
      {[
        ["arthur", "Kael", "batata123"],
        ["bia", "Aurora", "mago777"],
        ["lucas", "Darian", "goblin55"],
      ].map(([u, c, p]) => (
        <section className="panel" key={u}>
          <div className="spread">
            <h2>{u}</h2>
            <span className="badge">Jogador</span>
          </div>
          <p>{c}</p>
          <div className="credential">
            <code>••••••••</code>
            <button type="button">
              <Eye size={16} /> Mostrar
            </button>
            <button type="button">Copiar</button>
            <button type="button">Alterar senha</button>
            <span className="muted">prévia: {p}</span>
          </div>
        </section>
      ))}
    </>
  );
}

function CombatPage({ master }: { master: boolean }) {
  return (
    <>
      <div className="toolbar">
        <select defaultValue="Ruínas de Valen">
          <option>Ruínas de Valen</option>
        </select>
        {master && (
          <button className="primary" type="button">
            + Abrir combate
          </button>
        )}
      </div>
      <section className="panel combat-top">
        <div className="spread">
          <h2>
            <Swords size={20} /> Ruínas de Valen
          </h2>
          <span className="badge">Tempo real</span>
        </div>
        <p>Lista simples de aliados e inimigos para uso durante a sessão.</p>
      </section>
      <div className="combat-grid">
        <section className="panel">
          <div className="side-title">
            <h2>Aliados</h2>
            <span>3</span>
          </div>
          {characters.map((c) => (
            <div className="list-row" key={c.name}>
              <div>
                <b>{c.name}</b>
                <p>
                  {c.life[0]} / {c.life[1]} de Vida
                </p>
              </div>
              <span
                className="status"
                style={{
                  background:
                    c.life[0] / c.life[1] > 0.6
                      ? "#45bd87"
                      : c.life[0] / c.life[1] >= 0.3
                        ? "#e0b648"
                        : "#ef5368",
                }}
              >
                {c.life[0] / c.life[1] > 0.6
                  ? "VERDE"
                  : c.life[0] / c.life[1] >= 0.3
                    ? "AMARELO"
                    : "VERMELHO"}
              </span>
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="side-title">
            <h2>Inimigos</h2>
            <span>3</span>
          </div>
          {[
            ["Goblin 1", "Verde", "#45bd87", "14 / 20"],
            ["Goblin 2", "Vermelho", "#ef5368", "5 / 20"],
            ["Chefe Goblin", "Amarelo", "#e0b648", "83 / 120"],
          ].map(([n, s, c, hp]) => (
            <div className="list-row" key={n}>
              <div>
                <b>{n}</b>
                <p>{master ? `${hp} de Vida` : "Vida oculta"}</p>
              </div>
              <span className="status" style={{ background: c }}>
                {s.toUpperCase()}
              </span>
            </div>
          ))}
        </section>
        <section className="panel">
          <h2>Controles rápidos</h2>
          <div className="actions">
            <button type="button">-10 Vida</button>
            <button type="button">-5 Vida</button>
            <button type="button">-1 Vida</button>
            {master && (
              <>
                <button type="button">+1 Vida</button>
                <button type="button">+5 Vida</button>
                <button type="button">Revelar vida</button>
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function CatalogPage({ title, master }: { title: string; master: boolean }) {
  const content =
    title === "Vantagens"
      ? [
          [
            "Visão Aguçada",
            "100 XP",
            "Percepção refinada em situações de risco.",
          ],
          ["Tenacidade", "150 XP", "Aumenta a resistência do personagem."],
          ["Passo Sombrio", "200 XP", "Movimento especial ligado às trevas."],
        ]
      : title === "Itens"
        ? [
            ["Poção Rubra", "50,00 Dracmas", "Item de recuperação."],
            ["Cristal Arcano", "120,00 Dracmas", "Componente mágico raro."],
            ["Espada de Ferro", "200,00 Dracmas", "Arma simples e confiável."],
          ]
        : [
            ["Goblin", "20 PV", "Criatura comum."],
            ["Lobo Sombrio", "35 PV", "Predador das regiões escuras."],
            ["Guardião de Cristal", "120 PV", "Criatura de elite."],
          ];
  return (
    <>
      <div className="toolbar">
        <h2>Catálogo de {title.toLowerCase()}</h2>
        {master && (
          <button className="primary" type="button">
            + Criar
          </button>
        )}
      </div>
      <div className="cards">
        {content.map(([n, c, d]) => (
          <section className="panel catalog-card" key={n}>
            <div className="spread">
              <h2>{n}</h2>
              <span className="xp-price">{c}</span>
            </div>
            <p>{d}</p>
            <button type="button">
              {master
                ? "Editar"
                : title === "Vantagens"
                  ? "Comprar"
                  : "Detalhes"}
            </button>
          </section>
        ))}
      </div>
    </>
  );
}

function InvitesPage() {
  return (
    <>
      <div className="toolbar">
        <h2>Convites</h2>
        <button className="primary" type="button">
          Gerar convite
        </button>
      </div>
      <section className="panel">
        <div className="list-row">
          <div>
            <b>Convite ativo</b>
            <p>/convite/7cristais-demo</p>
          </div>
          <span className="badge">Expira em 7 dias</span>
        </div>
        <div className="list-row">
          <div>
            <b>Convite de Aurora</b>
            <p>Utilizado hoje às 14:32</p>
          </div>
          <span className="badge">Usado</span>
        </div>
      </section>
    </>
  );
}
function SettingsPage() {
  return (
    <>
      <section className="panel">
        <h2>Atributos base</h2>
        <p>Renomeie, reorganize ou desative atributos sem alterar o código.</p>
        <div className="attribute-grid">
          {attrs.map(([n]) => (
            <div className="attribute" key={String(n)}>
              <span>{n}</span>
              <button type="button">Editar</button>
            </div>
          ))}
        </div>
        <button className="primary" type="button">
          + Novo atributo
        </button>
      </section>
      <section className="panel">
        <h2>Aparência</h2>
        <div className="form-grid">
          <label>
            Cor principal
            <input type="color" defaultValue="#9e1b32" />
          </label>
          <label>
            Destaque
            <input type="color" defaultValue="#d02a43" />
          </label>
        </div>
      </section>
    </>
  );
}
function CampaignPage() {
  return (
    <>
      <section className="panel">
        <h2>Campanha Alvorecer</h2>
        <p>Nome, tema e regras gerais da campanha.</p>
        <div className="form-grid">
          <label>
            Nome
            <input defaultValue="Alvorecer" />
          </label>
          <label>
            Subtítulo
            <input defaultValue="A Promessa do Amanhecer" />
          </label>
        </div>
        <button className="primary" type="button">
          Salvar alterações
        </button>
      </section>
    </>
  );
}
function HistoryPage({ compact = false }: { compact?: boolean }) {
  const rows = [
    ["Hoje, 16:21", "Kael", "Vida -12 (54 → 42)", "arthur"],
    ["Hoje, 16:18", "Aurora", "Mana -2 (40 → 38)", "bia"],
    ["Hoje, 16:05", "Kael", "+500,00 Dracmas", "Mestre"],
  ];
  return (
    <div className="list">
      {rows.slice(0, compact ? 2 : rows.length).map(([time, ch, act, by]) => (
        <div className="history-row" key={time + ch}>
          <time>{time}</time>
          <div>
            <b>{ch}</b>
            <p>{act}</p>
          </div>
          <small>{by}</small>
        </div>
      ))}
    </div>
  );
}
function ProfilePage() {
  return (
    <section className="panel">
      <CharacterHeading />
      <h2>Conta do jogador</h2>
      <p>
        Username: <b>kael</b>
      </p>
      <p>
        Campanha: <b>Alvorecer</b>
      </p>
      <button type="button">Escolher avatar da galeria</button>
    </section>
  );
}
