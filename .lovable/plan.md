# Criar produtos e variações pelo celular (/m/estoque)

## 1. Como o computador faz hoje

**Produto novo** (Estoque > Legacy > Novo produto):
1. A tela confere: nome obrigatório, **loja do estoque inicial obrigatória**, ao menos 1 variação e toda variação com cor e tamanho. Tamanho só número (39, 34/35) ou PP/P/M/G/GG. Cor não pode ser só número.
2. Se a marca digitada for nova, ela entra no catálogo de marcas (num passo separado).
3. Uma única função do banco cria o pai e todas as variações de uma vez (tudo-ou-nada). Ela também:
   - confere a permissão (acesso ao Estoque ou admin);
   - gera o código do pai automaticamente;
   - gera o SKU de cada variação (código do pai + cor + tamanho, com -2, -3 se já existir);
   - gera um código de barras EAN-13 único (789…), conferido contra o cadastro e o PDV;
   - usa fiscal padrão (NCM 64039900, origem 0, UN).
4. Ao gravar cada variação, gatilhos que já existem:
   - criam o **código interno da etiqueta** (cor e tamanho);
   - ligam a cor e o tamanho ao dicionário;
   - limpam o preço da variação igual ao do pai;
   - levam mudanças de preço e nome ao PDV.
5. Depois, num **segundo passo separado**, uma função cria a linha no PDV para cada loja ativa. A loja escolhida recebe o estoque inicial (com registro de ajuste) e as outras ficam com zero. Também é feito o espelho no catálogo unificado.
   - Se esse passo falhar, o produto fica criado sem PDV, com aviso e o botão "Enviar ao PDV" para reenviar.
6. O gênero, se informado, é gravado num terceiro passo.

**Adicionar variação** (Editar produto):
- Cada variação nova é gravada uma a uma pela própria tela, que antes gera o SKU e o código de barras. Também dá para digitar SKU e código manualmente.
- Depois, outra função manda só as variações novas ao PDV, com estoque na loja escolhida.
- **Não é tudo-ou-nada:** se a internet cair no meio, parte das variações fica criada.

**Contra duplicidade:**
- O banco já impede repetir o mesmo código do pai, SKU ou código de barras, e repetir a mesma cor+tamanho no mesmo produto (escrita idêntica).
- **Nome repetido não é bloqueado:** dá para criar dois produtos com o mesmo nome.
- "Preto" e "preto " contam como diferentes (não há regra de maiúsculas e espaços).

**Shopify:** criar ou editar pelo computador **não publica nada** na Shopify. Só os botões manuais fazem isso.

## 2. Proposta para o celular

**"Novo produto"** (botão na tela inicial), em uma coluna:
1. Nome (com aviso de possível duplicado), categoria, marca, preço de venda e custo.
2. Cores: digitar ou escolher entre as já usadas.
3. Tamanhos: atalhos 33–39, 34–40, 35–40, PP–GG e Único, mais a marcação de cada tamanho.
4. Revisão: "Serão criadas N variações", com a lista.
5. Criar e abrir direto a ficha do produto (fotos e etiquetas já existem lá).

**"Adicionar cor / tamanho"** (na ficha):
- Mesma escolha de cores e tamanhos.
- Na revisão, as combinações que já existem aparecem marcadas e travadas; só as novas são criadas.

**Estoque inicial — recomendação: nascer com saldo ZERO.**
- O saldo entra pela contagem por etiquetas, que já existe, já confirma o saldo e já fica no histórico.
- Isso evita lançar estoque às cegas e evita a regra da "loja obrigatória" no celular.
- O produto ainda é criado no PDV em todas as lojas ativas (com zero), para poder vender e etiquetar.

**Aviso de duplicado:** ao digitar o nome, espera 400 ms e faz uma busca no servidor (até 5 nomes parecidos, com link para abrir). É só aviso, não bloqueia. Sem atualização automática.

