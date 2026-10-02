export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative h-8 w-8 rotate-45 rounded-md bg-[var(--gradient-primary)] shadow-[var(--shadow-soft)]">
        <div className="absolute inset-1.5 rounded-sm bg-background/30" />
      </div>
      <span className="text-xl font-bold tracking-tight">
        <span className="text-primary">Quad</span>
        <span className="text-foreground">Code</span>
      </span>
    </div>
  );
}
