import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Link, Phone, MapPin, ShoppingBag, Globe, Instagram, Mail, Type, Minus
} from "lucide-react";

const SHOPIFY_STORE_DOMAIN = 'ftx2e2-np.myshopify.com';

const ITEM_ICONS: Record<string, typeof Link> = {
  link: Link, whatsapp: Phone, address: MapPin, catalog: ShoppingBag,
  website: Globe, instagram: Instagram, email: Mail, header: Type, divider: Minus,
};

export default function LinkPageView() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data, error } = await supabase
        .from('link_pages')
        .select('*')
        .eq('slug', slug)
        .eq('is_active', true)
        .single();
      
      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setPage(data);

      // Fetch items
      const { data: itemsData } = await supabase
        .from('link_page_items')
        .select('*')
        .eq('page_id', data.id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      setItems(itemsData || []);
      setLoading(false);

      // Track page view
      const utmData = {
        page_id: data.id,
        event_type: 'page_view',
        utm_source: searchParams.get('utm_source'),
        utm_medium: searchParams.get('utm_medium'),
        utm_campaign: searchParams.get('utm_campaign'),
        utm_content: searchParams.get('utm_content'),
        utm_term: searchParams.get('utm_term'),
        referrer: document.referrer || null,
        user_agent: navigator.userAgent,
      };
      await supabase.from('link_page_visits').insert(utmData);

      // Update view count
      await supabase.from('link_pages').update({ total_views: (data.total_views || 0) + 1 }).eq('id', data.id);

      // Meta Pixel
      if (data.meta_pixel_id) {
        const script = document.createElement('script');
        script.innerHTML = `
          !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
          fbq('init','${data.meta_pixel_id}');
          fbq('track','PageView');
        `;
        document.head.appendChild(script);
      }
    })();
  }, [slug, searchParams]);

  const handleClick = async (item: any) => {
    // Track click
    await supabase.from('link_page_visits').insert({
      page_id: page.id,
      item_id: item.id,
      event_type: 'click',
      utm_source: searchParams.get('utm_source'),
      utm_medium: searchParams.get('utm_medium'),
      utm_campaign: searchParams.get('utm_campaign'),
      referrer: document.referrer || null,
    });

    // Update click counts
    await supabase.from('link_page_items').update({ clicks: (item.clicks || 0) + 1 }).eq('id', item.id);
    await supabase.from('link_pages').update({ total_clicks: (page.total_clicks || 0) + 1 }).eq('id', page.id);

    // Meta Pixel event
    if (page.meta_pixel_id && (window as any).fbq) {
      (window as any).fbq('trackCustom', 'LinkClick', { label: item.label, type: item.item_type });
    }

    if (item.url) window.open(item.url, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#1a1a2e' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
      </div>
    );
  }

  if (notFound || !page) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#1a1a2e' }}>
        <div className="text-center text-white">
          <h1 className="text-2xl font-bold mb-2">Página não encontrada</h1>
          <p className="text-white/60">Este link não existe ou foi desativado.</p>
        </div>
      </div>
    );
  }

  const themeConfig = page.theme_config || {};
  const btnColor = themeConfig.buttonColor || '#ffffff';
  const txtColor = themeConfig.buttonTextColor || '#000000';
  const btnStyle = themeConfig.buttonStyle || 'filled';

  return (
    <div className="min-h-screen" style={{ background: page.background_value }}>
      <div className="max-w-lg mx-auto px-6 pt-12 pb-16">
        <div className="flex flex-col items-center">
          {page.avatar_url && (
            <img
              src={page.avatar_url}
              alt={page.title}
              className="w-24 h-24 rounded-full border-3 border-white/30 mb-5 object-cover shadow-lg"
            />
          )}
          <h1 className="text-2xl font-bold text-white text-center drop-shadow-lg">{page.title}</h1>
          {page.subtitle && <p className="text-sm text-white/80 text-center mt-2 drop-shadow max-w-xs">{page.subtitle}</p>}
        </div>

        <div className="mt-10 space-y-3">
          {items.map(item => {
            if (item.item_type === 'divider') return <hr key={item.id} className="border-white/20 my-4" />;
            if (item.item_type === 'header') return (
              <p key={item.id} className="text-xs font-semibold text-white/60 uppercase tracking-widest text-center mt-6 mb-2">{item.label}</p>
            );

            // Catalog: render as product image grid
            if (item.item_type === 'catalog' && (item.style_config?.products || []).length > 0) {
              const products = item.style_config.products as Array<{id: string; title: string; image: string; price: string; handle: string}>;
              return (
                <div
                  key={item.id}
                  className="rounded-xl overflow-hidden transition-all duration-200"
                  style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
                >
                  <div className="grid grid-cols-3 gap-0.5 p-1">
                    {products.slice(0, 6).map(p => (
                      <a
                        key={p.id}
                        href={`https://${SHOPIFY_STORE_DOMAIN}/products/${p.handle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="aspect-square overflow-hidden rounded-sm cursor-pointer transition-all duration-200 hover:scale-105 hover:opacity-90 relative group"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClick(item);
                        }}
                      >
                        {p.image && <img src={p.image} alt={p.title} className="w-full h-full object-cover" loading="lazy" />}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-end opacity-0 group-hover:opacity-100">
                          <p className="text-white text-[9px] font-medium p-1 leading-tight truncate w-full">{p.title}</p>
                        </div>
                      </a>
                    ))}
                  </div>
                  {products.length > 6 && (
                    <div className="grid grid-cols-3 gap-0.5 px-1 pb-1">
                      {products.slice(6, 9).map(p => (
                        <a
                          key={p.id}
                          href={`https://${SHOPIFY_STORE_DOMAIN}/products/${p.handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="aspect-square overflow-hidden rounded-sm cursor-pointer transition-all duration-200 hover:scale-105 relative group"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClick(item);
                          }}
                        >
                          {p.image && <img src={p.image} alt={p.title} className="w-full h-full object-cover" loading="lazy" />}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-end opacity-0 group-hover:opacity-100">
                            <p className="text-white text-[9px] font-medium p-1 leading-tight truncate w-full">{p.title}</p>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="text-center py-3 cursor-pointer" onClick={() => handleClick(item)}>
                    <p className="text-white font-semibold text-sm">{item.label}</p>
                    {item.description && <p className="text-white/50 text-xs mt-0.5">{item.description}</p>}
                    <p className="text-white/40 text-xs mt-0.5">{products.length} produtos</p>
                  </div>
                </div>
              );
            }

            const Icon = ITEM_ICONS[item.item_type] || Link;
            let className = 'w-full py-4 px-5 rounded-xl flex items-center gap-4 cursor-pointer transition-all duration-200 hover:scale-[1.03] hover:shadow-xl active:scale-[0.97]';
            let style: React.CSSProperties = {};

            if (btnStyle === 'filled') {
              style = { backgroundColor: btnColor, color: txtColor };
            } else if (btnStyle === 'outline') {
              style = { border: `2px solid ${btnColor}`, color: btnColor, backgroundColor: 'transparent' };
            } else if (btnStyle === 'soft') {
              style = { backgroundColor: `${btnColor}22`, color: btnColor, backdropFilter: 'blur(12px)' };
            } else if (btnStyle === 'rounded') {
              className += ' !rounded-full';
              style = { backgroundColor: btnColor, color: txtColor };
            }

            return (
              <button key={item.id} className={className} style={style} onClick={() => handleClick(item)}>
                <Icon className="h-5 w-5 flex-shrink-0" />
                <div className="flex-1 min-w-0 text-left">
                  <p className="font-semibold text-sm">{item.label}</p>
                  {item.description && <p className="text-xs opacity-60 mt-0.5">{item.description}</p>}
                </div>
                <svg className="h-4 w-4 opacity-40 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            );
          })}
        </div>

        <p className="text-center text-xs text-white/30 mt-12">Powered by Banana Store</p>
      </div>
    </div>
  );
}
