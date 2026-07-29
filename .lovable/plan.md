# Débito no Checkout — 3 opções de pagamento

Objetivo: adicionar **Débito** como terceira forma de pagamento no checkout transparente, ao lado de PIX (5% off) e Crédito, com detecção por BIN rodando em silêncio apenas como validação amigável.

Regras de produto:
- Três botões: **PIX (5% off)** · **Crédito** · **Débito**
- Débito é sempre 1x, sem seletor de parcelas, sem desconto PIX
- BIN detecta as funções do cartão em silêncio. Se o cliente escolheu Crédito e o cartão só tem débito (ou vice-versa), aparece um aviso inline com botão "Pagar no débito" que troca a aba. Nada de modal bloqueante.
- Cartão com as duas funções: respeita o botão escolhido, sem perguntar nada.
- Débito **só** pelo Mercado Pago. O fallback para Pagar.me/AppMax com cartão cru fica bloqueado nesse caminho, para não gerar cobrança duplicada ou recusa confusa.

---

## Etapa 1 — Camada de detecção (sem mudar UI)
Ampliar `src/lib/mercadopago.ts`:
- Nova função `getCardCapabilities(bin)` que retorna **todos** os métodos do BIN, classificando em `hasCredit` / `hasDebit` (hoje o código pega só `results[0]`, que é a raiz do problema).
- `tokenizeCardMP` passa a aceitar `mode: "credit" | "debit"` e escolhe o `payment_method_id` correspondente em vez do primeiro da lista.
- Cache simples por BIN para não consultar o SDK a cada tecla.

**Avaliação da etapa:** typecheck limpo + teste manual em navegador digitando um BIN de crédito e um de débito, conferindo no console que `hasCredit`/`hasDebit` e o `payment_method_id` escolhido saem corretos. Nenhuma mudança visível no checkout ainda — o fluxo de crédito atual precisa continuar idêntico.

## Etapa 2 — Backend: aceitar cobrança em débito
- `pagarme-create-charge` (que hoje concentra a cascata) passa a aceitar `paymentMode: "debit"`, forçando o caminho Mercado Pago com `installments: 1` e o `payment_method_id` de débito vindo do token, sem cair para outros gateways.
- Tratar a resposta de **3DS**: quando o MP devolver URL de autenticação, retornar essa URL para o front em vez de erro.
- `_shared/payment-method-sync.ts`: rotular corretamente "Cartão de Débito" (o normalizador já lê `payment_type_id`, falta só garantir a gravação do rótulo e do gateway).

**Avaliação da etapa:** deploy da function + chamada de teste direta com token de débito de sandbox, verificando status retornado, gravação em `orders`/`pos_sales` e rótulo "Cartão de Débito". Confirmar por uma chamada de crédito que o caminho antigo não regrediu.

## Etapa 3 — UI: terceiro botão e formulário de débito
Em `src/pages/TransparentCheckout.tsx`:
- `selectedMethod` passa de `"pix" | "card"` para `"pix" | "credit" | "debit"`.
- Terceiro botão **Débito** na lista de métodos, com o mesmo padrão visual dos existentes.
- Formulário de débito reaproveita os campos do cartão, **sem** o `Select` de parcelas, exibindo "à vista" e o valor total.
- Rótulos: PIX mantém "5% de desconto"; Débito mostra "à vista, sem desconto" para não gerar expectativa errada.

**Avaliação da etapa:** screenshot dos três botões em viewport mobile e desktop; conferir que ao escolher Débito o seletor de parcelas some e o valor exibido é o total cheio, e que PIX/Crédito continuam com o comportamento e os valores de hoje.

## Etapa 4 — Aviso cruzado por BIN
- Ao completar 6–8 dígitos, comparar a escolha do cliente com as capacidades do cartão.
- Divergência → alerta inline (não modal) acima do botão de pagar: *"Esse cartão é de débito — quer pagar no débito?"* com botão que troca a aba preservando os dados já digitados.
- Cartão com as duas funções → nenhum aviso.
- Enquanto o aviso de "só débito" estiver ativo na aba Crédito, o botão de pagar fica desabilitado, para o cliente não tomar recusa sem entender.

**Avaliação da etapa:** teste em navegador com três BINs (só crédito, só débito, múltiplo) confirmando: aviso correto em cada caso, troca de aba preservando número/nome/validade, e ausência total de aviso no cartão múltiplo.

## Etapa 5 — Rastreamento, 3DS e verificação final
- Eventos de pixel/CAPI com `content_category: "debit_card"` e o `payment_method_label` correto no Purchase.
- Fluxo de 3DS: redirecionar para o challenge do banco e voltar ao checkout tratando aprovado/recusado.
- Varredura final: confirmar que PIX e Crédito seguem idênticos ao comportamento atual (valores, desconto de 5%, parcelas, cascata de gateways) e que o débito não aparece em links que não devem aceitá-lo.

**Avaliação da etapa:** teste ponta a ponta das três formas de pagamento no preview, conferindo pedido gravado, rótulo do método, valor cobrado e ausência de erros no console e nos logs das functions.

---

## Detalhes técnicos
- Arquivos principais: `src/lib/mercadopago.ts`, `src/pages/TransparentCheckout.tsx`, `supabase/functions/pagarme-create-charge/index.ts`, `supabase/functions/_shared/payment-method-sync.ts`.
- `StoreCheckout.tsx` e `Checkout.tsx` ficam de fora nesta rodada — podemos replicar depois que o débito estiver validado em produção no checkout transparente.
- Sem migração de banco: os campos de método/gateway já existem.
- Ponto de maior risco: 3DS. Se o teste em sandbox mostrar comportamento instável, isolo o débito atrás de uma flag de configuração para ligar/desligar sem novo deploy.
