"use client";

import Image from "next/image";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { circularDistance, snapPosition } from "./carouselMath";
import type { CharacterEntry } from "./characterCatalog";
import styles from "./character-carousel.module.css";

type Props = { title: string; items: CharacterEntry[]; kind: "classe" | "raça" };

export default function CharacterCarousel({ title, items, kind }: Props) {
  const [position, setPosition] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [width, setWidth] = useState(360);
  const [selected, setSelected] = useState<CharacterEntry | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const current = useRef(0);
  const gesture = useRef<{ pointer: number; x: number; origin: number; sample: number; time: number; velocity: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key === "Tab") {
        // The close button is the only interactive control inside the dialog.
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      lastFocus.current?.focus({ preventScroll: true });
    };
  }, [selected]);

  function go(delta: number) {
    const next = Math.round(current.current) + delta;
    current.current = next;
    setPosition(next);
    setDragging(false);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (selected || (event.pointerType === "mouse" && event.button !== 0)) return;
    const now = performance.now();
    gesture.current = { pointer: event.pointerId, x: event.clientX, origin: current.current, sample: current.current, time: now, velocity: 0, moved: false };
    suppressClick.current = false;
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) return;
    const dx = event.clientX - g.x;
    if (Math.abs(dx) > 5 && !g.moved) {
      g.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    if (!g.moved) return;
    const next = g.origin - dx / Math.max(135, width * 0.42);
    current.current = next;
    setPosition(next);
    const now = performance.now();
    if (now - g.time > 16) {
      const instantaneous = (next - g.sample) / (now - g.time);
      g.velocity = g.velocity * 0.25 + instantaneous * 0.75;
      g.sample = next;
      g.time = now;
    }
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) return;
    const now = performance.now();
    const velocity = g.moved && now - g.time < 100 ? g.velocity : 0;
    const target = snapPosition(current.current, velocity, g.origin);
    current.current = target;
    setPosition(target);
    setDragging(false);
    suppressClick.current = g.moved;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function open(item: CharacterEntry) {
    lastFocus.current = document.activeElement as HTMLElement;
    setSelected(item);
  }

  const centerIndex = ((Math.round(position) % items.length) + items.length) % items.length;
  const radius = Math.min(width * 0.65, 440);

  return (
    <div className={styles.carousel}>
      <div className={styles.toolbar}>
        <div>
          <p className={styles.kicker}>{items.length} opções para descobrir</p>
          <h3>{title}</h3>
        </div>
        <div className={styles.arrows}>
          <button type="button" onClick={() => go(-1)} aria-label={`${title}: anterior`}><ArrowLeft aria-hidden="true" /></button>
          <button type="button" onClick={() => go(1)} aria-label={`${title}: próxima`}><ArrowRight aria-hidden="true" /></button>
        </div>
      </div>
      <div
        className={styles.stage}
        ref={stageRef}
        role="group"
        aria-label={`${title}: arraste para explorar`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
          if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
        }}
      >
        {items.map((item, index) => {
          const distance = circularDistance(index, position, items.length);
          const abs = Math.abs(distance);
          if (abs >= 3.15) return null;
          const visible = abs < 2.9;
          const centered = Math.abs(distance) < 0.5;
          const x = Math.sin(distance * 0.62) * radius;
          return (
            <button
              type="button"
              key={item.name}
              className={`${styles.card} ${kind === "classe" ? styles.classPhoto : ""} ${centered ? styles.centered : ""} ${dragging ? styles.dragging : ""}`}
              style={{
                transform: `translate3d(calc(-50% + ${x}px), ${Math.min(abs * 22, 56)}px, ${-abs * 105}px) rotateY(${-distance * 15}deg) scale(${Math.max(0.62, 1 - abs * 0.12)})`,
                opacity: visible ? Math.max(0.25, 1 - abs * 0.22) : 0,
                zIndex: Math.round(100 - abs * 20),
                pointerEvents: visible ? "auto" : "none",
              }}
              tabIndex={centered ? 0 : -1}
              aria-hidden={!visible || !centered}
              aria-label={`Conhecer ${kind} ${item.name}`}
              onClick={() => {
                if (suppressClick.current) { suppressClick.current = false; return; }
                if (centered) open(item);
                else go(Math.round(distance) || (distance > 0 ? 1 : -1));
              }}
            >
              <Image className={styles.art} src={item.image} alt="" fill sizes="(max-width: 600px) 60vw, 300px" draggable={false} />
              <span className={styles.cardShade} aria-hidden="true" />
              <span className={styles.cardName}>{item.name}</span>
            </button>
          );
        })}
      </div>
      <p className={styles.position} aria-live="polite">{items[centerIndex].name} <span>· {centerIndex + 1} de {items.length}</span></p>
      <p className={styles.hint}>Arraste para explorar · toque na carta central para conhecer</p>
      {selected && createPortal(
        <div className={styles.backdrop} onPointerDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby={`${kind}-dialog-title`} className={styles.dialog}>
            <button type="button" className={styles.close} ref={closeRef} onClick={() => setSelected(null)} aria-label="Fechar detalhes"><X aria-hidden="true" /></button>
            <div className={styles.dialogArt}><Image src={selected.image} alt="" fill sizes="(max-width: 700px) 90vw, 320px" className={kind === "classe" ? styles.classArt : ""} /></div>
            <div className={styles.dialogCopy}>
              <p className={styles.kicker}>{kind}</p>
              <h3 id={`${kind}-dialog-title`}>{selected.name}</h3>
              <p>{selected.description}</p>
              {selected.source && <small>{selected.source}</small>}
            </div>
          </div>
        </div>, document.body
      )}
    </div>
  );
}
