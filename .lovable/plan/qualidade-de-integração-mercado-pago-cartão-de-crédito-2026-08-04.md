# Qualidade de integração Mercado Pago — cartão de crédito

Foco exclusivo em **cartão de crédito** (PIX e boleto ficam de fora por ora). Cada etapa é independente, reversível e termina com uma auditoria de verificação. Nada do fluxo de cascata (Pagar.me / AppMax / Vindi) muda de comportamento — só enriquecemos e padronizamos o que é enviado ao Mercado Pago.

Regra geral de segurança: toda etapa mantém **fallback silencioso**. Se um dado novo não existir, o pagamento segue exatamente como hoje.

---

## Etapa 1 — Corrigir crédito x débito no StoreCheckout (bug real)

Problema: o checkout de loja física não envia `mpPaymentTypeId`, então cartão de débito entra na cascata como crédito. Isso gera recusa e polui a qualidade da integração.

- Passar `mpPaymentTypeId` e `mpPaymentMethodId` do token gerado no front para o backend, igual já é feito no checkout transparente.
- Backend respeita o tipo recebido e não "adivinha" mais.

Auditoria: gerar tokens de teste com BIN de débito e de crédito e conferir nos logs que `payment_type_id` chega correto; conferir últimos pagamentos reais no banco por `payment_method_label`.

---

## Etapa 2 — Device ID obrigatório no cartão de crédito

Problema: o `device_id` (MP_DEVICE_SESSION_ID) hoje só vai em parte dos fluxos e pode chegar vazio se o script de segurança ainda não carregou.

- Garantir que o script de segurança carregue no mount de todos os checkouts com cartão (transparente, loja, área de membros).
- Aguardar (com timeout curto) a existência do device_id antes de enviar o pagamento; se não vier no prazo, envia sem ele (não trava a compra).
- Enviar sempre o header `X-meli-session-id` em toda cobrança de crédito via Mercado Pago.

Auditoria: consultar via API do MP os últimos pagamentos de cartão e verificar presença do device id; medir % de pagamentos com o campo preenchido antes/depois.

---

## Etapa 3 — Enriquecer o payload do pagamento (additional_info)

Problema: faltam campos que o MP usa para score antifraude e para pontuar a qualidade da integração.

Passar a enviar, quando existirem:
- `payer`: nome, sobrenome, e-mail, CPF, telefone (DDD + número), endereço.
- `additional_info.items`: id, título, quantidade, preço unitário, categoria.
- `additional_info.shipments.receiver_address`: CEP, rua, número, bairro, cidade, estado.
- `description` e `statement_descriptor` padronizados com a marca.

Auditoria: comparar payload enviado x pagamento retornado pela API do MP em uma venda real de cada canal (live, loja, área de membros) e listar campos ainda vazios.

---

## Etapa 4 — Identificação da integração

- Enviar os headers de identificação de integração em todas as chamadas de pagamento ao Mercado Pago (identificador de plataforma/integrador).
- Padronizar `external_reference` = id do pedido em 100% dos casos (hoje há chamadas sem esse campo).

Auditoria: varrer as funções de pagamento e confirmar que todas usam o mesmo cliente HTTP com headers padrão; conferir no MP que os pagamentos recentes têm `external_reference`.

---

## Etapa 5 — Centralizar o cliente Mercado Pago no backend

- Criar um módulo único compartilhado no backend que monta headers, idempotência e payload padrão de pagamento.
- Migrar as funções de cartão para usar esse módulo, uma por vez, sem alterar regra de negócio.
- (Opcional, avaliar no fim) usar o SDK oficial de backend em vez de chamadas diretas — só se não conflitar com o runtime das funções.

Auditoria: teste de fumaça em cada função migrada + comparação de um pagamento antes/depois para garantir payload equivalente.

---

## Etapa 6 — PCI: formulário de cartão (decisão à parte)

Hoje o número do cartão trafega pelas nossas funções por causa da cascata entre gateways — isso é o que mais pesa em compliance.

Opções a decidir depois das etapas 1–5:
- **A) Manter como está**: cascata total entre gateways, maior risco/escopo PCI.
- **B) Secure Fields do MP no cartão de crédito**: PAN nunca toca nosso servidor no fluxo MP; a cascata para outros gateways passa a exigir nova digitação ou fica restrita ao MP.
- **C) Híbrido**: Secure Fields quando o MP for o gateway prioritário e formulário atual como fallback.

Nenhuma mudança aqui sem sua aprovação explícita — é a única etapa que altera a experiência do cliente.

---

## Ordem sugerida

1 → 2 → 3 → 4 → 5, executando uma etapa por vez com auditoria entre elas. Etapa 6 só depois, como decisão de produto.

## Detalhes técnicos

- Arquivos envolvidos: `src/lib/mercadopago.ts`, `src/pages/StoreCheckout.tsx`, `src/pages/TransparentCheckout.tsx`, `src/components/checkout/PaymentSection.tsx`, área de membros, e as edge functions de cobrança por cartão.
- Nenhuma migração de banco é necessária nas etapas 1–4.
- Auditorias serão feitas consultando a API do Mercado Pago com o token da conta ativa e comparando com os registros de pedidos.
