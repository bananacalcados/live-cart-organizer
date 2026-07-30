import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink, Link2 } from "lucide-react";
import { toast } from "sonner";

const BASE = "https://checkout.bananacalcados.com.br/minha-area";

function slugify(v: string) {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Link público da Área de Membros — grande e em destaque. */
export function MemberAreaLinkBanner({ event }: { event: any }) {
  const [copied, setCopied] = useState(false);

  const url = useMemo(() => {
    const slug = (event as any)?.member_area_slug || slugify(event?.name || "");
    return slug ? `${BASE}/${slug}` : BASE;
  }, [event]);

  if (!event) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copiado!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-2xl border-2 border-primary/50 bg-gradient-to-r from-primary/10 via-amber-500/10 to-pink-500/10 p-5">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <Link2 className="h-4 w-4" /> Link da Área de Membros (bio do Instagram)
      </p>
      <p className="mt-2 break-all text-xl sm:text-2xl font-black text-primary">{url}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={copy} size="lg" className="gap-2 font-bold">
          <Copy className="h-4 w-4" /> {copied ? "COPIADO!" : "COPIAR LINK"}
        </Button>
        <Button asChild size="lg" variant="outline" className="gap-2 font-bold">
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" /> ABRIR
          </a>
        </Button>
      </div>
    </div>
  );
}
