# Nova conversa — item 8 interrompido, sem alteração

O computador já tem “Nova Conversa”. Não reutilizei essa tela no celular porque ela não mantém todas as garantias exigidas neste pedido.

## O que encontrei

- A abertura do computador usa `src/components/pos/NewConversationDialog.tsx`, não o envio compartilhado `useChatSender`/Opção A usado nas conversas abertas.
- O botão usa estado visual `sending`, mas `handleSend` não tem reserva síncrona de envio nem registro de tentativa incerta. Não há garantia equivalente à Opção A para toque duplo/resposta perdida.
- Várias chamadas de envio aguardam a função, mas não conferem `error` nem o erro retornado pelo provedor antes de registrar a mensagem como enviada. Por exemplo, linhas 330–344 e 367–440.
- A tela oferece envio normal em instâncias oficiais sem consultar a janela de 24 horas. O servidor pode recusar, mas esta tela não trata corretamente essa recusa.
- A seleção inclui todas as instâncias Meta ou online, sem excluir a instância dedicada a disparos (“Whats Carol”).
- A procura de cadastro é por telefone, com consultas antigas por trecho; não há busca de clientes por nome nessa tela.

## Por que parei

Importar essa tela traria um segundo caminho de envio para o celular e perderia a proteção de confirmação incerta. Reescrever o envio na tela mobile seria o caminho paralelo que o Matthews proibiu. Extrair/corrigir o caminho existente também exigiria alterar o desktop, fora desta autorização.

Nenhuma tela, função de envio ou dado do desktop foi alterado. Nenhum contato recebeu mensagem de teste. O botão de nova conversa não foi oferecido com um fluxo inseguro.

## Próxima autorização necessária

Permitir uma revisão separada da abertura de nova conversa do computador, preservando seus endpoints e incluindo resultado confirmado/incerto, trava síncrona, janela oficial, exclusão de instâncias de disparo e pesquisa paginada. Só depois compartilhar essa abertura com o celular e testar sem clientes reais.