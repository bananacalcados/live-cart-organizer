import { Mail, Megaphone, FileText, Users, BarChart3, ArrowLeft } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useNavigate } from "react-router-dom";
import { EmailBuilder } from "@/components/marketing/email/EmailBuilder";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const EmailMarketing = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/marketing")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <Mail className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold text-foreground">Email Marketing</h1>
            </div>
          </div>
          <ThemeToggle />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="campanhas" className="w-full">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="campanhas" className="gap-2">
              <Megaphone className="h-4 w-4" />
              Campanhas
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-2">
              <FileText className="h-4 w-4" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="contatos" className="gap-2">
              <Users className="h-4 w-4" />
              Contatos
            </TabsTrigger>
            <TabsTrigger value="metricas" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Métricas
            </TabsTrigger>
          </TabsList>

          <TabsContent value="campanhas">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Megaphone className="h-5 w-5 text-primary" />
                  Campanhas de Email
                </CardTitle>
                <CardDescription>
                  Crie e gerencie suas campanhas de email marketing. Agende disparos, segmente sua base e acompanhe os resultados.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center h-48 text-muted-foreground">
                  Em breve — criação e gestão de campanhas de email
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="templates">
            <EmailBuilder
              onSave={async (blocks, html) => {
                try {
                  const { data: { user } } = await supabase.auth.getUser();
                  if (!user) {
                    toast.error('Faça login para salvar templates');
                    return;
                  }
                  const { error } = await supabase.from('email_templates').insert({
                    name: 'Novo Template',
                    blocks: blocks as any,
                    html_content: html,
                    user_id: user.id,
                  });
                  if (error) throw error;
                  toast.success('Template salvo!');
                } catch (err: any) {
                  toast.error('Erro ao salvar: ' + err.message);
                }
              }}
            />
          </TabsContent>

          <TabsContent value="contatos">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  Lista de Contatos
                </CardTitle>
                <CardDescription>
                  Gerencie sua base de contatos, importe listas e crie segmentações para campanhas direcionadas.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center h-48 text-muted-foreground">
                  Em breve — gestão de contatos e segmentação
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="metricas">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  Métricas de Email
                </CardTitle>
                <CardDescription>
                  Acompanhe taxas de abertura, cliques, bounces e conversões das suas campanhas de email.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center h-48 text-muted-foreground">
                  Em breve — dashboard de métricas de email
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default EmailMarketing;
