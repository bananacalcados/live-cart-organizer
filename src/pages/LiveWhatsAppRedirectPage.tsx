import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { captureAttribution, attributionPayload, resolveUtm } from "@/lib/metaAttribution";

/**
 * /zap/:slug — ponte da Live para o WhatsApp.
 * Captura fbc/fbp/UTMs no navegador, registra o clique e abre o WhatsApp com a
 * frase pré-preenchida ("Oii, vim da Live, pode me ajudar? #CODIGO").
 */
export default function LiveWhatsAppRedirectPage() {
  const { slug } = useParams<{ slug: string }>();
  const [status, setStatus] = useState<"loading" | "redirecting" | "inapp" | "paused" | "error">("loading");
  const [waUrl, setWaUrl] = useState<string | null>(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  useEffect(() => {
    if (!slug) {
      setStatus("error");
      return;
    }

    captureAttribution();
    const attr = attributionPayload();

    const ua = navigator.userAgent || "";
    const isInApp = /Instagram|FBAN|FBAV/i.test(ua);
    const isAndroid = /Android/i.test(ua);

    const rq = new URLSearchParams({ slug });
    if (attr.fbclid) rq.set("fbclid", attr.fbclid);
    if (attr.fbc) rq.set("fbc", attr.fbc);
    if (attr.fbp) rq.set("fbp", attr.fbp);
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const) {
      const v = resolveUtm(k);
      if (v) rq.set(k, v);
    }
    try {
      rq.set("ref", window.location.href.slice(0, 500));
    } catch {
      /* ignore */
    }

    fetch(`${supabaseUrl}/functions/v1/live-whatsapp-redirect?${rq.toString()}`, {
      headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.error === "paused") {
          setStatus("paused");
          return;
        }
        if (!data?.wa_url) throw new Error(data?.error || "sem link");
        const target: string = data.wa_url;
        setWaUrl(target);
        setStatus("redirecting");

        if (isAndroid && isInApp) {
          const intentUrl = `intent://${target.replace("https://", "")}#Intent;scheme=https;package=com.whatsapp;S.browser_fallback_url=${encodeURIComponent(target)};end`;
          window.location.href = intentUrl;
          return;
        }
        if (isInApp) {
          // iOS dentro do Instagram: webview nem sempre abre o app → botão manual.
          setStatus("inapp");
          return;
        }
        window.location.href = target;
      })
      .catch((err) => {
        console.error("[LiveZap] erro:", err);
        setStatus("error");
      });
  }, [slug, supabaseUrl]);

  const btn: React.CSSProperties = {
    display: "inline-block",
    background: "#25D366",
    color: "white",
    textDecoration: "none",
    padding: ".8rem 1.5rem",
    borderRadius: 50,
    fontWeight: 700,
    width: "100%",
    maxWidth: 260,
    boxSizing: "border-box",
  };

  return (
    <div
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        background: "#075e54",
        color: "white",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div style={{ background: "rgba(0,0,0,.25)", borderRadius: 16, padding: "2rem", textAlign: "center", maxWidth: 360, width: "100%" }}>
        {status === "loading" && (
          <>
            <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>⏳</div>
            <h2 style={{ margin: 0 }}>Abrindo o WhatsApp...</h2>
          </>
        )}
        {(status === "redirecting" || status === "inapp") && (
          <>
            <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>💚</div>
            <h2 style={{ margin: "0 0 .5rem" }}>Quase lá!</h2>
            <p style={{ opacity: 0.85, margin: "0 0 1rem", fontSize: ".9rem" }}>
              {status === "inapp"
                ? "Toque no botão abaixo para abrir o WhatsApp e enviar a mensagem."
                : "Se o WhatsApp não abrir sozinho, toque no botão abaixo."}
            </p>
            <a href={waUrl || "#"} style={btn}>
              Abrir WhatsApp
            </a>
          </>
        )}
        {status === "paused" && (
          <>
            <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>⏸️</div>
            <h2 style={{ margin: 0 }}>Este link está pausado</h2>
          </>
        )}
        {status === "error" && (
          <>
            <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>😕</div>
            <h2 style={{ margin: 0 }}>Link não encontrado</h2>
          </>
        )}
      </div>
    </div>
  );
}
