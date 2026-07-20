
# Boleto Mercado Pago sob demanda (vendedor → cliente)

## Investigação (resumo)

**API Mercado Pago — Boleto (POST /v1/payments)**
- `payment_method_id: "bolbradesco"` (Bradesco) — mais aceito. Alternativas: `"pec"` (Pagamento em Lotérica).
- Campos: `transaction_amount`, `description`, `payer` (email, first_name, last_name, `identification { type:"CPF", number }`, `address { zip_code, street_name, street_number, neighborhood, city, federal_unit }`), `date_of_expiration` (ISO 8601 com timezone, ex.: `2026-07-25T23:59:59.000-03:00`), `external_reference`, `notification_url`, `X-Idempotency-Key`.
- Resposta: `id`, `status`, `transaction_details.external_resource_url` (PDF do boleto no MP), `barcode.content` (linha digitável). **Não existe PIX embutido no boleto (BR Code híbrido)** na API pública do MP — é possível **gerar um PIX separado com o mesmo valor/expiração** e anexar o QR ao PDF; é o padrão que a maioria dos bancos faz hoje.
- Vencimento: mínimo D+1, máximo até 30 dias. Padrão sugerido: 3 dias úteis.

**Estado atual no projeto**
- `mercadopago-create-boleto` já existe mas está **órfã** (sem UI) e **não envia `payer.address`** — vamos corrigir.
- Public checkout **não expõe boleto** hoje (verificado em `src/`) — nada a esconder.
- `payment-webhook` (gateway=mercadopago) confirma qualquer pagamento com `status === "approved"`, **incluindo boleto**. Reutiliza `notifyPaymentConfirmed` → já dispara o modal "pagamento realizado" via `pixNotificationStore` / `payment-confirmed-hook`. Só precisamos garantir que o `mercadopago_payment_id` do boleto seja gravado no `pos_sale` correto para o webhook casar.

## Plano de implementação

### 1. Banco
Nova tabela `pos_boletos` (auditável, separada de `pos_sales` p/ não misturar fluxos):
- `id`, `store_id`, `seller_id`, `created_by` (auth uid)
- `customer_name`, `customer_cpf`, `customer_email`, `customer_phone`
- `address_zip, address_street, address_number, address_complement, address_neighborhood, address_city, address_state`
- `amount`, `description`, `due_date`
- `mp_account_id`, `mp_payment_id`, `mp_boleto_url`, `mp_barcode`
- `mp_pix_payment_id`, `mp_pix_qr_code`, `mp_pix_qr_base64` (PIX gêmeo opcional)
- `pdf_url` (storage), `status` (`pending|paid|expired|cancelled`), `paid_at`
- Trigger `updated_at`. RLS: `authenticated` full, `service_role` all.
- Bucket storage `boletos` (privado, signed URL).

### 2. Edge functions
**a) Reescrever `mercadopago-create-boleto`:**
- Validar payload (zod): nome, CPF, email, endereço completo, valor > 0, vencimento.
- Enviar `payer.address` (regra 6 do usuário).
- Chamar MP `/v1/payments` boleto + (opcional) segundo `/v1/payments` PIX com mesmo `external_reference` p/ QR code híbrido.
- Gerar PDF (pdf-lib) com: dados do cliente, valor, vencimento, código de barras (renderizado), link para o boleto oficial MP, QR PIX (se gerado), instruções.
- Upload no bucket `boletos`; retornar `signedUrl` (7 dias) + `mp_payment_id`.
- Inserir em `pos_boletos`.

**b) `pos-boleto-send-whatsapp`** (nova): envia PDF pelo chat da conversa atual (usa provider real da instância — mesmo padrão de `catalog-checkout-provider-aware-send`).

**c) `payment-webhook` (mercadopago):** adicionar lookup complementar — se `external_reference` casar com `pos_boletos.id`, atualizar status para `paid` e disparar `notifyPaymentConfirmed` com contexto do boleto (o modal já existe). Boletos **não** criam venda automática; vendedor decide depois.

### 3. Frontend — Chat PDV
Novo botão **"Gerar Boleto"** no composer do chat PDV (`src/components/chat/` — junto com `ChatPixButton`). Abre `GenerateBoletoDialog`:
- Form: cliente (auto-preenche via `useUnifiedCustomer` pelo telefone da conversa), CPF, email, endereço completo (CEP com autofill via `viacep`), valor, descrição, vencimento (padrão D+3 útil), checkbox "Incluir QR Code PIX".
- Botão "Gerar" → chama edge function → mostra preview do PDF + botões **"Baixar"** e **"Enviar no WhatsApp"**.
- Ao enviar, registra mensagem outgoing na conversa.

### 4. Regras de negócio (do usuário)
1. **Nunca** expor boleto no checkout público — nenhum arquivo do checkout será tocado; boleto vive só no chat PDV.
2. Somente vendedor autenticado gera (RLS + `created_by`).
3. PDF gerado via pdf-lib no edge (fonte DejaVu p/ acentos), armazenado em bucket privado.
4. PIX híbrido: gerado como pagamento MP separado — se cliente pagar por PIX, webhook casa pelo `pos_pix_payment_id`; se por boleto, casa pelo `mp_payment_id`. Ambos caem no mesmo `pos_boletos` via `external_reference`.
5. Modal de confirmação de pagamento já funciona (`notifyPaymentConfirmed`) — só adicionamos payload de origem "boleto".
6. `payer.address` **enviado** no request MP.

## Tecnicidades

- Idempotência: `X-Idempotency-Key = boleto-${pos_boletos.id}`.
- `notification_url = ${SUPABASE_URL}/functions/v1/payment-webhook?gateway=mercadopago`.
- `external_reference = "boleto:${pos_boletos.id}"` (prefixo p/ o webhook distinguir de vendas/pedidos).
- Vencimento: mínimo hoje+1 (validação client + server).
- Fontes PDF: reuso do padrão DejaVu já usado em outros PDFs.
- Testes: `supabase--curl_edge_functions` para gerar boleto sandbox, simular webhook `approved`, validar update em `pos_boletos` e disparo do modal.

## Não faremos
- Não mexemos em checkout público, LP, typebot, links de pagamento.
- Não criamos venda automática ao pagar boleto (vendedor decide fluxo).
- Não alteramos gateway cascade nem PIX existente.

Aprova pra eu implementar?
