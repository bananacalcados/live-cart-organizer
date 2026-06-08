## Objetivo

Controlar todo o custo de entrega das vendas online (Live, Site, PDV Online) e da Expedição, vinculando cada corrida a um prestador (mototaxista ou transportadora). Acumular o que devemos a cada prestador de forma **universal** (somando Centro + Pérola + Expedição) e dar baixa pelo caixa, com saída de dinheiro e recibo consolidado para impressão, assinatura, digitalização e upload como prova.

## Como vai funcionar (visão do usuário)

1. **Cadastro de prestadores** — nova tela em PDV > Configurações com lista de prestadores: nome, telefone, tipo (mototaxista ou transportadora), CPF/CNPJ, dados pessoais, observação, ativo/inativo.
2. **Lançar o custo da entrega** — em dois momentos (como você escolheu):
   - **Na finalização da venda** (PDV Online / Live / Site): campo "Tipo de entrega" (mototaxista/transportadora) → ao escolher, abre a lista de prestadores daquele tipo → digita o valor.
   - **Na Expedição (no despacho)**: mesmo campo, para ajustar/confirmar ou lançar quando não foi feito na venda.
   - Cada lançamento vira uma "corrida/entrega" com status **A pagar**.
3. **Contas a pagar (universal)** — local na aba **Caixa** mostrando, por prestador, o total devido somando TODAS as lojas/módulos. Ex.: "Mototaxista João — R$ 240,00 a pagar (12 corridas: 7 Centro, 3 Pérola, 2 Expedição)".
4. **Dar baixa / pagar** — na hora da retirada no caixa aparece a opção **"Pagar prestador"**:
   - Seleciona o prestador → mostra o total pendente e a lista de corridas.
   - Pode pagar tudo ou marcar corridas específicas (pagamento parcial).
   - Ao confirmar: o valor **sai do caixa do PDV** (registra sangria) e as corridas viram **Pagas**.
   - A baixa pode ocorrer a qualquer momento, em qualquer loja — mesmo que as corridas tenham sido de outra loja/módulo (contas universais).
5. **Recibo consolidado** — gera um recibo único (PDF/impressão) com todas as corridas pagas, valor total, data e espaço para assinatura do prestador. Depois de assinado e escaneado, o arquivo é enviado de volta ao sistema e fica anexado ao pagamento como prova.
6. **Relatório por prestador** — quanto gastamos com cada um, por período, com cada corrida detalhada (data, valor, venda de origem, loja/módulo: Centro / Pérola / Expedição Beta) e status pago/pendente.

## Telas afetadas

- **PDV > Configurações**: nova seção "Prestadores de Serviço" (cadastro/edição).
- **PDV > Online / Live / Site (finalização de venda)**: campo tipo de entrega + prestador + valor.
- **Módulo Expedição (Beta e/ou clássico, no despacho)**: mesmo campo de entrega/prestador/valor.
- **PDV > Caixa**: nova aba/seção "Prestadores" com contas a pagar universais + botão "Pagar prestador" no fluxo de retirada + histórico de pagamentos e recibos.
- **Relatório de prestadores** (dentro da aba Caixa ou Gestão): gastos e corridas por prestador/período/loja.

## Detalhes técnicos

### Banco de dados (novas tabelas)

```text
service_providers            (prestadores, universal — sem amarrar a loja)
  - name, phone, document (cpf/cnpj), provider_type ('mototaxi' | 'transportadora')
  - notes, is_active

delivery_costs               (uma linha por corrida/entrega)
  - provider_id  -> service_providers
  - provider_type
  - amount (numeric)
  - source ('pos_centro' | 'pos_perola' | 'live' | 'site' | 'expedition_beta' | 'expedition')
  - store_id (nullable, loja de origem quando houver)
  - pos_sale_id (nullable)        -> pos_sales
  - expedition_order_id (nullable)
  - status ('pending' | 'paid')
  - payment_id (nullable)         -> provider_payments
  - created_at, updated_at

provider_payments            (a baixa / pagamento semanal)
  - provider_id -> service_providers
  - paid_store_id               (loja onde o pagamento saiu do caixa)
  - cash_register_id            (caixa que gerou a sangria)
  - total_amount
  - receipt_pdf_url (nullable)  (recibo gerado)
  - proof_file_url (nullable)   (recibo assinado/escaneado enviado depois)
  - paid_at, created_by, notes
```

- Cada `provider_payments` agrupa N `delivery_costs` (marca status='paid' e seta payment_id).
- Todas as tabelas no schema public com `GRANT` para authenticated/service_role + RLS.
- `total_amount` calculado pela soma das corridas selecionadas; trigger de `updated_at`.

### Saída do caixa

- Ao confirmar um `provider_payments`, inserir em `pos_cash_movements` (type `withdraw`) e somar em `pos_cash_registers.withdrawals`, reaproveitando exatamente a mesma lógica de sangria já existente em `POSCashRegister.tsx` (`handleMovement`), com `description` = "Pagamento prestador <nome>".

### Recibo

- Geração do recibo consolidado em PDF no front (mesma abordagem já usada para impressão no projeto), com cabeçalho Banana Calçados, lista de corridas, total, data e linha de assinatura.
- Upload do recibo assinado/escaneado para um bucket de storage (reaproveitar `payment-receipts` ou criar `provider-receipts`), gravando a URL em `proof_file_url`.

### Reaproveitamento

- O campo de tipo de entrega na finalização e na expedição usa a lista de `service_providers` filtrada por `provider_type`.
- `shipping_cost` já existe em `pos_sales` e `freight_price`/`total_shipping` na expedição — o custo do prestador é registrado em `delivery_costs` (separado, pois `shipping_cost` é o que o cliente paga; aqui é o que NÓS pagamos ao prestador).

## Fora do escopo (confirmar depois se quiser)

- Integração automática do custo de transportadora vindo da cotação Frenet (por enquanto o valor pago ao prestador é digitado/confirmado manualmente).
- Pagamento via PIX/transferência bancária automatizado (a baixa registra a saída; o pagamento em si continua manual).
