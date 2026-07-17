# Wizard pós-troca com NF-e da reposição, rastreio e WhatsApp

Transforma o modal atual "Finalizar Troca / Devolução" em um wizard de 3 etapas **apenas quando há reposição** (envio novo pro cliente). Devolução pura mantém o fluxo atual de 1 etapa.

## Fluxo novo

```text
Etapa 1: Conferência (modal atual)           ── botão vira "Avançar"
   │
   ├── Se NÃO há reposição → Concluir agora (fluxo antigo)
   │
   ▼
Etapa 2: NF-e da reposição (mod.55 fin=1)
   • Preview editável antes de emitir na SEFAZ
   • Editáveis: destinatário (nome/CPF/endereço), CFOP por item,
     preço/qtd por item, natureza da operação, observações
   • Botão "Emitir NF-e" → chama edge function → mostra status
   • Se rejeitada: exibe motivo, permite editar e reemitir
   • Ao autorizar: mostra DANFE (PDF) + XML pra download
   • Botão "Avançar" só habilita com NF autorizada
   │
   ▼
Etapa 3: Rastreio + WhatsApp
   • Input do código de rastreio + transportadora
   • Seletor de instância WhatsApp
   • Template editável com {nome}, {codigo}, {transportadora}
   • Preview da mensagem final
   • Botão único "Enviar WhatsApp e concluir troca"
   │
   ▼
Troca marcada como concluída
```

Nenhuma etapa é pulável (conforme decisão do usuário). Se o operador fechar o modal no meio, a troca fica em `status='aguardando_envio'` e reabre exatamente onde parou.

## Componentes de UI

Arquivos novos em `src/components/pos/exchange-wizard/`:

- `ExchangeWizardDialog.tsx` — container do wizard, gerencia step atual e estado compartilhado.
- `Step1Conference.tsx` — extrai o conteúdo atual do modal `Finalizar Troca / Devolução` (o que já está em `FinalizeExchangeDialog`).
- `Step2NfeReposicao.tsx` — preview editável da NF-e com tabela de itens (CFOP/preço/qtd), campos do destinatário, natureza, obs. Botão emitir + status.
- `Step3TrackingWhatsApp.tsx` — código rastreio, transportadora, seletor de instância (reusa `WhatsAppNumberSelector`), textarea do template, preview, botão enviar+concluir.

Arquivo alterado:
- `src/lib/pos/finalizeExchange.ts` — separa em duas fases:
  1. `finalizeExchangeReturn()`: NF devolução + cancelamento + estoque + venda-espelho `pos_sales` (o que já faz hoje). Marca `status='aguardando_envio'` se houver reposição, senão `concluida`.
  2. `completeExchangeShipping({ nfe_id, tracking_code, carrier })`: última etapa, marca troca `concluida`, grava rastreio na venda-espelho.

## Backend

### Nova coluna
`trocas_devolucoes`:
- `status` novo valor: `aguardando_envio` (entre `em_conferencia` e `concluida`)
- `nfe_reposicao_id UUID` FK → `fiscal_documents(id)`
- `tracking_code TEXT`
- `tracking_carrier TEXT`
- `whatsapp_notification_sent_at TIMESTAMPTZ`

`pos_sales` (venda-espelho da reposição):
- `tracking_code TEXT` (usa também em envios normais no futuro)
- `tracking_carrier TEXT`

### Nova edge function: `pos-exchange-emit-nfe-reposicao`

Body:
```json
{
  "troca_id": "uuid",
  "pos_sale_id": "uuid",           // venda-espelho já criada
  "overrides": {
    "destinatario": { "nome", "cpf", "endereco": {...} },
    "natureza_operacao": "Venda em substituição - troca",
    "observacoes": "Ref. TD-2026-000008",
    "items": [{ "id", "cfop", "unit_price", "quantity" }]
  }
}
```

Fluxo:
1. Monta payload BrasilNFe reaproveitando o golden `nfe-emitir` (mod.55, fin=1, natureza "Venda em substituição – Troca").
2. Aplica overrides antes de enviar.
3. Emite → grava em `fiscal_documents` vinculado ao `pos_sale_id`.
4. Atualiza `trocas_devolucoes.nfe_reposicao_id`.
5. Retorna DANFE URL, XML URL e status.

Segue o mesmo padrão do `nfe-emitir` atual (idempotência, retry SEFAZ, contingência pending_sefaz).

### Nova edge function: `pos-exchange-send-tracking-whatsapp`

Body:
```json
{
  "troca_id": "uuid",
  "pos_sale_id": "uuid",
  "tracking_code": "BR123...",
  "carrier": "Correios",
  "whatsapp_instance_id": "uuid",
  "phone": "5533...",
  "message": "Oi {nome}! Seu pedido..."
}
```

Fluxo:
1. Roteia pelo provider correto da instância (uazapi/wasender/meta) — reusa `_shared/instance-guard.ts`.
2. Envia mensagem.
3. Grava `whatsapp_notification_sent_at`, `tracking_code`, `carrier` na troca e na venda-espelho.
4. Marca `trocas_devolucoes.status = 'concluida'`.
5. Retorna sucesso.

## Template padrão WhatsApp

Salvo em `app_settings` key `exchange_shipping_wa_template` (editável no futuro em Admin). Default:

```
Oi {nome}! 👋

Sua troca foi processada e o novo pedido já foi criado para envio.

📦 Rastreio: {codigo}
🚚 Transportadora: {carrier}

Assim que a transportadora coletar, você recebe a atualização por aqui. Qualquer dúvida é só chamar!
```

## Regressão / segurança

- Devolução pura (sem reposição): mantém 1 etapa e nenhuma alteração de comportamento.
- Se o operador emitir NF e depois fechar antes do rastreio: NF fica válida, troca em `aguardando_envio`, aparece no módulo Trocas com botão "Continuar envio" que reabre o wizard direto na Etapa 3.
- Se NF for rejeitada: nada da Etapa 1 é revertido (devolução, cancelamento, venda-espelho continuam válidos). Só a Etapa 2 fica pendente.
- Idempotência: `pos-exchange-emit-nfe-reposicao` checa `nfe_reposicao_id` antes de emitir de novo.
- Reaproveita 100% do fluxo fiscal golden (`nfe-emitir` payload) — só adiciona uma camada de overrides.

## Detalhes técnicos

- Migration: adiciona colunas + novo enum value `aguardando_envio`.
- 2 novas edge functions com JWT verificado (equipe logada, não requer admin).
- UI usa o padrão de wizard já existente (`components/ui/dialog` + steps controlados por estado).
- Selector de instância WhatsApp reusa `WhatsAppNumberSelector` existente.
- Nenhuma mudança no fluxo de vendas normais, apenas no fluxo de troca com reposição.
