# Parcelamento sem juros — Checkout do WhatsApp (PDV)

## Contexto — como o Eventos resolveu o bug de "não estava logado como admin"

No módulo Eventos, o override de parcelamento é lido pelo `TransparentCheckout` via a RPC `get_event_installment_config(p_event_id)`. Ela é **SECURITY DEFINER** com `GRANT EXECUTE ... TO anon, authenticated`. Isso foi criado exatamente porque a tabela `events` tem RLS bloqueando `anon` — antes disso, clientes deslogados abriam o link e recebiam 10× **com** juros porque o `SELECT` direto retornava `null`. Depois o `useMemo` `installmentConfig` mescla a config base (`app_settings`) com o override do evento, usando `Math.max` tanto em `max_installments` quanto em `interest_free_installments`.

**Vamos aplicar exatamente o mesmo padrão** no checkout do WhatsApp: gravar o override na venda + expor via RPC SECURITY DEFINER + mesclar no `StoreCheckout`.

## Onde o link nasce e onde é consumido

- **Origem**: `POSWhatsAppCheckoutDialog.tsx` cria uma linha em `pos_sales` (status `online_pending`, `payment_gateway=store-checkout`) e monta a URL `https://checkout.bananacalcados.com.br/checkout-loja/{storeId}/{saleId}`.
- **Destino**: `src/pages/StoreCheckout.tsx` carrega essa venda e usa `installmentConfig` (hoje só do `app_settings`) no `CardPaymentForm`. **Não existe hoje** override por venda — é aqui que vamos plugar.

## Diferença de UX pedida pelo usuário

Diferente do Eventos (que pede valor mínimo de compra), aqui o vendedor escolhe **exatamente quantas parcelas sem juros** para aquela venda específica, **sem valor mínimo**. Default = herdar a config global (nada muda).

---

## Etapa 1 — UI no diálogo do checkout do chat

Arquivo: `src/components/pos/POSWhatsAppCheckoutDialog.tsx`.

- Novo campo compacto no bloco de "Desconto & Frete": `Parcelas sem juros (opcional)` — `Input type="number"` de 1 a 12, vazio = usar padrão.
- Ao clicar "Gerar link", incluir no `payment_details` uma chave nova:
  ```
  installment_override: { interest_free_installments: N, source: "pos_whatsapp_checkout" }
  ```
- Nada muda no fluxo se o campo ficar vazio (compatibilidade total com links já gerados).

## Etapa 2 — RPC SECURITY DEFINER para o cliente anônimo

Nova migração criando `get_sale_installment_override(p_sale_id uuid)`:

- Lê `payment_details->'installment_override'` de `pos_sales`.
- Retorna `jsonb` com `interest_free_installments` (int) e opcional `max_installments` (para uso futuro).
- `GRANT EXECUTE ... TO anon, authenticated`.
- Motivo (**crítico, é a mesma armadilha do Eventos**): `pos_sales` tem RLS. Sem essa RPC, o cliente deslogado lê `null` e cai no default de 6× sem juros, exatamente o mesmo bug que aconteceu no Eventos antes da correção.

## Etapa 3 — Consumir o override no StoreCheckout

Arquivo: `src/pages/StoreCheckout.tsx`.

- Novo `useEffect` após carregar a venda: chama `supabase.rpc("get_sale_installment_override", { p_sale_id: saleId })` e guarda em state.
- No cálculo de `installmentConfig`, aplicar `Math.max(base.interest_free_installments, override.interest_free_installments)` e o mesmo para `max_installments` se vier — mesmo padrão do `TransparentCheckout` (linhas 1579–1595).
- Assim, se o vendedor pediu 10× sem juros, o `<Select>` de parcelas mostra "10× de R$ X sem juros" mesmo quando o cliente está deslogado.

## Etapa 4 — Verificação (sem quebrar nada)

- Gerar um link **sem** preencher o campo → checkout deve continuar com a config atual (6× sem juros / 12× com juros).
- Gerar um link **com** 10 sem juros → abrir em aba anônima, confirmar que o `<Select>` mostra "10× ... sem juros" e que o cálculo bate (sem `hasInterest`).
- Rodar `bunx vitest run` para os testes existentes de checkout continuarem passando.

---

## Fora do escopo desta rodada

- Alterar o parcelamento no fluxo do módulo Eventos.
- Mudança em `TransparentCheckout` (esse fluxo é dos eventos/live, não do link do chat do PDV).
- Persistir preferências de parcelamento por vendedor ou por cliente.

Se aprovar, executo Etapa 1 + 2 + 3 no mesmo turno (o volume é pequeno) e valido em seguida.