**Quem pode:** a mesma regra do computador (acesso ao Estoque ou admin). O custo só aparece para quem já vê custo no computador.

**Tudo-ou-nada:**
- Criar uma função de servidor nova (aditiva) que, num só passo: chama a mesma função de criação do computador (ou, para variações, as mesmas geradoras de SKU e código), cria as linhas do PDV com saldo zero em todas as lojas ativas e registra a marca nova.
- Se algo falhar, nada fica gravado.
- Ela recebe um **código de pedido único**: se a internet cair e o celular reenviar, devolve o mesmo produto em vez de criar outro.
- O computador continua usando o caminho atual, sem mudança.

**Regras compartilhadas:** a validação de tamanho e cor e a montagem das grades saem do formulário do computador para um arquivo comum. Um teste prova que o computador aceita e recusa exatamente os mesmos valores, antes e depois.

## 3. Riscos e como ficam

- **Produto duplicado:** aviso por nome e código de reenvio. Nome igual continua permitido, como hoje.
- **Variação duplicada:** a trava do banco já existe. A revisão compara cor e tamanho sem diferenciar maiúsculas e espaços, e trava o que já existe.
- **Preço não chegar ao PDV:** as linhas do PDV são criadas no mesmo passo, com o preço do pai. A variação nasce sem preço próprio. Os gatilhos de preço continuam valendo.
- **Variação sem código de etiqueta:** o gatilho atual cria o código, mas engole erro. A função nova confere no fim e cancela tudo se faltar código.
- **Shopify:** nada é chamado.
- **Internet caindo:** tudo-ou-nada mais o código de reenvio.
- **Desempenho:** uma chamada ao criar e uma busca por nome com espera de digitação. Sem gatilho novo e sem atualização automática.

## 4. Detalhes técnicos

- **Migração aditiva:**
  - função `mobile_create_product(p_request_id uuid, p_master jsonb, p_variants jsonb)`;
  - função `mobile_add_variants(p_request_id, p_master_id, p_variants)`;
  - função `mobile_product_name_hints(p_term, p_limit ≤ 5)`;
  - tabela `mobile_product_requests` (request_id, user, master_id, criado em) para o reenvio, com RLS só Estoque e grants explícitos;
  - sem acesso para visitante sem login (anon), checagem de permissão em cada função;
  - as linhas do PDV são criadas na mesma transação, com a mesma montagem de nome/SKU/barcode/parent_sku das funções atuais (trazida para SQL e coberta por teste que compara o resultado com a função atual).
- **Arquivos novos:**
  - `src/lib/products/variantRules.ts` (validação e grades, com o formulário do computador passando a importar daqui);
  - `src/mobile/inventory/MobileNewProduct.tsx`, `MobileAddVariants.tsx` e `productCreate.ts`, mais testes.
- **Arquivos alterados:** `MobileInventoryApp.tsx` (botão e rotas) e `ProductMasterForm.tsx` (só o import das regras).
- **Testes:**
  - unitários das regras (antes e depois iguais);
  - SQL com desfazer no fim: criação completa, reenvio igual sem duplicar, variação já existente recusada, falha no meio desfaz tudo, código de etiqueta presente, linha do PDV em cada loja com saldo 0 e preço do pai, usuário sem Estoque recusado, nada na Shopify;
  - tela 390×844 simulada.
- **Não dá para testar:** criação real no banco de produção (só com desfazer), celular de verdade e queda real de internet (só simulada).

## 5. Perguntas para o Matthews

1. Saldo inicial sempre zero (entrada pela contagem de etiquetas) ou quer poder digitar saldo por loja na criação?
2. Nome igual deve só avisar (como hoje) ou bloquear?
3. Quais atalhos de grade quer (33–39, 34–40, 35–40, PP–GG, Único)? Falta algum?
4. No celular, mostrar campo de custo ou deixar só preço de venda?
