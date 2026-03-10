"use client";

import { useState } from "react";

interface Card { front: string; back: string; }

export default function FlashcardViewer({ cards }: { cards: Card[] }) {
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const [revealed, setRevealed] = useState(false);

  function toggle(i: number) {
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function flipAll() {
    if (revealed) {
      setFlipped(new Set());
    } else {
      setFlipped(new Set(cards.map((_, i) => i)));
    }
    setRevealed((r) => !r);
  }

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-muted">{cards.length} cards — click a card to flip it</p>
        <button
          onClick={flipAll}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-muted hover:border-accent hover:text-text transition-colors"
        >
          {revealed ? "Hide all answers" : "Reveal all answers"}
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-4">
        {cards.map((card, i) => (
          <div key={i} style={{ height: 130 }}>
            <div
              className={`flip-card w-full h-full${flipped.has(i) ? " flipped" : ""}`}
              onClick={() => toggle(i)}
            >
              <div className="flip-card-inner">
                <div className="flip-card-front text-sm">{card.front}</div>
                <div className="flip-card-back text-sm">{card.back}</div>
              </div>
            </div>
            <p className="text-center text-xs text-muted mt-1.5">
              {flipped.has(i) ? "Click to hide answer" : "Click to reveal answer"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
