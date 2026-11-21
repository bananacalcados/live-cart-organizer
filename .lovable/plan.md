# Auditoria: quem grava o saldo de estoque das lojas (somente leitura)

Nada foi alterado. Este documento lista o que foi encontrado e propõe as próximas correções, que só serão feitas se você aprovar.

## Risco ALTO — pode trocar contagem física por número antigo

| Botão / tela | Onde | Tipo | De onde vem o número | Registra no histórico de ajustes? |
|---|---|---|---|---|
| "Corrigir Estoque" (contagem em revisão, tela Inventário) | Inventory.tsx 1927-1965 → inventory-correct-stock 448-495 | Substitui | Quantidade contada salva na contagem antiga | Sim, "Balanço de estoque - correção automática (local)" |
| Retomar/repetir correção com falha | Inventory.tsx 1180-1219 | Substitui | Mesma contagem antiga | Sim |
| "Salvar e corrigir bipados" / finalizar Balanço Inteligente | Inventory.tsx 1061-1114, 1773-1778, 2200-2228 | Substitui (final zera irmãos não bipados) | Bipagem acumulada | Sim |
| "Sincronizar Agora" / "Sincronizar Tiny" (Config do PDV) | POSConfig.tsx → pos-tiny-sync-products 131-156 | Substitui por 0 nas linhas já existentes | Fixo 0 | Só pela proteção automática (nem sempre) |
| "Atualizar Estoque" (Expedição antiga e Beta) | ExpeditionPickingList.tsx 264/655, BetaPickingList.tsx 190/387 → expedition-check-stock 75-125 | Substitui | Saldo do Tiny | Só pela proteção automática |
| "Corrigir" / "Corrigir Estoque (Balanço)" (Expedição Beta) | StockCorrectionDialog.tsx → expedition-correct-stock 69-94 | Substitui (todas as linhas do SKU na loja) | Número digitado | Só pela proteção automática |
| Transferência na embalagem / vendas online | ExpeditionPackingStation.tsx 200, POSOnlineSales.tsx 540 → expedition-transfer-stock | Lê e regrava (soma/subtrai) | Saldo local, sem trava | Só pela proteção automática |
| "Movimentar estoque" e "Balanço de todas as lojas" (Catálogo Unificado) | UnifiedProductsList.tsx 1337-1392, MultiStoreBalanceDialog.tsx 47-72 → pos-stock-movement | Balanço substitui; entrada soma (lê e regrava, sem trava) | Digitado na tela (pode estar velho) | Sim, motivo digitado ou "Balanço multi-loja" |
| "Ajustar estoque" (Expedição) | ExpStockAdjustDialog.tsx 89-109 | Igual acima | Digitado | Sim |
| Troca do site — zerar produto sem estoque | pos-site-exchange-finalize 218-245 | Substitui por 0 | Decisão tomada na troca | Sim |

## Risco ALTO — infla saldo se repetir

| Botão / tela | Onde | Tipo | Origem | Histórico |
|---|---|---|---|---|
| Cadastro de produto novo (formulário do produto, envio ao PDV com estoque das variações) | ProductMasterForm.tsx 286-287 → create-master-product-pos 124-175 | Soma o estoque inicial ao saldo atual se a linha já existe | Estoque inicial do cadastro / nota | Não grava explícito |
| Vincular itens da nota ao produto | NfeDetailEditor.tsx 240/266 → nfe-link-items-pos 144-208 | Soma a quantidade da nota | Nota fiscal | Não grava explícito |
| "Entrada por grade" | GradeStockEntryDialog.tsx 288-387 | Soma | Digitado | Sim, "Entrada por grade" |
| Trocas do PDV antigas | POSExchanges.tsx 316 → pos-exchange-stock-adjust | Soma/subtrai sem trava | Itens da troca | Só proteção automática |
| Venda/cancelamento PDV via Tiny | pos-tiny-create-sale 376-390, pos-tiny-delete-sale 118-137 | Subtrai/soma além da baixa automática do banco | Itens da venda | Só proteção automática — possível baixa dupla, precisa confirmar |

## Risco MÉDIO / BAIXO

- Tela de estoque do produto e "Confirmar Balanço" do PDV (pos-stock-balance com as funções seguras de balanço/movimento): médio, depende das funções do banco, que não estão no código salvo.
- Etiquetas ("Imprimir + Balanço" / "Imprimir + Adicionar"): regra fica no banco, não conferida aqui.
- Edição do estoque no formulário do produto/variação (ProductEditDialog.tsx 434-477): NÃO grava o saldo das lojas, só o estoque inicial do cadastro. Baixo direto, mas esse número antigo é depois usado pelo cadastro/envio (acima).
- Novas variações (pos-add-variants) e clonar produto para loja: só criam linha nova; numeração existente não é tocada. Baixo.
- Edição inline nas listas: só altera SKU, código, preço e custo; não mexe em saldo.
- Shopify: nenhum caminho traz estoque da Shopify para o ERP. Todos vão ERP → Shopify.

## Pontos de atenção pedidos

1. **Contagem da Loja Centro em revisão desde 01/07:** "Corrigir Estoque" (e "Repetir/retomar correção") gravaria por cima do saldo atual as quantidades contadas em julho, sem comparar com vendas, entradas ou contagens posteriores. "Re-verificar saldos" só lê. Isso apagaria a contagem física recente da Centro.
2. **"Enviar produto pro PDV" no Legacy:** correção do que eu disse antes — esse botão NÃO usa o estoque das variações; linhas novas nascem com 0 e as existentes não mudam de saldo. O caminho que soma de novo é o cadastro de produto novo pelo formulário.
3. **Edição no formulário do produto:** muda só o estoque inicial do cadastro, não o saldo das lojas.
4. **Edição inline nas listas:** não grava saldo.

## Correções propostas (precisam da sua aprovação, uma a uma)

1. Bloquear "Corrigir Estoque" em contagem com mais de 48h, ou exigir re-verificação e mostrar anterior → contado antes de aplicar; arquivar a contagem da Centro de julho sem aplicar.
2. Tirar a gravação de saldo do "Sincronizar Tiny" e do "Atualizar Estoque" da Expedição (só leitura do Tiny).
3. Cadastro de produto novo e vínculo de nota: dar entrada só uma vez por nota/item (chave de entrada), nunca somar de novo em numeração existente.
4. Passar os ajustes manuais restantes (Catálogo Unificado, Expedição, troca antiga) para as funções seguras de balanço/movimento.
5. Conferir no banco as funções de etiqueta, balanço e transferência, e a possível baixa dupla da venda via Tiny.

## Limites desta auditoria

- Funções do banco de balanço, movimento, etiquetas e transferência não estão no código salvo; não deu para garantir trava e histórico delas.
- Nada foi rodado contra o banco.
