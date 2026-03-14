import { useState } from "react";

export default function FlashcardViewer({ cards }) {
  const [flipped,  setFlipped]  = useState(new Set());
  const [revealed, setRevealed] = useState(false);

  function toggle(i) {
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
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
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-muted">{cards.length} cards — click a card to flip it</p>
        <button
          onClick={flipAll}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-muted hover:border-accent hover:text-text transition-colors"
        >
          {revealed ? "Hide all answers" : "Reveal all answers"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {cards.map((card, i) => (
          <div key={i} className="perspective" style={{ height: 130 }}>
            <div
              className={`flip-card w-full h-full${flipped.has(i) ? " flipped" : ""}`}
              onClick={() => toggle(i)}
            >
              <div className="flip-card-front bg-surface border border-border text-sm cursor-pointer">
                {card.front}
              </div>
              <div className="flip-card-back bg-accent/10 border border-accent/30 text-sm cursor-pointer">
                {card.back}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
