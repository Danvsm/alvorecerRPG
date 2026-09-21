"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";

type EmojiEntry = { emoji: string; label: string };
type EmojiCategory = {
  id: string;
  label: string;
  icon: string;
  emojis: EmojiEntry[];
};

const categories: EmojiCategory[] = [
  {
    id: "faces",
    label: "Carinhas",
    icon: "😀",
    emojis: [
      ["😀", "feliz"],
      ["😃", "alegre"],
      ["😄", "sorriso"],
      ["😁", "sorrindo"],
      ["😂", "rindo"],
      ["🤣", "gargalhada"],
      ["😊", "fofo"],
      ["😍", "apaixonado"],
      ["🥰", "amor"],
      ["😘", "beijo"],
      ["😎", "legal"],
      ["🤩", "encantado"],
      ["🥳", "festa"],
      ["😏", "malicioso"],
      ["🙃", "irônico"],
      ["😉", "piscando"],
      ["😋", "delícia"],
      ["🤔", "pensando"],
      ["🤨", "desconfiado"],
      ["😐", "neutro"],
      ["😴", "sono"],
      ["😢", "triste"],
      ["😭", "chorando"],
      ["😡", "bravo"],
      ["😱", "assustado"],
      ["🤯", "chocado"],
      ["🥺", "pedido"],
      ["🤡", "palhaço"],
      ["👻", "fantasma"],
      ["💀", "caveira"],
    ].map(([emoji, label]) => ({ emoji, label })),
  },
  {
    id: "gestures",
    label: "Gestos e pessoas",
    icon: "👋",
    emojis: [
      ["👍", "positivo"],
      ["👎", "negativo"],
      ["👌", "ok"],
      ["✌️", "vitória"],
      ["🤞", "torcendo"],
      ["🤟", "amor gesto"],
      ["🤘", "rock"],
      ["👏", "palmas"],
      ["🙌", "celebração"],
      ["🙏", "obrigado"],
      ["💪", "força"],
      ["👊", "soco"],
      ["🤝", "acordo"],
      ["🫶", "coração mãos"],
      ["👀", "olhos"],
      ["🫂", "abraço"],
      ["🙋", "levantando mão"],
      ["🤦", "decepção"],
      ["🤷", "não sei"],
      ["🧙", "mago"],
      ["🧝", "elfo"],
      ["🧛", "vampiro"],
      ["🧚", "fada"],
      ["🥷", "ninja"],
    ].map(([emoji, label]) => ({ emoji, label })),
  },
  {
    id: "nature",
    label: "Animais e natureza",
    icon: "🐺",
    emojis: [
      ["🐺", "lobo"],
      ["🐉", "dragão"],
      ["🦊", "raposa"],
      ["🦁", "leão"],
      ["🐯", "tigre"],
      ["🐻", "urso"],
      ["🦅", "águia"],
      ["🦉", "coruja"],
      ["🐍", "cobra"],
      ["🦄", "unicórnio"],
      ["🐈", "gato"],
      ["🐕", "cachorro"],
      ["🌙", "lua"],
      ["☀️", "sol"],
      ["⭐", "estrela"],
      ["🔥", "fogo"],
      ["❄️", "neve"],
      ["⚡", "raio"],
      ["🌊", "onda"],
      ["🌹", "rosa"],
      ["🍀", "sorte"],
      ["🌲", "floresta"],
      ["🍄", "cogumelo"],
      ["🌈", "arco íris"],
    ].map(([emoji, label]) => ({ emoji, label })),
  },
  {
    id: "food",
    label: "Comidas e bebidas",
    icon: "🍕",
    emojis: [
      ["🍕", "pizza"],
      ["🍔", "hambúrguer"],
      ["🍟", "batata"],
      ["🌮", "taco"],
      ["🍿", "pipoca"],
      ["🍫", "chocolate"],
      ["🍰", "bolo"],
      ["🍪", "biscoito"],
      ["🍓", "morango"],
      ["🍎", "maçã"],
      ["🍉", "melancia"],
      ["🍇", "uva"],
      ["☕", "café"],
      ["🍺", "cerveja"],
      ["🍷", "vinho"],
      ["🥂", "brinde"],
      ["🍹", "bebida"],
      ["🥤", "refrigerante"],
    ].map(([emoji, label]) => ({ emoji, label })),
  },
  {
    id: "activities",
    label: "Atividades",
    icon: "⚔️",
    emojis: [
      ["⚔️", "espadas"],
      ["🛡️", "escudo"],
      ["🏹", "arco"],
      ["🎯", "alvo"],
      ["🎲", "dado"],
      ["♟️", "xadrez"],
      ["🎮", "videogame"],
      ["🎵", "música"],
      ["🎸", "guitarra"],
      ["🏆", "troféu"],
      ["🥇", "medalha"],
      ["⚽", "futebol"],
      ["🏀", "basquete"],
      ["🎬", "filme"],
      ["🎨", "arte"],
      ["📚", "livros"],
      ["🧩", "quebra cabeça"],
      ["🎁", "presente"],
    ].map(([emoji, label]) => ({ emoji, label })),
  },
  {
    id: "objects",
    label: "Objetos e símbolos",
    icon: "💎",
    emojis: [
      ["💎", "gema"],
      ["💰", "dinheiro"],
      ["🪙", "moeda"],
      ["👑", "coroa"],
      ["🔮", "cristal"],
      ["🗝️", "chave"],
      ["🧭", "bússola"],
      ["🗺️", "mapa"],
      ["📜", "pergaminho"],
      ["💡", "ideia"],
      ["📌", "marcador"],
      ["🔔", "sino"],
      ["❤️", "coração"],
      ["💙", "coração azul"],
      ["💜", "coração roxo"],
      ["💔", "coração partido"],
      ["✨", "brilho"],
      ["💥", "explosão"],
      ["✅", "confirmado"],
      ["❌", "errado"],
      ["❗", "atenção"],
      ["❓", "dúvida"],
      ["💯", "cem"],
      ["♾️", "infinito"],
    ].map(([emoji, label]) => ({ emoji, label })),
  },
];

