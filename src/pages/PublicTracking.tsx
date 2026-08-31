import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

type Ev = { title: string; detail?: string; city: string; state: string; at: string };

const fmt = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function PublicTracking() {
  const { codigo } = useParams<{ codigo: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ tracking_code: string; status: string; events: Ev[] } | null>(null);

  useEffect(() => {
    document.title = `Rastreamento ${codigo ?? ''} | Banana Calçados`;
  }, [codigo]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const base = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/shipment-tracking-public`;
        const res = await fetch(`${base}?code=${encodeURIComponent(codigo ?? '')}`);
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setError(json?.error === 'not_found' ? 'Objeto não encontrado.' : 'Não foi possível consultar o objeto.');
        } else {
          setData(json);
        }
      } catch {
        if (alive) setError('Não foi possível consultar o objeto.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [codigo]);

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="bg-primary text-primary-foreground">
        <div className="max-w-2xl mx-auto px-4 py-5">
          <h1 className="text-lg font-semibold tracking-wide">Rastreamento de Objeto</h1>
          <p className="text-xs opacity-80">Acompanhe a movimentação da sua encomenda</p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <section className="bg-card border rounded-lg p-4 mb-5">
          <p className="text-xs text-muted-foreground">Código do objeto</p>
          <p className="text-xl font-mono font-bold tracking-wider">{codigo}</p>
          {data && (
            <p className="mt-2 inline-flex items-center rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-medium">
              {data.status}
            </p>
          )}
        </section>

        {loading && <p className="text-sm text-muted-foreground">Consultando...</p>}
        {error && !loading && (
          <div className="bg-card border rounded-lg p-6 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}

        {data && !loading && (
          <ol className="bg-card border rounded-lg divide-y">
            {data.events.map((e, i) => (
              <li key={i} className="p-4 flex gap-4">
                <div className="flex flex-col items-center pt-1">
                  <span className={`h-3 w-3 rounded-full ${i === 0 ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
                  {i < data.events.length - 1 && <span className="w-px flex-1 bg-border mt-1" />}
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${i === 0 ? 'text-primary' : 'text-foreground'}`}>{e.title}</p>
                  {e.detail && <p className="text-sm text-muted-foreground">{e.detail}</p>}
                  <p className="text-xs text-muted-foreground mt-1">
                    {e.city}/{e.state} — {fmt(e.at)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}

        <p className="text-[11px] text-muted-foreground text-center mt-6">
          As informações são atualizadas conforme a movimentação do objeto.
        </p>
      </main>
    </div>
  );
}
