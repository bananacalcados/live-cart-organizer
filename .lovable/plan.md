# Painéis laterais nos chats da Live e do PDV

## Objetivo
Manter a conversa visível enquanto a equipe usa as ações auxiliares. Cada ação abre no lado direito do chat, com apenas um painel ativo por vez e fechamento pelo próprio painel ou pelo botão selecionado.

## Live
- Unificar Ficha, Detalhes do pedido, Editar pedido, Cross-sell, Brinde e Suporte no mesmo espaço lateral já usado pela ficha.
- Reaproveitar exatamente os formulários, validações, consultas e envios atuais; somente trocar o contêiner visual de modal para painel.
- Fazer os atalhos duplicados no cabeçalho do chat abrirem o mesmo painel lateral.
- No celular, manter o padrão atual de sobreposição interna em tela cheia, sem abrir outro modal sobre o chat.

## WhatsApp do PDV
- Criar um painel lateral direito dentro da conversa, funcionando tanto na visualização tradicional quanto na visualização em linhas.
- Abrir nele Checkout, PIX, Boleto, Catálogo, Aguardando produto, Exportar PDF e Criar suporte.
- Reaproveitar os conteúdos e comportamentos atuais, incluindo geração/envio, seleção de produtos, pagamentos e atualização dos cards pendentes.
- Ao trocar de cliente, fechar qualquer ferramenta aberta e carregar os dados do novo cliente sem misturar estados.

## Notas do cliente
- Adicionar uma coluna lateral esquerda estreita e sempre visível quando uma conversa individual estiver aberta no PDV.
- Mostrar as notas existentes em ordem da mais recente para a mais antiga; sem notas, mostrar somente “Adicionar nota”.
- Permitir adicionar uma nota curta, salvando autor e data para dar contexto à equipe.
- Vincular as notas ao telefone normalizado e à empresa, para reaparecerem em qualquer conversa/instância daquele cliente sem vazar dados entre empresas.

## Dados e segurança
- Criar uma tabela própria para notas com acesso somente a usuários autenticados da mesma empresa.
- Registrar quem criou cada nota e manter datas de criação/alteração.
- Não usar as observações de pedido como notas gerais do cliente, evitando mistura entre pedidos e conversas.

## Verificação
- Confirmar que nenhum dos atalhos listados abre uma janela por cima do chat no desktop.
- Confirmar troca e fechamento dos painéis, envio de PIX/boleto/catálogo e criação de suporte.
- Confirmar persistência das notas ao fechar/reabrir e isolamento por cliente.
- Verificar o chat da Live e do PDV em desktop e celular, além da compilação e dos erros da tela.
