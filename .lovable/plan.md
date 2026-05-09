## Melhorias na aba de Vendas (PDV)

Vou implementar 6 mudanças no módulo de Vendas do PDV. Como são alterações grandes e interligadas em `POSSalesView.tsx` (2097 linhas), preciso do seu OK no plano antes de implementar.

---

### 1. Venda Presencial × Online (NFC-e × NF-e)

**Fluxo novo após selecionar o vendedor:**
- Abre um segundo modal: **"Tipo de venda"** com 2 opções grandes:
  - 🏬 **Presencial** → NFC-e (fluxo atual)
  - 🚚 **Online (entrega/envio)** → NF-e + envia pra aba **Envios**
- A escolha fica salva no estado da venda (`saleType: 'presencial' | 'online'`).

**Quando for Online:**
- Etapa **Cliente** passa a exigir endereço completo (CEP, rua, número, bairro, cidade, UF) — hoje é opcional pra presencial.
- Etapa **Nota Fiscal** dispara `nfe-emitir` (NF-e modelo 55) em vez de `nfce-emitir` (modelo 65).
- Ao finalizar: cria registro em `pos_shipments` (ou tabela equivalente da aba Envios) com status `aguardando_despacho`, vinculando o `sale_id` e o número da NF-e.
- Não imprime cupom; mostra DANFE da NF-e pra impressão A4.

**Indicação visual:** badge no topo da venda mostrando "Presencial" (laranja) ou "Online" (azul) durante todo o fluxo.

---

### 2. Conferência de produtos logo após bipar (não na etapa 3)

**Hoje:** bipar adiciona o produto direto; conferência (pés/defeitos) só aparece na etapa 3 num bloco confuso.

**Mudança:** logo após bipar/selecionar um produto, abre um **mini-popover inline no card** do produto adicionado, com:
- ✅ Par completo? (Sim / Falta 1 pé / Falta 2 pés)
- 🔍 Tem defeito visível? (Não / Sim → campo de observação)
- Botão "Confirmar e continuar"

A conferência fica registrada por item e aparece resumida na etapa 3 (e some o bloco grande atual). Se o operador ignorar, fica pendente e bloqueia avançar pra Pagamento.

---

### 3. Bug do scanner adicionando 2 pares

**Causa provável:** o leitor envia o código + Enter rápido demais; o handler está sendo disparado 2x (debounce ausente ou duplo binding).

**Correção:**
- Adicionar **debounce de 400ms** + **lock por código de barras** (Set com TTL de 1s) no `handleBarcodeScan`.
- Garantir que o input só processa o submit no `Enter`, não em cada `onChange` que termine com `\n`.
- Remover qualquer `onKeyDown` + `onKeyUp` duplicados.

---

### 4. Cashback/Prêmios visíveis na etapa Cliente + botão "Utilizar"

**Após localizar o cliente:**
- Buscar em `internal_cashback` (saldos ativos/não expirados) e `loyalty_rewards` (prêmios desbloqueados).
- Mostrar um card destacado: **"Saldo disponível: R$ X em cashback + Y prêmios"**.
- Botão **"Utilizar cashback"** → abate o valor no `discount_value` da venda (respeitando `compra_minima` configurada).
- Botão **"Resgatar prêmio"** → adiciona o prêmio como item de R$ 0,00 ao carrinho (ou desconto, dependendo do tipo).
- Ao usar, registra `cashback_redemption` e marca o saldo como consumido só quando a venda fecha.

---

### 5. Nomes de produtos truncados na etapa Pagamento

**Mudança simples:** na lista de itens da etapa Pagamento, trocar `truncate` por `whitespace-normal break-words` e dar `min-h` no card. Mostrar nome completo + variação (cor/tamanho) em 2 linhas se necessário.

---

### 6. Editar pedido na etapa Pagamento (sem voltar pra Produtos)

Adicionar na lista de itens da etapa Pagamento, em cada linha:
- **+ / −** pra ajustar quantidade
- **🗑️** pra remover item
- **✏️** pra editar preço unitário (abre input inline, com confirmação)

Recalcula subtotal/desconto/total automaticamente. Se a lista ficar vazia, volta automaticamente pra etapa Produtos.

---

### Detalhes técnicos

**Arquivos a editar:**
- `src/components/pos/POSSalesView.tsx` — fluxo principal, modal tipo de venda, edição na etapa Pagamento, debounce do scanner, conferência inline.
- `src/components/pos/POSCustomerForm.tsx` — endereço obrigatório quando online + card de cashback/prêmios.
- `src/components/pos/POSBarcodeScanner.tsx` — lock anti-duplicidade.
- `supabase/functions/nfe-emitir/index.ts` — já existe; só passar a usá-la pra vendas online (passar `modelo: 55`).
- Nova migração: coluna `sale_type` em `pos_sales` (`'presencial'` default), e tabela/coluna `pos_shipments` se ainda não existir pra integração com Envios.

**Banco:**
- `ALTER TABLE pos_sales ADD COLUMN sale_type text DEFAULT 'presencial' CHECK (sale_type IN ('presencial','online'))`.
- Confirmar se já existe a tabela de envios do PDV; se não, criar `pos_shipments` (sale_id, status, tracking, created_at).

**Riscos:**
- O `POSSalesView.tsx` é grande; vou quebrar a etapa Pagamento e a Cliente em subcomponentes pra não inflar mais o arquivo.
- Conferência inline muda UX — pode atrapalhar quem está acostumado. Sugiro manter um toggle nas Configurações do PDV: "Conferência inline ao bipar" (default ligado).

---

### Ordem de execução sugerida

1. Migração `sale_type` + criar tabela `pos_shipments` se faltar.
2. Modal tipo de venda + badge + roteamento NFC-e/NF-e.
3. Fix do scanner duplicado + conferência inline.
4. Cashback/prêmios na etapa Cliente.
5. Edição de itens + nomes completos na etapa Pagamento.

Posso seguir? Se quiser cortar/priorizar algum item, me diz antes.