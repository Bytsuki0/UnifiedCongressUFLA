export function DecorativeBg() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-24 top-32 h-64 w-64 rounded-full bg-[oklch(0.85_0.08_295/0.45)] blur-sm" />
      <div className="absolute -right-20 bottom-10 h-80 w-80 rounded-full bg-[oklch(0.88_0.06_240/0.5)] blur-sm" />
      <Dots className="absolute right-10 top-10" />
      <Dots className="absolute left-12 bottom-24" />
    </div>
  );
}

function Dots({ className = "" }: { className?: string }) {
  return (
    <div className={`grid grid-cols-6 gap-1.5 ${className}`}>
      {Array.from({ length: 18 }).map((_, i) => (
        <span key={i} className="block h-1 w-1 rounded-full bg-primary/40" />
      ))}
    </div>
  );
}
