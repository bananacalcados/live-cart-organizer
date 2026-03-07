import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export default function VipGroupRedirectPage() {
  const { slug } = useParams<{ slug: string }>();
  const [status, setStatus] = useState<'loading' | 'redirecting' | 'inapp' | 'nogroup' | 'error'>('loading');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(10);
  const [errorDetail, setErrorDetail] = useState<string>('');

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  useEffect(() => {
    if (!slug) { setStatus('error'); setErrorDetail('slug is undefined'); return; }

    const ua = navigator.userAgent || '';
    const isInstagram = /Instagram/i.test(ua);
    const isFacebook = /FBAN|FBAV/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    const isInApp = isInstagram || isFacebook;

    fetch(`${supabaseUrl}/functions/v1/group-redirect-link?slug=${slug}&mode=api`, {
      headers: {
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      }
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (!data.invite_url) {
          setStatus('nogroup');
          return;
        }

        const waRegular = data.invite_url;
        const invitePath = waRegular.replace('https://chat.whatsapp.com/', '');
        setInviteUrl(waRegular);

        if (isInApp) {
          setStatus('inapp');
          return;
        }

        setStatus('redirecting');

        if (isAndroid) {
          const intentUrl = `intent://chat.whatsapp.com/${invitePath}#Intent;scheme=https;package=com.whatsapp;S.browser_fallback_url=${encodeURIComponent(waRegular)};end`;
          window.location.href = intentUrl;
          setTimeout(() => { window.location.href = waRegular; }, 800);
        } else {
          setTimeout(() => { window.location.href = waRegular; }, 400);
        }
      })
      .catch(err => {
        const msg = err?.message || String(err);
        console.error('[VipRedirect] Erro ao buscar grupo:', msg);
        setErrorDetail(msg);
        setStatus('error');
      });
  }, [slug]);

  // Auto-retry countdown for nogroup
  useEffect(() => {
    if (status !== 'nogroup') return;
    if (countdown <= 0) { window.location.reload(); return; }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [status, countdown]);

  const copyLink = () => {
    if (inviteUrl && navigator.clipboard) {
      navigator.clipboard.writeText(inviteUrl).then(() => alert('Link copiado!'));
    }
  };

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      background: '#075e54', color: 'white', minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
    }}>
      <div style={{
        background: 'rgba(0,0,0,.25)', borderRadius: 16, padding: '2rem',
        textAlign: 'center', maxWidth: 360, width: '100%'
      }}>
        {status === 'loading' && (
          <>
            <div style={{ marginBottom: '1rem', fontSize: '2rem' }}>⏳</div>
            <h2>Carregando...</h2>
          </>
        )}

        {status === 'redirecting' && (
          <>
            <div style={{ marginBottom: '1rem', fontSize: '2rem' }}>💚</div>
            <h2>Entrando no grupo...</h2>
            <p style={{ opacity: .85, margin: '.5rem 0 1rem', fontSize: '.9rem' }}>
              Você será redirecionado automaticamente para o WhatsApp.
            </p>
            <a href={inviteUrl || '#'} style={{
              display: 'inline-block', background: '#25D366', color: 'white',
              textDecoration: 'none', padding: '.75rem 1.5rem', borderRadius: 50,
              fontWeight: 600, width: '100%', maxWidth: 240, boxSizing: 'border-box'
            }}>Abrir WhatsApp</a>
          </>
        )}

        {status === 'inapp' && (
          <>
            <div style={{ background: 'rgba(255,180,0,.15)', border: '1px solid rgba(255,180,0,.4)', borderRadius: 10, padding: '1rem', marginBottom: '1rem', textAlign: 'left' }}>
              <strong>📱 Abra no navegador</strong>
              <ol style={{ paddingLeft: '1.2rem', marginTop: '.5rem' }}>
                <li style={{ fontSize: '.85rem', marginBottom: '.35rem' }}>Toque nos <strong>3 pontos</strong> (⋮) no canto superior direito</li>
                <li style={{ fontSize: '.85rem', marginBottom: '.35rem' }}>Selecione <strong>"Abrir no navegador"</strong></li>
                <li style={{ fontSize: '.85rem' }}>Ou copie o link abaixo e cole no WhatsApp</li>
              </ol>
            </div>
            <button onClick={copyLink} style={{
              display: 'block', background: '#25D366', color: 'white', border: 'none',
              padding: '.75rem 1.5rem', borderRadius: 50, fontWeight: 600, width: '100%',
              cursor: 'pointer', marginBottom: '.5rem', fontSize: '.95rem'
            }}>📋 Copiar link do grupo</button>
            <a href={inviteUrl || '#'} style={{
              display: 'block', background: 'rgba(255,255,255,.15)', color: 'white',
              textDecoration: 'none', padding: '.75rem 1.5rem', borderRadius: 50,
              fontWeight: 600, fontSize: '.9rem'
            }}>Tentar assim mesmo</a>
          </>
        )}

        {status === 'nogroup' && (
          <>
            <div style={{ marginBottom: '1rem', fontSize: '2rem' }}>⏳</div>
            <h2>Preparando seu grupo VIP</h2>
            <p style={{ opacity: .85, margin: '.5rem 0 1rem', fontSize: '.9rem' }}>
              Redirecionando em <strong>{countdown}s</strong>...
            </p>
            <button onClick={() => window.location.reload()} style={{
              background: '#25D366', color: 'white', border: 'none',
              padding: '.75rem 1.5rem', borderRadius: 50, fontWeight: 600,
              width: '100%', cursor: 'pointer', fontSize: '.95rem'
            }}>Tentar agora</button>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ marginBottom: '1rem', fontSize: '2rem' }}>⚠️</div>
            <h2>Link inválido</h2>
            <p style={{ opacity: .85, margin: '.5rem 0 1rem', fontSize: '.9rem' }}>
              Este link não foi encontrado ou expirou.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
