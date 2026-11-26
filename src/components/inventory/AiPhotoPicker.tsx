import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { LibItem } from "@/lib/productPhotosAi";

const PAGE = 24;

/** Thumbnail grid with search and "mostrar mais" (24 at a time, lazy images). */
export function AiPhotoPicker({ items, value, onChange, noneLabel, filter }: {
  items: LibItem[]; value?: string; onChange: (id?: string) => void; noneLabel?: string; filter?: (i: LibItem) => boolean;
}) {
  const [q, setQ] = useState("");
  const [n, setN] = useState(PAGE);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => (!filter || filter(i)) && (!s || i.name.toLowerCase().includes(s)));
  }, [items, q, filter]);
  return (
    <div className="space-y-2">
      <Input placeholder="Buscar pelo nome" value={q} onChange={(e) => { setQ(e.target.value); setN(PAGE); }} className="h-8" />
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {noneLabel && (
          <button type="button" onClick={() => onChange(undefined)}
            className={`flex aspect-square items-center justify-center rounded border text-xs ${!value ? "ring-2 ring-primary" : ""}`}>{noneLabel}</button>
        )}
        {list.slice(0, n).map((i) => (
          <button type="button" key={i.id} onClick={() => onChange(i.id)} title={i.name}
            className={`overflow-hidden rounded border text-left ${value === i.id ? "ring-2 ring-primary" : ""}`}>
            <div className="aspect-square bg-muted">{i.image && <img src={i.image} loading="lazy" decoding="async" alt={i.name} className="h-full w-full object-cover" />}</div>
            <p className="truncate px-1 text-[10px]">{i.name}</p>
          </button>
        ))}
      </div>
      {list.length > n && <Button type="button" variant="outline" size="sm" onClick={() => setN(n + PAGE)}>Mostrar mais ({list.length - n})</Button>}
      {!list.length && <p className="text-xs text-muted-foreground">Nada encontrado.</p>}
    </div>
  );
}
