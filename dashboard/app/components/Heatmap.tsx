"use client";

interface ActivityDay { date: string; count: number; }

function getColor(count: number): string {
  if (count === 0) return "bg-border";
  if (count === 1) return "bg-accent/30";
  if (count === 2) return "bg-accent/55";
  if (count === 3) return "bg-accent/75";
  return "bg-accent";
}

export default function Heatmap({ data }: { data: ActivityDay[] }) {
  // Build a map for quick lookup
  const map = new Map(data.map((d) => [d.date, d.count]));

  // Generate last 364 days (52 weeks × 7)
  const days: { date: string; count: number }[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 363; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, count: map.get(key) ?? 0 });
  }

  // Chunk into weeks (columns)
  const weeks: typeof days[] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[3px]">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((day) => (
              <div
                key={day.date}
                title={`${day.date}: ${day.count} capture${day.count !== 1 ? "s" : ""}`}
                className={`w-[10px] h-[10px] rounded-[2px] ${getColor(day.count)} transition-opacity hover:opacity-80 cursor-default`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-muted px-0.5">
        <span>Less</span>
        <div className="flex gap-1 items-center">
          {[0,1,2,3,4].map((n) => (
            <div key={n} className={`w-[10px] h-[10px] rounded-[2px] ${getColor(n)}`} />
          ))}
        </div>
        <span>More</span>
      </div>
    </div>
  );
}
