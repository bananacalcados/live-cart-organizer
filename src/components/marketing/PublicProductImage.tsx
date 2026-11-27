import { useState } from "react";
import { cn } from "@/lib/utils";

/** Foto do produto nas páginas públicas: sem foto (ou foto que não abre) vira um bloco neutro com o nome. */
export function PublicProductImage({ src, name, className, loading }: { src?: string | null; name: string; className?: string; loading?: "lazy" | "eager" }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={cn("flex items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200 p-2 text-center", className)} role="img" aria-label={name}>
        <span className="line-clamp-3 text-[11px] font-semibold leading-tight text-stone-500">{name}</span>
      </div>
    );
  }
  return <img src={src} alt={name} className={className} loading={loading} onError={() => setFailed(true)} />;
}
