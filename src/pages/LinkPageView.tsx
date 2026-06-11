import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Link as LinkIcon, Phone, MapPin, ShoppingBag, Globe, Instagram, Mail,
  Users, Video, Star, Music2, Youtube, Facebook, Loader2, ChevronRight, Sparkles
} from "lucide-react";

const SHOPIFY_STORE_DOMAIN = "ftx2e2-np.myshopify.com";

const ITEM_ICONS: Record<string, any> = {
  link: LinkIcon, whatsapp: Phone, address: MapPin, catalog: ShoppingBag,
  website: Globe, instagram: Instagram, email: Mail, vip: Users, live: Video,
  review: Star, social: Globe,
};

const SOCIAL_ICONS: Record<string, any> = {
  instagram: Instagram, tiktok: Music2, youtube: Youtube, facebook: Facebook,
};

interface PageData {
  page: any;
  items: any[];
  catalog: any[];
  seller: { id: string; name: string } | null;
}

function formatPrice(v: number | null): string {
  if (!v) return "";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function LinkPageView() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // lead gate
  const [gatePassed, setGatePassed] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [submittingLead, setSubmittingLead] = useState(false);
  const [leadId, setLeadId] = useState<string | null>(null);

  const storageKey = `lp_lead_${slug}`;

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const { data: res, error } = await supabase.functions.invoke("link-page-public", {
          body: {
            slug,
            track: {
              utm_source: searchParams.get("utm_source"),
              utm_medium: searchParams.get("utm_medium"),
              utm_campaign: searchParams.get("utm_campaign"),
              referrer: document.referrer || null,
              user_agent: navigator.userAgent,
            },
          },
        });
        if (error || !res || res.error) { setNotFound(true); setLoading(false); return; }
        setData(res as PageData);

        // restore lead from localStorage
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          try {
            const p = JSON.parse(stored);
            setLeadId(p.leadId || null);
            setGatePassed(true);
          } catch { /* ignore */ }
        }
        if (!res.page.require_lead_capture) setGatePassed(true);

        // page_view é registrado server-side pela função link-page-public


        if (res.page.meta_pixel_id) {
          const s = document.createElement("script");
          s.innerHTML = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${res.page.meta_pixel_id}');fbq('track','PageView');`;
          document.head.appendChild(s);
        }
      } catch {
        setNotFound(true);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const submitLead = async () => {
    if (leadName.trim().length < 2) return;
    if (leadPhone.replace(/\D/g, "").length < 10) return;
    setSubmittingLead(true);
    try {
      const { data: res } = await supabase.functions.invoke("link-page-capture-lead", {
        body: { pageId: data!.page.id, name: leadName.trim(), phone: leadPhone },
      });
      const lid = res?.leadId || null;
      setLeadId(lid);
      localStorage.setItem(storageKey, JSON.stringify({ leadId: lid, name: leadName.trim() }));
      setGatePassed(true);
    } catch { /* ignore */ }
    setSubmittingLead(false);
  };

  const handleClick = useCallback(async (item: any) => {
    if (!data) return;
    await supabase.from("link_page_visits").insert({
      page_id: data.page.id,
      item_id: item.id,
      event_type: "click",
      seller_id: data.page.seller_id,
      lead_id: leadId,
      utm_source: searchParams.get("utm_source"),
      referrer: document.referrer || null,
    });
    supabase.from("link_page_items").update({ clicks: (item.clicks || 0) + 1 }).eq("id", item.id).then(() => {});
    if ((window as any).fbq) (window as any).fbq("trackCustom", "LinkClick", { label: item.label, type: item.item_type });
    if (item.url) window.open(item.url, "_blank");
  }, [data, leadId, searchParams]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0f0f1a" }}>
        <Loader2 className="h-8 w-8 animate-spin text-white/70" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0f0f1a" }}>
        <div className="text-center text-white">
          <h1 className="text-2xl font-bold mb-2">Página não encontrada</h1>
          <p className="text-white/60">Este link não existe ou foi desativado.</p>
        </div>
      </div>
    );
  }

  const { page, items, catalog, seller } = data;
  const theme = page.theme_config || {};
  const accent = theme.accentColor || "#22c55e";
  const accent2 = theme.accent2Color || "#16a34a";

  // ─── Lead capture gate ───
  if (!gatePassed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: page.background_value }}>
        <div className="w-full max-w-sm bg-white/10 backdrop-blur-xl rounded-3xl p-7 border border-white/20 shadow-2xl">
          {(page.logo_url || page.avatar_url) && (
            <img src={page.logo_url || page.avatar_url} alt={page.title} className="h-20 mx-auto mb-4 object-contain drop-shadow-xl" />
          )}
          <h1 className="text-2xl font-extrabold text-white text-center">{page.title}</h1>
          <p className="text-sm text-white/70 text-center mt-2 mb-6">
            {seller ? `Atendimento com ${seller.name} ✨` : "Preencha para continuar"}
          </p>
          <div className="space-y-3">
            <input
              value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="Seu nome"
              className="w-full px-4 py-3 rounded-xl bg-white/90 text-gray-900 placeholder:text-gray-400 outline-none font-medium"
            />
            <input
              value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} placeholder="Seu WhatsApp (com DDD)"
              inputMode="tel"
              className="w-full px-4 py-3 rounded-xl bg-white/90 text-gray-900 placeholder:text-gray-400 outline-none font-medium"
            />
            <button
              onClick={submitLead} disabled={submittingLead}
              className="w-full py-3.5 rounded-xl font-bold text-white text-lg shadow-lg active:scale-95 transition-transform disabled:opacity-60"
              style={{ background: `linear-gradient(135deg, ${accent}, ${accent2})` }}
            >
              {submittingLead ? "Aguarde..." : "Acessar"}
            </button>
          </div>
          <p className="text-[10px] text-white/40 text-center mt-4">Seus dados estão seguros conosco.</p>
        </div>
      </div>
    );
  }

  const renderCatalog = (item: any) => {
    if (!catalog.length) return null;
    return (
      <div key={item.id} className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <p className="text-white font-bold text-lg drop-shadow">{item.label || "Novidades"}</p>
          <span className="text-xs text-white/60">{catalog.length} produtos</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {catalog.map((p: any) => {
            const discount = p.compare_at_price && p.compare_at_price > p.price;
            return (
              <a
                key={p.id}
                href={`https://${SHOPIFY_STORE_DOMAIN}/products/${p.handle}`}
                target="_blank" rel="noopener noreferrer"
                onClick={() => handleClick(item)}
                className="block rounded-2xl overflow-hidden bg-white shadow-lg active:scale-95 transition-transform"
              >
                <div className="relative aspect-square overflow-hidden bg-gray-100">
                  {p.image_url && <img src={p.image_url} alt={p.title} className="w-full h-full object-cover" loading="lazy" />}
                  {p.is_new_arrival && (
                    <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: accent }}>NOVO</span>
                  )}
                  {discount && (
                    <span className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500 text-white">OFERTA</span>
                  )}
                </div>
                <div className="p-2.5">
                  <p className="text-xs font-semibold text-gray-800 truncate">{p.title}</p>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-sm font-extrabold text-gray-900">{formatPrice(p.price)}</span>
                    {discount && <span className="text-[10px] text-gray-400 line-through">{formatPrice(p.compare_at_price)}</span>}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen" style={{ background: page.background_value }}>
      <div className="max-w-lg mx-auto px-5 pt-10 pb-16">
        {/* Logo header with impact */}
        <div className="flex flex-col items-center mb-8">
          {(page.logo_url || page.avatar_url) && (
            <div className="relative mb-4">
              <div className="absolute inset-0 blur-2xl opacity-60 rounded-full" style={{ background: `linear-gradient(135deg, ${accent}, ${accent2})` }} />
              <img
                src={page.logo_url || page.avatar_url}
                alt={page.title}
                className="relative h-24 object-contain drop-shadow-2xl"
              />
            </div>
          )}
          <h1 className="text-3xl font-black text-white text-center drop-shadow-lg tracking-tight">{page.title}</h1>
          {page.subtitle && <p className="text-sm text-white/85 text-center mt-2 max-w-xs">{page.subtitle}</p>}
          {seller && (
            <div className="mt-3 flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur text-white text-xs font-medium">
              <Sparkles className="h-3.5 w-3.5" /> Atendimento com {seller.name}
            </div>
          )}
        </div>

        <div className="space-y-3.5">
          {items.map((item: any) => {
            if (item.item_type === "divider") return <hr key={item.id} className="border-white/15 my-2" />;
            if (item.item_type === "header") return (
              <p key={item.id} className="text-xs font-bold text-white/60 uppercase tracking-widest text-center mt-6 mb-1">{item.label}</p>
            );
            if (item.item_type === "catalog") return renderCatalog(item);

            const Icon = item.item_type === "social" && item.social_network
              ? (SOCIAL_ICONS[item.social_network] || Globe)
              : (ITEM_ICONS[item.item_type] || LinkIcon);
            const cover = item.style_config?.coverImage;
            const isBig = item.card_style === "card";

            if (isBig) {
              return (
                <button
                  key={item.id}
                  onClick={() => handleClick(item)}
                  className="w-full relative rounded-3xl overflow-hidden shadow-xl active:scale-[0.98] transition-transform min-h-[110px] flex items-end text-left"
                  style={cover
                    ? { backgroundImage: `url(${cover})`, backgroundSize: "cover", backgroundPosition: "center" }
                    : { background: `linear-gradient(135deg, ${accent}, ${accent2})` }}
                >
                  {cover && <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />}
                  <div className="relative p-5 w-full flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 rounded-2xl bg-white/25 backdrop-blur flex items-center justify-center flex-shrink-0">
                        <Icon className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="text-white font-extrabold text-lg leading-tight drop-shadow">{item.label}</p>
                        {item.description && <p className="text-white/85 text-xs mt-0.5">{item.description}</p>}
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-white/80" />
                  </div>
                </button>
              );
            }

            // compact card
            return (
              <button
                key={item.id}
                onClick={() => handleClick(item)}
                className="w-full py-4 px-5 rounded-2xl flex items-center gap-3 bg-white/95 shadow-md active:scale-[0.98] transition-transform"
              >
                <div className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${accent}22` }}>
                  <Icon className="h-5 w-5" style={{ color: accent2 }} />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="font-bold text-sm text-gray-900 truncate">{item.label}</p>
                  {item.description && <p className="text-xs text-gray-500 truncate">{item.description}</p>}
                </div>
                <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
              </button>
            );
          })}
        </div>

        <p className="text-center text-xs text-white/30 mt-12">Banana Calçados</p>
      </div>
    </div>
  );
}