const allEmojis = categories.flatMap((category) => category.emojis);
const recentStorageKey = "alvorecer:recent-emojis:v1";

export default function ChatEmojiPicker({
  onSelect,
  onClose,
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState("faces");
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(recentStorageKey) || "[]");
      if (Array.isArray(stored)) setRecent(stored.slice(0, 24));
    } catch {
      setRecent([]);
    }
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    if (query) {
      return allEmojis.filter((entry) =>
        `${entry.emoji} ${entry.label}`
          .toLocaleLowerCase("pt-BR")
          .includes(query),
      );
    }
    if (active === "recent") {
      return recent.map(
        (emoji) =>
          allEmojis.find((entry) => entry.emoji === emoji) || {
            emoji,
            label: "Recente",
          },
      );
    }
    return categories.find((category) => category.id === active)?.emojis || [];
  }, [active, recent, search]);

  const choose = (emoji: string) => {
    const next = [emoji, ...recent.filter((entry) => entry !== emoji)].slice(
      0,
      24,
    );
    setRecent(next);
    localStorage.setItem(recentStorageKey, JSON.stringify(next));
    onSelect(emoji);
  };

  return (
    <section className="chat-emoji-picker" aria-label="Seletor de emojis">
      <header>
        <label className="chat-emoji-search">
          <Search aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquisar emoji"
            aria-label="Pesquisar emoji"
          />
        </label>
        <button type="button" onClick={onClose} aria-label="Fechar emojis">
          <X aria-hidden="true" />
        </button>
      </header>
      <nav aria-label="Categorias de emojis">
        <button
          type="button"
          className={active === "recent" ? "active" : ""}
          onClick={() => {
            setActive("recent");
            setSearch("");
          }}
          aria-label="Emojis recentes"
          aria-pressed={active === "recent"}
        >
          🕘
        </button>
        {categories.map((category) => (
          <button
            type="button"
            key={category.id}
            className={active === category.id ? "active" : ""}
            onClick={() => {
              setActive(category.id);
              setSearch("");
            }}
            title={category.label}
            aria-label={category.label}
            aria-pressed={active === category.id}
          >
            {category.icon}
          </button>
        ))}
      </nav>
      <strong>
        {search
          ? "Resultados"
          : active === "recent"
            ? "Recentes"
            : categories.find((category) => category.id === active)?.label}
      </strong>
      <div className="chat-emoji-grid">
        {visible.map((entry) => (
          <button
            type="button"
            key={`${entry.emoji}-${entry.label}`}
            onClick={() => choose(entry.emoji)}
            aria-label={entry.label}
            title={entry.label}
          >
            {entry.emoji}
          </button>
        ))}
        {!visible.length && <p>Nenhum emoji encontrado.</p>}
      </div>
    </section>
  );
}
