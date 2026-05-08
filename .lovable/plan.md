# Migração NFC-e PDV: Tiny → BrasilNFe + Imprimir + Contingência

## Objetivo
Substituir a emissão NFC-e via Tiny pela infra **BrasilNFe** já existente (`nfce-emitir` + fila `pending_sefaz`) no fluxo de fechamento do PDV, mantendo as configurações de "quando emitir" por loja e expondo o botão **Imprimir NFC-e** na tela de "Venda Finalizada". Garantir que a venda nunca trave: se SEFAZ falhar, vai pra contingência e cliente recebe o DANFE depois.

## O que muda (3 partes)

### 1. Configuração por loja (já existe, só ajustar UI)
A tabela `pos_invoice_config` já tem:
- `auto_emit_on_sale` (bool) — emitir automaticamente ao concluir venda
- `auto_emit_min_value` (numeric) — valor mínimo p/ auto-emitir
- `auto_emit_payment_methods` (text[]) — formas de pagamento que disparam auto-emissão (ex: pix, dinheiro)

Em `POSConfig.tsx` (já está montada a tela). Apenas:
- Atualizar copy: "NFC-e (BrasilNFe)" em vez de "Tiny"
- Validar que a loja tem `company_id` vinculado e a empresa tem `brasilnfe_token` antes de salvar (toast de erro se faltar)

### 2. Fluxo de finalização da venda (`POSSalesView.tsx`)
Substituir a função `emitNfce()` que chama `pos-tiny-emit-nfce` pela chamada à edge **`nfce-emitir`** (já existe, BrasilNFe + contingência):

```text
finalizarVenda()
  ├─ cria pos_sale (igual hoje)
  ├─ lê pos_invoice_config da loja
  ├─ se auto_emit_on_sale && total ≥ min && payment ∈ methods:
  │     dispara nfce-emitir em background (não bloqueia tela)
  └─ vai para step="invoice"

step="invoice":
  ├─ Botão "Emitir NFC-e" (se ainda não emitida) → chama nfce-emitir
  ├─ Polling/realtime em fiscal_documents WHERE pos_sale_id = sale.id
  ├─ Quando status='authorized' → habilita botão "Imprimir NFC-e" (abre danfe_url)
  ├─ Quando status='pending_sefaz' → mostra badge "Em contingência (será reemitida)" + botão Imprimir desabilitado
  └─ Quando status='rejected' → mostra erro + botão "Tentar novamente"
```

A edge `nfce-emitir` **já trata SEFAZ offline** (códigos 108/109/999, HTTP 5xx, timeout) marcando como `pending_sefaz`. A venda no PDV é concluída normalmente — o cron `nfce-retry-pending` (já agendado) reemite a cada 5 min.

### 3. Notificação ao cliente quando autorizada em contingência
Quando o cron autoriza uma NFC-e que estava `pending_sefaz`, disparar WhatsApp pro cliente com link do DANFE — para o cliente que pediu pra "imprimir/enviar" não ficar sem nota. Implementação: trigger no UPDATE de `fiscal_documents` (status `pending_sefaz`→`authorized`) que insere job de envio.

## Arquivos a editar
- `src/components/pos/POSSalesView.tsx` — trocar `emitNfce` para chamar `nfce-emitir`; auto-emit pós-venda baseado em `pos_invoice_config`; UI do step `invoice` com 3 estados (autorizada/contingência/rejeitada) e polling realtime em `fiscal_documents`.
- `src/components/pos/POSPickupOrders.tsx` — mesma troca de endpoint (handleEmitNfce).
- `src/components/pos/POSConfig.tsx` — texto "BrasilNFe" + validação de `company_id` / `brasilnfe_token`.
- `supabase/migrations/...` — trigger `on fiscal_documents` que ao virar `authorized` (vindo de `pending_sefaz`) enfileira mensagem WhatsApp pro CPF/telefone da venda.
- *(opcional fase 2)* depreciar `supabase/functions/pos-tiny-emit-nfce` — mantemos por ora como fallback histórico, sem chamar.

## Detalhes técnicos
- **Realtime**: `supabase.channel().on('postgres_changes', { table: 'fiscal_documents', filter: 'pos_sale_id=eq.<id>' })` para atualizar a UI sem polling.
- **Auto-emit**: roda *fire-and-forget* (`supabase.functions.invoke('nfce-emitir', { body: { sale_id }})` sem await bloqueante) — UI já mostra "emitindo..." e o realtime atualiza.
- **Botão Imprimir**: `window.open(fiscalDoc.danfe_url, '_blank')` — `danfe_url` já é preenchido por `nfce-emitir`.
- **Estados de status visíveis**: `pending` (emitindo), `pending_sefaz` (contingência), `authorized` (ok), `rejected` (erro).
- **Garantia de não-bloqueio**: a venda em `pos_sales` é criada **antes** de chamar NFC-e. Falha fiscal nunca cancela venda; só impede impressão imediata.

## Não está no escopo (futuro)
- Cancelamento NFC-e (CC-e)
- Inutilização de numeração
- Troca/devolução fiscal
