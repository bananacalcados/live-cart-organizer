import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Send } from "lucide-react";

export function FinancialAgentSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" /> Agente Financeiro (Telegram)
          <Badge variant="outline" className="ml-2">Em construção</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>Esta aba vai concentrar a configuração do bot:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Whitelist de chat_ids autorizados</li>
          <li>Geração de tokens de convite (/start)</li>
          <li>Auditoria de mensagens e anexos processados</li>
          <li>Status de importações (collection MP, account_statement, OFX, etc.)</li>
          <li>Painel de "Recebíveis órfãos" e conciliação manual</li>
        </ul>
        <div className="rounded-md border bg-muted/30 p-3 flex items-start gap-2">
          <Send className="h-4 w-4 mt-0.5 text-primary" />
          <div className="text-xs">
            <p className="font-medium text-foreground">Próximo passo</p>
            <p>Cadastrar o token do bot via Configurações Seguras e registrar o webhook. Vou te pedir o token no próximo passo.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
