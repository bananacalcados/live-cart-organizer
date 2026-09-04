import { ReactNode, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface LaneSectionProps {
  /** Chave de persistência do estado recolhido (localStorage). */
  storageKey: string;
  title: string;
  count: number;
  /** Classe de cor do título/contador (token semântico). */
  tone: string;
  icon?: ReactNode;
  /** Conteúdo extra à direita do título (ex.: descrição). */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  /** id do elemento (para rolagem via atalhos/contadores). */
  id?: string;
  /** Quando muda para um novo valor, força a linha a abrir (ex.: atalho de teclado). */
  expandSignal?: number;
}

/** Linha (etapa) genérica: título com contador + conteúdo recolhível, lembrado no aparelho. */
export function LaneSection({ storageKey, title, count, tone, icon, hint, children, className, id, expandSignal }: LaneSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(storageKey) === "1");
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  useEffect(() => {
    if (!expandSignal) return;
    setCollapsed(false);
    try {
      localStorage.setItem(storageKey, "0");
    } catch {
      /* ignore */
    }
  }, [expandSignal, storageKey]);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <section id={id} className={cn("scroll-mt-2 rounded-lg border border-border/60 bg-muted/20 px-2 py-1.5", className)}>
      <button type="button" onClick={toggle} className="flex w-full items-center gap-2 px-1 py-0.5 text-left">
        {collapsed ? <ChevronRight className="h-3.5 w-3.5 opacity-60" /> : <ChevronDown className="h-3.5 w-3.5 opacity-60" />}
        {icon}
        <span className={cn("text-[11px] font-bold uppercase tracking-wide", tone)}>{title}</span>
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold", tone, "bg-current/10")}>
          <span className="text-current">{count}</span>
        </span>
        {hint && <span className="ml-1 hidden text-[10px] text-muted-foreground sm:inline">{hint}</span>}
      </button>
      {!collapsed && <div className="pt-1">{children}</div>}
    </section>
  );
}
