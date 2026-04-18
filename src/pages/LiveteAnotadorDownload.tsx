import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Chrome, FolderOpen, ToggleRight, Upload, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function LiveteAnotadorDownload() {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch("/livete-anotador.zip");
      if (!res.ok) throw new Error(`Falha ao baixar: ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "livete-anotador.zip";
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Download iniciado!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao baixar");
    } finally {
      setDownloading(false);
    }
  };

  const steps = [
    { icon: Download, title: "Baixe o arquivo", desc: "Clique no botão acima para baixar o ZIP da extensão." },
    { icon: FolderOpen, title: "Descompacte o ZIP", desc: "Extraia o arquivo em uma pasta de fácil acesso (ex: Documentos/livete-anotador)." },
    { icon: Chrome, title: "Abra o Chrome", desc: "Acesse chrome://extensions na barra de endereços." },
    { icon: ToggleRight, title: "Ative o Modo Desenvolvedor", desc: "Use o botão no canto superior direito da página de extensões." },
    { icon: Upload, title: "Carregue a extensão", desc: "Clique em 'Carregar sem compactação' e selecione a pasta descompactada." },
    { icon: CheckCircle2, title: "Pronto!", desc: "Abra a live do Instagram, clique no ícone da extensão, cole o código do evento e inicie a captura." },
  ];

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
          <Chrome className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold mb-2">Livete – Anotador de Live</h1>
        <p className="text-muted-foreground">
          Extensão do Chrome que captura comentários da live do Instagram em tempo real e envia direto para o painel de Eventos.
        </p>
      </div>

      <Card className="mb-8 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader>
          <CardTitle>Baixar a extensão</CardTitle>
          <CardDescription>
            Versão 1.4.0 — Compatível com Chrome, Edge, Brave e outros navegadores Chromium.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleDownload} disabled={downloading} size="lg" className="w-full sm:w-auto">
            <Download className="w-5 h-5 mr-2" />
            {downloading ? "Baixando..." : "Baixar livete-anotador.zip"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Como instalar</CardTitle>
          <CardDescription>Siga os passos abaixo para instalar a extensão no seu navegador.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={i} className="flex gap-4 p-3 rounded-lg hover:bg-muted/40 transition">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">
                    {i + 1}. {step.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{step.desc}</p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Como usar</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. Abra o evento ao vivo em <strong>Eventos &gt; Live</strong> e copie o código do evento.</p>
          <p>2. Acesse a live no Instagram (instagram.com).</p>
          <p>3. Clique no ícone da extensão Livete na barra do Chrome.</p>
          <p>4. Cole o código do evento, defina o nome/número do PC e clique em <strong>Iniciar captura</strong>.</p>
          <p>5. Os comentários aparecerão automaticamente no painel da apresentadora, na aba <strong>Comentários IG</strong>.</p>
        </CardContent>
      </Card>
    </div>
  );
}
