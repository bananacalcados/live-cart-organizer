import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";

interface LandingPage {
  id: string;
  campaign_id: string;
  slug: string;
  title: string;
  description: string | null;
  hero_image_url: string | null;
  form_fields: Array<{ name: string; label: string; type: string; required: boolean }>;
  thank_you_message: string;
  whatsapp_redirect: string | null;
  custom_css: string | null;
  is_active: boolean;
}

export default function LandingPage() {
  const { slug } = useParams<{ slug: string }>();
  const [page, setPage] = useState<LandingPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!slug) return;
    const load = async () => {
      // Track view
      const { data, error } = await supabase
        .from('campaign_landing_pages')
        .select('*')
        .eq('slug', slug)
        .eq('is_active', true)
        .single();
      if (error || !data) { setLoading(false); return; }
      setPage(data as unknown as LandingPage);
      setLoading(false);
      // Increment views
      await supabase.from('campaign_landing_pages').update({ views: (data.views || 0) + 1 } as any).eq('id', data.id);
    };
    load();
  }, [slug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!page) return;
    setSubmitting(true);
    try {
      // Save lead
      await supabase.from('campaign_leads').insert({
        campaign_id: page.campaign_id,
        name: formData.name || formData.nome || null,
        phone: formData.phone || formData.whatsapp || formData.telefone || null,
        email: formData.email || null,
        instagram: formData.instagram || null,
        source: 'landing_page',
        metadata: formData as any,
      });
      // Increment submissions
      await supabase.from('campaign_landing_pages').update({ submissions: (page as any).submissions + 1 } as any).eq('id', page.id);
      // Update campaign leads count
      try {
        await supabase.from('marketing_campaigns').update({ leads_captured: ((page as any).submissions || 0) + 1 } as any).eq('id', page.campaign_id);
      } catch {}

      setSubmitted(true);

      if (page.whatsapp_redirect) {
        setTimeout(() => { window.location.href = page.whatsapp_redirect!; }, 2000);
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro ao enviar. Tente novamente.");
    } finally { setSubmitting(false); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-background"><p className="text-muted-foreground">Carregando...</p></div>;
  if (!page) return <div className="min-h-screen flex items-center justify-center bg-background"><p className="text-muted-foreground">Página não encontrada</p></div>;

  const fields = Array.isArray(page.form_fields) ? page.form_fields : [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
      <style>{page.custom_css || ''}</style>
      <Card className="w-full max-w-md shadow-xl">
        {page.hero_image_url && (
          <div className="w-full h-48 overflow-hidden rounded-t-lg">
            <img src={page.hero_image_url} alt={page.title} className="w-full h-full object-cover" />
          </div>
        )}
        <CardContent className="pt-6 pb-8 px-6 space-y-4">
          {submitted ? (
            <div className="text-center space-y-3 py-8">
              <CheckCircle2 className="h-12 w-12 mx-auto text-primary" />
              <h2 className="text-xl font-bold">{page.thank_you_message}</h2>
              {page.whatsapp_redirect && (
                <p className="text-sm text-muted-foreground">Redirecionando para o WhatsApp...</p>
              )}
            </div>
          ) : (
            <>
              <div className="text-center space-y-1">
                <h1 className="text-2xl font-bold">{page.title}</h1>
                {page.description && <p className="text-sm text-muted-foreground">{page.description}</p>}
              </div>
              <form onSubmit={handleSubmit} className="space-y-3">
                {fields.map(field => (
                  <div key={field.name} className="space-y-1">
                    <Label className="text-sm">{field.label}</Label>
                    <Input
                      type={field.type || 'text'}
                      required={field.required}
                      value={formData[field.name] || ''}
                      onChange={e => setFormData(prev => ({ ...prev, [field.name]: e.target.value }))}
                      placeholder={field.label}
                    />
                  </div>
                ))}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? 'Enviando...' : 'Participar'}
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
