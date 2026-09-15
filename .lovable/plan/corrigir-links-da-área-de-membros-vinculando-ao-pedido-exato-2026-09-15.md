# Corrigir links da Área de Membros vinculando ao pedido exato

## Diagnóstico confirmado
- O link mostrado na conversa da Vania pertence ao telefone dela; Olga tem outro telefone e outro pedido.
- A falha está na arquitetura atual: o link guarda somente o telefone. Ao abrir, o sistema procura novamente “o pedido aberto mais recente” entre cadastros associados àquele telefone, em vez de abrir o pedido que originou o link. Duplicidades de cadastro, pedidos criados/editados quase ao mesmo tempo e sessões anteriores permitem selecionar um carrinho diferente.

## Correção
1. Gravar no link mágico o `order_id` exato quando o link for criado a partir de um pedido.
2. Ao resgatar o link, criar a sessão já vinculada a esse pedido.
3. Em todas as ações seguintes (carregar, atualizar, pagar), usar o pedido vinculado e validar no servidor que ele pertence ao mesmo telefone; nunca trocar silenciosamente por outro carrinho.
4. Atualizar todos os botões e envios da Live que já possuem pedido para emitirem o link com `order_id`.
5. Manter compatibilidade com links antigos e links gerais sem pedido: nesses casos, continuar buscando pelo telefone, mas sem reutilizar sessão anterior quando houver um novo link na URL.
6. Registrar e bloquear qualquer divergência entre telefone, link e pedido, em vez de exibir dados de outra cliente.

## Validação
- Confirmar Vania → pedido `8054739c…` → New Balance Marrom 39.
- Confirmar Olga → pedido `2a5b85d1…` → Samba Branco Off 38.
- Testar abertura sequencial dos dois links no mesmo navegador e garantir que um nunca reaproveite o carrinho do outro.
- Verificar compilação, função publicada e registros do banco após o teste.
