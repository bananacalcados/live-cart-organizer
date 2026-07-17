# Trocas / Devoluções — Presencial, Voucher e Preço Real

Duas frentes independentes:
A) Novo fluxo **Troca Presencial** (finaliza em 1 modal, com voucher e diferença).
B) Correção do **valor do item na troca** (usar preço realmente pago, não preço de tabela).

---

## A. Troca Presencial

### A.1 Diagnóstico do que muda vs. hoje
Hoje "Nova Troca/Devolução" cai direto no `NewExchangePicker` (fluxo com envio). Precisamos de um seletor antes:

```text
Trocas/Devolução
   └─ Nova Troca/Devolução
        ├─ [Troca com Envio]   → fluxo atual (mantém 100%)
        └─ [Troca Presencial]  → NOVO fluxo (finaliza tudo no modal)
```

### A.2 Etapas de implementação

**Etapa 1 — Modal de escolha do tipo**
- Novo componente `ExchangeTypePicker.tsx` com dois cards: *Presencial* / *Com Envio*.
- Botão "Nova Troca/Devolução" abre este seletor primeiro.

**Etapa 2 — Voucher (base para o presencial)**
Nova tabela `pos_vouchers`:
- `code` (BC-VC-XXXXXX gerado por sequence), `customer_unified_id`, `origin_troca_id`, `original_sale_id`, `amount`, `balance`, `expires_at`, `status` (`active|used|expired|cancelled`), `store_id`, `created_by`.
- Índices por `code`, `customer_unified_id`.
- RLS: `authenticated` full, `service_role` all.

RPCs:
- `create_voucher(...)` → gera code único, retorna registro.
- `redeem_voucher(code, amount)` → valida validade/saldo, debita `balance`, marca `used` se zerar.
- `find_voucher(code)` → usado no campo de cupom do PDV.

**Etapa 3 — `PresentialExchangePicker.tsx`** (baseado no `NewExchangePicker`, mas simplificado)
Remove:
- Campo "Código de postagem reversa".
- Bloco "Modo de expedição".
- Etapas 2/3 do wizard (NF-e reposição + rastreio WhatsApp).

Mantém:
- Seleção do pedido original + itens devolvidos.
- Motivo, Devolução vs Troca.
- Bloco "Produtos de reposição".

Adiciona:
- Toggle **Voucher integral** (marca todos itens como devolvidos, gera voucher no valor total; sem reposição).
- Cálculo de diferença ao vivo (após correção do preço — ver B):
  - `diferenca = total_reposicao − total_devolvido`
  - Se `> 0` (cliente paga): bloco **Formas de pagamento** com multi-linhas (método + valor), somando até cobrir diferença. Reusa componente de pagamento do PDV (`PosPaymentMethods` / equivalente).
  - Se `< 0` (crédito ao cliente): bloco **Gerar voucher da diferença** com `expires_at` (default +90 dias) e preview do code.
  - Se `== 0`: apenas troca simples.

**Etapa 4 — Backend `finalize-presential-exchange` (edge function nova)**
Fluxo transacional único (uma chamada finaliza tudo):

1. Detecta origem fiscal da venda original:
   - `has_fiscal = existe fiscal_document authorized (modelo 55 ou 65) vinculado ao `original_sale_id``.
2. **Sempre**: devolve itens ao estoque em tempo real (`pos_stock_movements` + `pos_products.stock`).
3. **Sempre**: cancela pedido original (`pos_sales.status='cancelled'`, marca `cancelled_reason='troca_presencial'`).
4. Se `has_fiscal`: enfileira **NF-e de devolução** (mod. 55 fin=4, ref à chave original) via `nfe-devolucao-emitir` — assíncrono, mas devolução de estoque/cancelamento não esperam.
5. Se troca com produtos novos:
   - Cria **novo `pos_sales`** com itens de reposição, `sale_type='exchange'`, `external_source='troca_presencial'`, `parent_troca_id`, `customer_unified_id` copiado.
   - Se diferença > 0: grava `pos_sale_payments` com métodos informados.
   - Se `has_fiscal` **e** diferença paga em (crédito|débito|pix): dispara `nfce-emitir` para o novo pedido usando snapshot do cliente da venda original.
   - Se diferença ≤ 0: novo pedido total = total dos itens novos, pagamento = `voucher` de valor equivalente.
