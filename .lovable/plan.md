# Ficha completa padrão nos chats

## Resultado
- Ao abrir uma conversa no WhatsApp do PDV, a ficha completa do cliente já aparece na lateral direita.
- A coluna de notas e o resumo do atendimento permanecem visíveis à esquerda enquanto a ficha estiver aberta.
- As demais ferramentas continuam substituindo temporariamente a ficha à direita; ao voltar ao chat, a ficha reaparece automaticamente.
- O modal de WhatsApp da Live passa a abrir com a mesma ficha completa à direita, exibindo tudo o que já estiver disponível sobre o cliente.

## Implementação
- Ajustar o estado inicial e a troca de conversa no PDV para selecionar a ficha do cliente por padrão, sem considerar a ficha como uma ferramenta que oculta as notas.
- Preservar a largura confortável do chat com as duas laterais visíveis, ampliando o modal quando necessário.
- Reutilizar a apresentação da ficha do PDV no chat da Live, com carregamento progressivo por telefone, Instagram e vínculo dos pedidos.
- Consolidar na ficha da Live os dados existentes: nome, WhatsApp, Instagram, CPF, e-mail, endereço, cashback, etiquetas, pedidos da Live, vendas pagas e demais compras anteriores.
- Exibir estados parciais de forma natural: campos ainda não informados não impedem a ficha de abrir e novos dados aparecem nas próximas consultas.
- Manter as ações já existentes de trocas, devoluções e chargeback quando o registro corresponder a uma venda elegível.

## Verificação
- Conferir abertura inicial, troca entre clientes, fechamento/retorno das ferramentas e permanência das notas no PDV.
- Conferir clientes da Live com cadastro completo, cadastro parcial, apenas Instagram e apenas WhatsApp.
- Validar em tela ampla e celular, além de tipos, testes e erros da aplicação.
