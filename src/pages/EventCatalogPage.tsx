/**
 * EventCatalogPage — /evento/:slug
 * Same logic as CatalogLeadPage but fetches config via event's linked catalog_lead_page.
 * Reuses the exact same CatalogLeadPage component, just with a different slug resolution.
 */
import { useState, useEffect } from "react";
import { useParams, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

// We'll just resolve the slug then redirect to the CatalogLeadPage route internally
// But since we want /evento/:slug URL, we import and render CatalogLeadPage with the resolved slug

import CatalogLeadPageComponent from "./CatalogLeadPage";

export default function EventCatalogPage() {
  const { slug } = useParams<{ slug: string }>();
  const [resolvedSlug, setResolvedSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      // The slug IS the catalog_lead_page slug (we use the same slug)
      // Check if a catalog_lead_page with this slug exists
      const { data } = await supabase
        .from("catalog_lead_pages")
        .select("slug")
        .eq("slug", slug)
        .eq("is_active", true)
        .maybeSingle();

      if (data) {
        setResolvedSlug((data as any).slug);
      } else {
        setNotFound(true);
      }
      setLoading(false);
    })();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Evento não encontrado</h1>
          <p className="text-zinc-400">Este link não está mais disponível.</p>
        </div>
      </div>
    );
  }

  // Render the CatalogLeadPage component — it reads slug from useParams
  // Since we're on /evento/:slug and the slug matches, we just render it directly
  return <CatalogLeadPageComponent />;
}
