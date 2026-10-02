import { useEffect } from "react";
import { useParams } from "react-router-dom";

/** Fallback do link curto /g/:code (normalmente o script inline do index.html já redireciona). */
export default function VipGoRedirect() {
  const { code } = useParams();
  useEffect(() => {
    if (!code) return;
    window.location.replace(
      `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/vip-go?c=${encodeURIComponent(code)}`,
    );
  }, [code]);
  return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Abrindo o WhatsApp…</div>;
}
