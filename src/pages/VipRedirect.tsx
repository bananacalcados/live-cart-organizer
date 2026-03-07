import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

const VipRedirect = () => {
  const { slug } = useParams<{ slug: string }>();
  const [status, setStatus] = useState<"loading" | "retrying" | "error">("loading");
  const [countdown, setCountdown] = useState(10);

  const fetchRedirect = async () => {
    if (!slug) return;
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/group-redirect-link?slug=${encodeURIComponent(slug)}&mode=api`
      );
      const result = await res.json();

      if (result.invite_url) {
        window.location.href = result.invite_url;
      } else {
        setStatus("retrying");
      }
    } catch {
      setStatus("retrying");
    }
  };

  useEffect(() => {
    fetchRedirect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (status !== "retrying") return;
    setCountdown(10);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setStatus("loading");
          fetchRedirect();
          return 10;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <div
      style={{
        fontFamily: "-apple-system, sans-serif",
        background: "#075e54",
        color: "white",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        style={{
          background: "rgba(0,0,0,0.25)",
          borderRadius: "16px",
          padding: "2rem",
          textAlign: "center",
          maxWidth: "360px",
          width: "100%",
        }}
      >
        <div
          style={{
            border: "3px solid rgba(255,255,255,0.3)",
            borderTop: "3px solid white",
            borderRadius: "50%",
            width: "44px",
            height: "44px",
            animation: "spin 0.9s linear infinite",
            margin: "0 auto 1.2rem",
          }}
        />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

        {status === "loading" ? (
          <>
            <h2 style={{ fontSize: "1.15rem", marginBottom: "0.5rem" }}>
              Entrando no grupo...
            </h2>
            <p style={{ fontSize: "0.9rem", opacity: 0.85 }}>
              Você será redirecionado automaticamente.
            </p>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: "1.15rem", marginBottom: "0.5rem" }}>
              ⏳ Preparando seu grupo VIP
            </h2>
            <p style={{ fontSize: "0.9rem", opacity: 0.85, marginBottom: "1rem", lineHeight: 1.5 }}>
              Estamos configurando um grupo exclusivo. Redirecionando em{" "}
              <strong>{countdown}</strong>s...
            </p>
            <button
              onClick={() => {
                setStatus("loading");
                fetchRedirect();
              }}
              style={{
                display: "inline-block",
                background: "#25D366",
                color: "white",
                textDecoration: "none",
                padding: "0.75rem 1.5rem",
                borderRadius: "50px",
                fontWeight: 600,
                fontSize: "0.95rem",
                cursor: "pointer",
                border: "none",
                width: "100%",
                maxWidth: "260px",
              }}
            >
              Tentar agora
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default VipRedirect;
