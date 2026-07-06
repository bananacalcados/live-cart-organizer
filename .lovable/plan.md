# Plano — Módulo Fiscal (Relatórios + Sintegra)

## Objetivo
Adicionar uma aba **Fiscal** no Dashboard Geral do frente de caixa com:
1. Relatório de **vendas** (saídas) por CNPJ, separado por NF-e (mod. 55) e NFC-e (mod. 65).
2. Relatório de **entradas** por CNPJ (notas de mercadoria puxadas do módulo Estoque).
3. Geração do arquivo **Sintegra** no padrão fiscal, com formulário para dados da empresa/responsável.
4. Exportação em **CSV/Excel** de todos os relatórios.

Tudo somente de **leitura** sobre dados já existentes — nada na emissão, no estoque ou no banco é alterado.

## O que já temos (fontes de dados)
- **Saídas:** `fiscal_documents` (721 notas autorizadas). Cabeçalho completo em todas (empresa, modelo, série, número, chave, valor, data, CPF/nome destinatário). XML por item em ~367.
- **Entradas:** `purchase_invoices` + `purchase_invoice_items` (fornecedor, CNPJ, NCM, CFOP, quantidade, custo) — importadas pelo módulo Estoque.
- **Empresa:** `companies` (CNPJ, IE, endereço, regime, CRT, CNAE, cidade IBGE).

## Pontos de atenção (limitações honestas)
1. **Notas de prestadores de serviço (NFS-e):** não existem em nenhum módulo hoje. O relatório de entradas cobrirá as notas de **mercadoria** de `purchase_invoices`. Para incluir serviço, seria preciso uma fonte (importação manual ou uso do módulo de manifestação, hoje vazio) — fica fora desta entrega, mas o relatório é preparado para receber essa fonte no futuro.
2. **Sintegra por item (registros 54/75):** dependem do XML. ~354 vendas não têm XML salvo. Solução: usar o `fiscal-backfill-danfe` para recuperar XML sob demanda antes de gerar o Sintegra, e sinalizar quais notas ficaram sem detalhe.
3. **Cadastro de empresa incompleto:** 2 das 3 empresas estão sem IE/endereço. O gerador do Sintegra exige esses campos, então haverá validação + formulário de complemento antes de gerar.

## Fase 1 — Relatórios (entrega imediata)

### 1.1 Nova aba "Fiscal"
- Em `POSGeneralDashboard.tsx`, adicionar `"fiscal"` ao estado `view` e ao array de tabs (`Visão Geral | Folha | Fiscal`).
- Renderizar novo componente `POSFiscalTab` recebendo o `periodRange` já existente (reaproveita o seletor de período do dashboard).
- Proteção por senha, igual à aba Folha (fiscal é sensível).

### 1.2 Componente `POSFiscalTab.tsx`
Filtros: **empresa (CNPJ)**, **período** e **modelo** (NF-e / NFC-e / ambos).

Sub-seção **Vendas (saídas)**:
- Consulta `fiscal_documents` por `company_id` + `data_autorizacao` no período, status autorizado.
- Agrupa por CNPJ e por modelo, exibindo: quantidade de notas, valor total, ticket médio, canceladas.
- Tabela detalhada (data, modelo, série/número, chave, destinatário, valor, status).

Sub-seção **Entradas**:
- Consulta `purchase_invoices` por `emission_date` no período.
- Agrupa por `supplier_cnpj`: quantidade de notas, valor total, total de produtos/impostos.
- Tabela detalhada (data, fornecedor, CNPJ, número/série, chave, valor).

### 1.3 Exportação CSV/Excel
- Função utilitária `src/lib/fiscal/exportFiscalReport.ts` gera CSV (UTF-8 com BOM) para cada relatório.
- Botões "Exportar CSV" em cada sub-seção.

## Fase 2 — Arquivo Sintegra

### 2.1 Formulário de geração
Dialog `SintegraExportDialog.tsx`:
- Seleção de **empresa (CNPJ)** e **período (mês/ano)**.
- Campos da empresa pré-preenchidos de `companies`, editáveis, com validação obrigatória: razão social, CNPJ, IE, endereço completo, cidade/IBGE, UF, CEP.
- Campos do **responsável** (nome, telefone/e-mail) e **finalidade** do arquivo (normal/retificação) e natureza das operações.

### 2.2 Geração do arquivo (`src/lib/fiscal/sintegra.ts`)
Monta o `.txt` de largura fixa (Convênio ICMS 57/95):
- **Registro 10** — mestre do estabelecimento (CNPJ, IE, nome, município, UF, período, códigos de convenência/natureza/finalidade).
- **Registro 11** — dados complementares (endereço, responsável).
- **Registro 50** — cabeçalho das **NF-e (mod. 55)** de saída: CNPJ/IE destinatário, data, modelo, série, número, CFOP, valor, base ICMS, situação.
- **Registro 54** — itens das NF-e (do XML): NCM, CFOP, quantidade, valor, base/valor ICMS.
- **Registro 75** — cadastro de produtos/serviços referenciados nos 54.
- **Registro 60 (60M/60A/60D)** — resumo das **NFC-e (mod. 65)** por dia/equipamento/alíquota (modelo de cupom fiscal).
- **Registro 90** — totalização e controle.
- Também emitir registros 50/54 para as **entradas** (`purchase_invoices` + itens) quando a empresa for destinatária.
- Codificação e quebras de linha conforme padrão (ASCII, CRLF).

### 2.3 Onde roda
- Geração **client-side** (arquivo texto puro, sem dependências pesadas), com download direto.
- Antes de gerar, chamar `fiscal-backfill-danfe` para notas sem XML e listar as que não puderam ser detalhadas (aviso ao usuário para não gerar arquivo incompleto sem saber).

### 2.4 Validação
- Bloquear geração se faltar IE/endereço/IBGE da empresa.
- Relatório de conferência na tela (totais por registro) antes do download, para comparar com a contabilidade.

## Arquivos afetados
- `src/components/pos/POSGeneralDashboard.tsx` — adiciona aba (edição pontual).
- `src/components/pos/POSFiscalTab.tsx` — novo.
- `src/components/fiscal/SintegraExportDialog.tsx` — novo.
- `src/lib/fiscal/sintegra.ts` — novo (montagem do arquivo).
- `src/lib/fiscal/exportFiscalReport.ts` — novo (CSV/Excel).

Nenhuma migração de banco é necessária. Nenhuma função de emissão é tocada.

## Sugestão de execução
Entregar a **Fase 1** primeiro (relatórios + CSV), validar os números com sua contabilidade, e em seguida a **Fase 2** (Sintegra), que é a parte mais sensível e precisa de conferência campo a campo com um contador antes de valer para o fisco.

## Recomendação importante
O layout exato do Sintegra tem variações por estado (MG, no seu caso). Antes de considerar o arquivo "oficial", ele deve ser validado no **validador Sintegra da SEFAZ/MG** e conferido por seu contador. O gerador seguirá o padrão nacional 57/95, mas a homologação final é contábil.
