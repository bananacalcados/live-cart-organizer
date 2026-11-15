# Mercado Pago — colunas ampliadas da Varejo (15/11/2026)

## Resultado

Escopo restrito à conta Varejo Calçados; MATTHEWS PF não foi consultada nem alterada. Nenhuma operação financeira foi criada ou alterada. Foram gerados somente os relatórios de outubro/2026.

- Liberações: 15 → 60 colunas. Foram aceitas 45 das 46 adições documentadas; `IS_RELEASED` foi recusada com HTTP 400 `invalid_columns`.
- Dinheiro em conta: 14 → 67 colunas; todas as adições foram aceitas.
- Agendamento permaneceu desligado; prefixos, separador `;`, fuso `GMT-03`, frequência e demais opções existentes foram preservados. O MP materializou os padrões `execute_after_withdrawal=false` e `include_withdrawal_at_end=false` em Liberações.
- Configuração ampliada mantida porque melhorou a identificação.

## Comparação dos 131 payouts de outubro

Os mesmos 131 `SOURCE_ID` foram encontrados nos relatórios original e ampliado, totalizando R$ 169.316,66.

| Evidência | Antes | Depois |
|---|---:|---:|
| Conta de destino | 0 (0%) | 131 (100%) |
| Referência externa | 0 (0%) | 40 (30,5%) |
| Nome do favorecido ou banco | 0 | 0 |

Há 83 contas de destino distintas. Conta de destino não equivale a nome do favorecido; documentos e chaves permanecem mascarados nos exemplos apresentados ao solicitante.

## Boletos e movimentação interna

- 20 linhas `Bill Payments`/`Bill Payments - Agenda`: todas passaram a ter `EXTERNAL_REFERENCE`; nenhuma trouxe beneficiário, `ISSUER_NAME`, `POI_BANK_NAME`, descrição ou `PAY_BANK_TRANSFER_ID`. A referência ajuda a conciliar, mas não comprova o beneficiário.
- 7 linhas `Intra MP`: continuam sem referência, descrição ou transferência vinculada. A classificação de segmento já existia; as novas colunas não esclareceram o destino da movimentação interna.

## Auditoria preservada

Foram acrescentadas 4.416 linhas em `audit_mp_movements_tmp` com `account='Varejo Calçados (colunas ampliadas)'`: 2.958 de Liberações e 1.458 de Dinheiro em conta. As 14.177 linhas anteriores foram preservadas. A tabela continua service-only, sem política pública.

Arquivos de outubro:
- `reserve-release-3420522630-manual-2026-11-15-133344.csv`
- `relatorio-julho-manual-2026-11-15-123316.csv`

## Configuração original para restauração

```json
{
  "release": {
    "file_name_prefix": "release-3420522630",
    "show_placeholder_payout": false,
    "display_timezone": "GMT-03",
    "report_language": "pt",
    "scheduled": false,
    "columns": [
      {"key":"DATE"},{"key":"TRANSACTION_APPROVAL_DATE"},{"key":"SOURCE_ID"},{"key":"DESCRIPTION"},
      {"key":"NET_CREDIT_AMOUNT"},{"key":"NET_DEBIT_AMOUNT"},{"key":"GROSS_AMOUNT"},{"key":"MP_FEE_AMOUNT"},
      {"key":"TAXES_AMOUNT"},{"key":"PAYMENT_METHOD"},{"key":"BUSINESS_UNIT"},{"key":"SUB_UNIT"},
      {"key":"BALANCE_AMOUNT"},{"key":"PAYMENT_METHOD_TYPE"},{"key":"PURCHASE_ID"}
    ],
    "compensate_detail": false,
    "check_available_balance": false,
    "separator": ";",
    "frequency": {"hour":0,"type":"daily","value":"","format":"CSV"}
  },
  "settlement": {
    "include_withdraw": false,
    "file_name_prefix": "relatorio-julho",
    "scheduled": false,
    "columns": [
      {"key":"TRANSACTION_DATE","alias":""},{"key":"SETTLEMENT_DATE","alias":""},{"key":"SOURCE_ID","alias":""},
      {"key":"TRANSACTION_TYPE","alias":""},{"key":"SETTLEMENT_NET_AMOUNT","alias":""},{"key":"IS_RELEASED","alias":""},
      {"key":"PAYMENT_METHOD_TYPE","alias":""},{"key":"PAYMENT_METHOD","alias":""},{"key":"TRANSACTION_AMOUNT","alias":""},
      {"key":"FEE_AMOUNT","alias":""},{"key":"REAL_AMOUNT","alias":""},{"key":"METADATA","alias":""},
      {"key":"DESCRIPTION","alias":""},{"key":"SEGMENT_DETAIL","alias":""}
    ],
    "file_config": {
      "file_name_config":{"custom_prefix_filename":"relatorio-julho"},
      "compression_config":{"file_name_config":{"custom_prefix_filename":"relatorio-julho"},"enabled":false}
    },
    "shipping_detail": false,
    "separator": ";",
    "frequency": {"format":"CSV","hour":0,"type":"daily","value":null},
    "display_timezone": "GMT-03",
    "custom_values_unquote": false,
    "data_processed": false,
    "show_cashback_origin_payment": false
  }
}
```

Fontes oficiais:
- https://www.mercadopago.com.br/developers/pt/docs/reports/released-money/report-fields
- https://www.mercadopago.com.br/developers/pt/docs/reports/released-money/api
- https://www.mercadopago.com.br/developers/pt/docs/reports/account-money/report-fields
- https://www.mercadopago.com.br/developers/pt/docs/reports/account-money/api
