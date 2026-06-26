import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { UnifiedProductsList } from "./UnifiedProductsList";
import { LegacyProductsList } from "./LegacyProductsList";

export function ProductsList() {
  const [view, setView] = useState<"unified" | "legacy">(() => {
    if (typeof window === "undefined") return "unified";
    return (localStorage.getItem("products_view") as any) || "unified";
  });

  function setViewPersist(v: "unified" | "legacy") {
    setView(v);
    try { localStorage.setItem("products_view", v); } catch {}
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 p-1 rounded-lg border bg-muted/40 w-fit">
        <Button size="sm" variant={view === "unified" ? "default" : "ghost"} onClick={() => setViewPersist("unified")} className="gap-1">
          <Sparkles className="h-3.5 w-3.5" /> Catálogo Unificado
        </Button>
        <Button size="sm" variant={view === "legacy" ? "default" : "ghost"} onClick={() => setViewPersist("legacy")}>
          Legacy
        </Button>
      </div>

      {view === "unified" ? <UnifiedProductsList /> : <LegacyProductsList />}
    </div>
  );
}
