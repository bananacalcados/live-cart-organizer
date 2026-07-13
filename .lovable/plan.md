## Contexto (o que já existe)

- **Fonte do cashback:** tabela `internal_cashback` neste projeto. Campos-chave: `coupon_code` (único, ex. `CB-XXXXXX`), `cashback_amount`, `min_purchase`, `expires_at` (validade já existe — padrão 60 dias via `pos_cashback_config.validity_days`), `is_used`, `used_at`, `used_sale_id`, `customer_phone/name/email`.
- **Uso na loja física:** `pos-validate-coupon` lê o cupom AO VIVO; ao concluir a venda o PDV faz `update is_used=true` (`POSSalesView.tsx`).
- **Canal com o outro projeto (site):** hoje o site chama Edge Functions nossas por HTTP (`event-lead-capture`, `link-page-capture-lead`) com `verify_jwt=false`. É o mesmo padrão que vamos usar — só que agora com um segredo compartilhado.

## Decisão de arquitetura: fonte única da verdade

Este projeto (PDV) continua sendo o **dono** do cashback. O site **não** guarda cópia do saldo — ele apenas **valida** e **resgata** contra nós, ao vivo, via Edge Function.

Por que este modelo atende exatamente suas 3 regras:
- ✅ **Usável no site:** o site consulta nosso endpoint e aplica o desconto.
- ✅ **Validade garantida:** `expires_at` já existe e é checado em toda validação.
- ✅ **Cancelamento automático se usado na loja física:** como o site lê o MESMO registro, no instante em que `is_used=true` é gravado (por venda física OU pelo site), o cupom fica inválido para todos. Não precisa "sincronizar cancelamento" — ele é intrínseco à fonte única.

```text
  LOJA FÍSICA (PDV)                       SITE (outro projeto Lovable)
  ────────────────                        ────────────────────────────
  pos-validate-coupon ─┐                 ┌─ chama  cashback-external (validate)
  venda: is_used=true ─┤                 ├─ checkout: is_used=true (redeem)
                       ▼                 ▼
             ┌──────────────────────────────────────┐
             │   internal_cashback  (fonte única)    │
             │   expires_at · is_used · used_*        │
             └──────────────────────────────────────┘
```

## O que vou construir NESTE projeto

1. **Segredo compartilhado** `CASHBACK_INTEGRATION_SECRET` (gerado). Os dois projetos usam o mesmo valor. Toda chamada do site envia no header `x-integration-secret`.

2. **Edge Function nova `cashback-external`** (`verify_jwt=false`), com 2 ações:
   - `action: "validate"` — recebe `{ coupon_code, subtotal }`. Retorna `{ valid, discount, min_purchase, expires_at, error }`. Checa: existe? não usado? não expirado? subtotal ≥ min_purchase?
   - `action: "redeem"` — resgate **atômico** ao fechar o pedido no site. Recebe `{ coupon_code, site_order_ref }`.

3. **RPC atômica `redeem_internal_cashback(code, order_ref)`** — faz `UPDATE ... SET is_used=true WHERE coupon_code=code AND is_used=false AND expires_at>now()` e retorna se conseguiu. Isso evita **double-spend** (mesmo cupom usado no site e na loja ao mesmo tempo) — só o primeiro ganha. Também amplio `used_sale_id`/origem para registrar que foi resgatado no site (novo campo `used_channel` = `physical|site` e `used_external_ref`).

4. **Ajuste de segurança:** hoje `internal_cashback` tem policy aberta a `authenticated`. Não muda; o site acessa só via Edge Function com service role + segredo, nunca direto na tabela.

5. **(Opcional, se você quiser exibir saldo no site sem digitar código):** endpoint `list-by-phone` para o site mostrar "você tem R$ X de cashback" a partir do telefone/login do cliente. Digo na entrega se vale a pena.

## Passo a passo que VOCÊ fará no outro projeto (site)

1. **Guardar o segredo:** adicionar em Secrets do site a variável `CASHBACK_INTEGRATION_SECRET` com o MESMO valor que eu gerar aqui (eu te passo o valor / você cola nos dois).
2. **Guardar a URL da nossa função:** `https://<nosso-projeto>.supabase.co/functions/v1/cashback-external` (eu te entrego a URL exata).
3. **No checkout do site:** no campo "cupom", ao aplicar, chamar nossa função com `action:"validate"` + `coupon_code` + `subtotal`, enviando o header `x-integration-secret`. Se `valid=true`, aplicar `discount` no total e mostrar a validade.
4. **Ao confirmar/pagar o pedido:** chamar de novo com `action:"redeem"` + `coupon_code` + a referência do pedido do site. Só concluir o pedido com desconto se o `redeem` retornar sucesso (se outro canal usou nesse meio-tempo, ele volta inválido e você impede o desconto).
5. **Tratamento de erro:** exibir mensagens de `error` (expirado / já utilizado / mínimo não atingido / não encontrado).
6. Me confirmar se o site tem cadastro por telefone/CPF (define se implemento o item opcional 5 acima).

## Detalhes técnicos

- Auth entre projetos: header `x-integration-secret` comparado a `CASHBACK_INTEGRATION_SECRET` (rejeita 401 se divergir). CORS liberado só para POST.
- Idempotência do redeem: a RPC com `WHERE is_used=false` é a trava; chamadas repetidas do mesmo pedido retornam "já utilizado" sem efeito colateral. Registro de `used_external_ref` permite reconciliar.
- Sem cópia de dados no site = zero risco de saldo dessincronizado; cancelamento por uso físico é imediato.
- Migração: adiciono colunas `used_channel text` e `used_external_ref text` em `internal_cashback` + a RPC. Atualizo o PDV para gravar `used_channel='physical'` no resgate atual.

## Entregáveis quando você aprovar
- Migração (colunas + RPC atômica).
- Edge Function `cashback-external`.
- Ajuste no `POSSalesView.tsx` para marcar `used_channel='physical'`.
- Geração do `CASHBACK_INTEGRATION_SECRET` + a URL e um trecho de código pronto para você colar no site.