6. Se `voucher_integral` **e sem reposição**: NÃO cria novo `pos_sales`. Só cancela original + gera voucher.
7. Se diferença negativa com reposição: cria voucher pelo saldo.
8. Marca `trocas_devolucoes.status='concluida'` direto (sem passar por `aguardando_envio`).

Idempotência: chave `troca_id` + guard em `trocas_devolucoes.status`.

**Etapa 5 — Integração do voucher no PDV**
- Campo "Cupom" da tela de Venda: se o código bater regex `BC-VC-*`, chama `redeem_voucher` em vez do fluxo de cupom normal. Aplica como desconto/pagamento tipo `voucher`.
- Aba **Consultar** de Trocas: exibir o `voucher.code` do registro, com botão copiar e badge de saldo/validade.

**Etapa 6 — Verificação**
- Testar 6 cenários: (a) devolução sem NF, (b) devolução com NF, (c) troca par-a-par sem diferença, (d) troca com diferença a receber (PIX → gera NFCe), (e) troca com diferença a receber (dinheiro → sem NFCe), (f) troca com crédito ao cliente (gera voucher), (g) voucher integral.
- Confirmar em cada caso: estoque, pedido cancelado, novo pedido (ou ausência), NF-e devolução, NFCe nova, voucher gerado + resgatável na Venda.

---

## B. Preço real na troca (bug do R$ 200 vs R$ 79,99)

### B.1 Diagnóstico
`pos_sale_items.unit_price` guarda o **preço de tabela** do item. O desconto fica em `pos_sales.discount` no nível do pedido. Quando `NewExchangePicker` carrega os itens devolvíveis, usa `unit_price` cru — por isso mostra o valor cheio, ignorando desconto rateado.

### B.2 Correção
- Criar helper `computeEffectiveUnitPrice(saleItems, saleDiscount, saleTotal)`:
  - `subtotal = Σ(unit_price*qty)`
  - Se `discount > 0`: fator = `(subtotal − discount) / subtotal`
  - `effective_unit = unit_price * fator` (arredonda 2 casas; ajusta última linha para bater com `total`).
- Aplicar em:
  - `NewExchangePicker.tsx` (carregamento de itens devolvíveis).
  - `PresentialExchangePicker.tsx` (novo).
  - `SiteExchangePicker.tsx` (mesma lógica).
  - `finalizeExchange.ts` / venda-espelho (usa `effective_unit` para casar com valor real devolvido).
  - Emissão de NF-e devolução (item price).
- **Não** alterar `pos_sale_items` no banco — cálculo runtime, evita mexer em vendas históricas.
- Cobrir com teste unitário em `src/lib/pos/` (novo `effectivePrice.test.ts`) com 3 cenários (sem desconto, desconto proporcional, arredondamento).

### B.3 Verificação
- Abrir a troca da cliente citada (R$ 200 / R$ 79,99) e confirmar que o modal agora mostra 79,99.
- Emitir uma NF-e devolução de teste e confirmar valor correto.

---

## Ordem de execução
1. Migration `pos_vouchers` + RPCs.
2. Helper de preço efetivo + testes + patch nos pickers existentes (B).
3. `ExchangeTypePicker` + roteamento do botão.
4. `PresentialExchangePicker` UI.
5. Edge function `finalize-presential-exchange`.
6. Integração voucher no campo de cupom da Venda + exibição em Consultar.
7. Round de testes manuais nos 7 cenários.

Cada etapa termina com verificação antes de prosseguir para a próxima.
