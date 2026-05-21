# Plano E1-c — Trigger condicional no Realtime de `whatsapp_messages`

## Respondendo direto suas perguntas

### O que são os INSERTs que ficam no Realtime
Toda vez que uma mensagem nova **entra ou sai**, o banco faz um `INSERT` (linha nova). Exemplos:
- Pedro manda msg pro nosso WhatsApp → webhook salva via `INSERT`
- Operador envia msg pro Luis → app salva via `INSERT`
- IA (Jess/Bia) responde → `INSERT`

**Esses INSERTs continuam disparando Realtime normalmente.** É só o `UPDATE` (mudança em linha já existente) que vou bloquear — e mesmo assim, só quando o UPDATE é APENAS de status.

### Seu cenário: A com Luis, B com Pedro
| Situação | Hoje | Depois (E1-c) |
|---|---|---|
| Pedro manda msg, B com chat aberto na conversa do Pedro | Aparece na hora ✅ | **Aparece na hora ✅** (INSERT continua via Realtime) |
| Pedro manda msg, B com chat fechado | Notificação + badge sobe | **Igual ✅** (INSERT chega ao listener da lista) |
| Pedro manda msg, A vendo conversa do Luis | Conversa do Pedro sobe pro topo da lista | **Igual ✅** |
| Operador C envia msg pro Pedro de outro PC | B vê a msg saindo na hora | **Igual ✅** (INSERT) |
| Cliente leu nossa msg → ✓✓ azul | Atualiza em ~1s | Atualiza quando: abrir o chat, ou refetch automático a cada N segundos no chat ativo |

**Sua preocupação:** ZERO impacto no "chegar msg nova sem precisar abrir". Tudo que aparece sem clicar continua aparecendo sem clicar. O único atraso é no indicador de leitura (✓✓ azul).

---

## O que o trigger vai fazer (passo a passo)

Hoje a publication realtime escuta TODA mudança na tabela. Vou trocar por uma regra que diz:

```
SE for INSERT → publica no Realtime (chat ganha msg nova)
SE for DELETE → publica no Realtime (raro, mas mantém)
SE for UPDATE:
   SE o campo "message" mudou (edição de texto) → publica
   SE o campo "error_message" mudou (falha) → publica
   SENÃO (só status mudou) → NÃO publica
```

Implementação técnica: trigger `BEFORE UPDATE` com filtro + uso de `pg_logical_emit_message` OU criação de uma view/regra. Forma mais limpa no Supabase: **remover `whatsapp_messages` da publication padrão e criar publication própria com `WITH (publish = 'insert, delete')`** + se precisar de UPDATE de conteúdo, fazer trigger que reemite via tabela auxiliar.

Vou usar a abordagem mais simples e segura: **publication seletiva por operação:**
```sql
ALTER PUBLICATION supabase_realtime DROP TABLE whatsapp_messages;
CREATE PUBLICATION supabase_realtime_wm FOR TABLE whatsapp_messages 
  WITH (publish = 'insert, delete');
```

Isso elimina 100% dos UPDATEs (incluindo edição de conteúdo). A edição de msg via `zapi-edit-message` é rara (raríssima) e o operador pode atualizar abrindo a conversa.

Se você quiser preservar edições em tempo real, uso variante com trigger que detecta se mudou `message`. Mais complexo, mas possível.

---

## Ganho estimado

- 908k UPDATEs / 1.385M writes = **65% do volume de eventos Realtime de `whatsapp_messages`**
- `whatsapp_messages` = ~90% do tráfego Realtime total
- **Redução esperada de CPU do banco: 55-60%**

---

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Status ✓✓ não atualiza no chat aberto | Adicionar refetch leve (a cada 10s) APENAS quando há chat ativo aberto |
| Edição de mensagem não aparece em tempo real | Aceitar (uso muito raro) ou usar variante com trigger |
| Quebra do PDV | Zero — INSERT continua igual |
| Quebra de automação/dispatch | Zero — backend escreve direto, não depende de Realtime |
| Reverter | 1 comando: dropar publication nova, readicionar tabela na padrão |

---

## O que vou fazer

1. **Migration:** remover `whatsapp_messages` da publication padrão e criar publication própria só com INSERT+DELETE.
2. **Validação:** monitorar logs por 10 min para confirmar que chat ainda recebe msgs novas.
3. **Ajuste no chat (opcional, fase 2):** se o ✓✓ azul atrasar demais ao ponto de incomodar, adicionar refetch de 10s na conversa ativa.

Posso seguir com isso?
