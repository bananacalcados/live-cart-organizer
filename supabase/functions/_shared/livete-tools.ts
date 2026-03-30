// Tool definitions for the Livete AI agent (tool calling)
export const liveteTools = [
  {
    type: "function",
    function: {
      name: "save_customer_data",
      description: "Salvar dados extraídos do cliente (endereço, nome, CPF, email). Chame sempre que extrair qualquer dado da conversa.",
      parameters: {
        type: "object",
        properties: {
          full_name: { type: "string", description: "Nome completo do cliente" },
          cpf: { type: "string", description: "CPF do cliente" },
          email: { type: "string", description: "E-mail do cliente" },
          cep: { type: "string", description: "CEP do endereço" },
          address: { type: "string", description: "Rua/Logradouro" },
          address_number: { type: "string", description: "Número" },
          complement: { type: "string", description: "Complemento" },
          neighborhood: { type: "string", description: "Bairro" },
          city: { type: "string", description: "Cidade" },
          state: { type: "string", description: "Estado (UF)" },
          delivery_method: { type: "string", enum: ["shipping", "pickup", "local_delivery"], description: "Envio, retirada ou entrega local" },
          payment_method: { type: "string", enum: ["pix", "cartao", "boleto", "dinheiro", "cartao_loja"], description: "Forma de pagamento escolhida" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "advance_stage",
      description: "Avançar a conversa para a próxima etapa do fluxo de checkout. Chame quando a etapa atual estiver concluída.",
      parameters: {
        type: "object",
        properties: {
          next_stage: {
            type: "string",
            enum: ["endereco", "confirmar_endereco", "dados_pessoais", "forma_pagamento", "aguardando_pix", "aguardando_cartao", "aguardando_boleto", "aguardando_pagamento_loja", "pago", "cancelado"],
            description: "Próxima etapa do fluxo",
          },
        },
        required: ["next_stage"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_product",
      description: "Buscar produto na loja por nome, cor, tipo ou descrição. Use quando o cliente mencionar um produto que quer adicionar, trocar ou perguntar sobre. Funciona com nomes aproximados (ex: 'Elena' encontra 'Helena').",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termo de busca: nome, cor, tipo do produto" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "swap_product",
      description: "Trocar um produto no pedido por outro. Use quando o cliente pedir para substituir um item. Você precisa primeiro usar find_product para encontrar o novo produto.",
      parameters: {
        type: "object",
        properties: {
          old_product_title: { type: "string", description: "Título do produto a ser removido (parcial OK)" },
          new_product_shopify_id: { type: "string", description: "ID do Shopify do novo produto (obtido via find_product)" },
          new_product_title: { type: "string" },
          new_product_variant: { type: "string" },
          new_product_price: { type: "number" },
          new_product_sku: { type: "string" },
          new_product_image: { type: "string" },
        },
        required: ["old_product_title", "new_product_shopify_id", "new_product_title", "new_product_price"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_order_shipping",
      description: "Atualizar configurações de frete do pedido (frete grátis, valor do frete).",
      parameters: {
        type: "object",
        properties: {
          free_shipping: { type: "boolean", description: "Ativar frete grátis" },
          shipping_cost: { type: "number", description: "Novo valor do frete em reais" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_order",
      description: "Cancelar o pedido. Use APENAS após tentar entender o motivo e aplicar técnicas de retenção. A IA deve pedir educadamente que o cliente não repita esse comportamento.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Motivo do cancelamento" },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notify_presenter",
      description: "Enviar notificação para a apresentadora da live. Use quando: cliente quer ver produto novamente na live, há alerta importante, ou situação que a apresentadora precisa saber.",
      parameters: {
        type: "object",
        properties: {
          alert_type: {
            type: "string",
            enum: ["show_product_again", "new_order_unpaid", "customer_issue", "general", "returning_desistente"],
            description: "Tipo do alerta",
          },
          message: { type: "string", description: "Mensagem do alerta para a apresentadora" },
          product_title: { type: "string", description: "Título do produto (se relevante)" },
        },
        required: ["alert_type", "message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_boleto",
      description: "Gerar boleto bancário via Mercado Pago. Use APENAS quando o cliente confirmar que pagará o boleto no dia seguinte. Todos os dados pessoais (nome, CPF, email) devem já estar coletados antes de chamar esta tool.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_delayed_desistente",
      description: "Marcar cliente como desistente quando não pode pagar no dia ou dia seguinte. Aplica tag 'followup_pagamento_futuro' e registra motivo. Use após tentar negociar e o cliente confirmar que não pode pagar no prazo.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Motivo (ex: 'quer pagar daqui 5 dias')" },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_cep",
      description: "Consultar CEP para obter endereço completo (rua, bairro, cidade, estado). Use SEMPRE que o cliente informar um CEP para preencher automaticamente o endereço e confirmar com o cliente. Isso evita pedir informações redundantes.",
      parameters: {
        type: "object",
        properties: {
          cep: { type: "string", description: "CEP com 8 dígitos (só números)" },
        },
        required: ["cep"],
      },
    },
  },
];

// ─── Tool Execution ───

interface ToolContext {
  supabase: any;
  supabaseUrl: string;
  supabaseKey: string;
  orderId: string;
  order: any;
  phone: string;
  customerId: string;
  customerInstagram: string;
  registration: any;
  eventId: string;
}

export async function executeToolCall(
  toolName: string,
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const { supabase, supabaseUrl, supabaseKey, orderId, order, phone, customerId, eventId } = ctx;

  switch (toolName) {
    // ─── SAVE CUSTOMER DATA ───
    case 'save_customer_data': {
      const fields = ['full_name', 'cpf', 'email', 'cep', 'address', 'address_number', 'complement', 'neighborhood', 'city', 'state'];
      const hasData = fields.some(f => args[f] && String(args[f]).trim());
      if (!hasData && !args.delivery_method && !args.payment_method) {
        return { success: true, data: { message: 'Nenhum dado novo para salvar' } };
      }

      if (ctx.registration) {
        const updateFields: Record<string, any> = {};
        for (const f of fields) {
          if (args[f] && String(args[f]).trim()) updateFields[f] = args[f];
        }
        if (Object.keys(updateFields).length > 0) {
          updateFields.updated_at = new Date().toISOString();
          await supabase.from('customer_registrations').update(updateFields).eq('id', ctx.registration.id);
        }
      } else {
        await supabase.from('customer_registrations').insert({
          order_id: orderId,
          customer_id: customerId,
          whatsapp: phone,
          full_name: args.full_name || '',
          cpf: args.cpf || '',
          email: args.email || '',
          cep: args.cep || '',
          address: args.address || '',
          address_number: args.address_number || '',
          complement: args.complement || '',
          neighborhood: args.neighborhood || '',
          city: args.city || '',
          state: args.state || '',
          status: 'pending',
        });
      }

      if (args.delivery_method) {
        const isPickup = args.delivery_method === 'pickup';
        const isLocalDelivery = args.delivery_method === 'local_delivery';
        await supabase.from('orders').update({
          delivery_method: args.delivery_method,
          is_pickup: isPickup,
          is_delivery: !isPickup,
        }).eq('id', orderId);
      }

      return { success: true, data: { saved_fields: Object.keys(args).filter(k => args[k]) } };
    }

    // ─── ADVANCE STAGE ───
    case 'advance_stage': {
      const nextStage = args.next_stage;
      await supabase.rpc('update_order_stage', { p_order_id: orderId, p_stage: nextStage });

      if (['aguardando_pix', 'aguardando_cartao', 'aguardando_boleto', 'aguardando_pagamento_loja'].includes(nextStage)) {
        await supabase.from('orders').update({ stage: 'awaiting_payment' }).eq('id', orderId);
      } else if (nextStage === 'cancelado') {
        await supabase.from('orders').update({ stage: 'cancelled' }).eq('id', orderId);
      }

      return { success: true, data: { stage: nextStage } };
    }

    // ─── FIND PRODUCT ───
    case 'find_product': {
      const query = args.query;
      const shopifyDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
      const shopifyToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

      if (!shopifyDomain || !shopifyToken) {
        return { success: false, error: 'Shopify não configurado' };
      }

      try {
        const graphql = `{
          products(first: 5, query: "${query.replace(/"/g, '\\"')}") {
            edges {
              node {
                id
                title
                handle
                variants(first: 10) {
                  edges {
                    node {
                      id
                      title
                      price
                      sku
                      availableForSale
                    }
                  }
                }
                images(first: 1) {
                  edges { node { url } }
                }
              }
            }
          }
        }`;

        const resp = await fetch(`https://${shopifyDomain}/admin/api/2024-01/graphql.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': shopifyToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: graphql }),
        });

        const data = await resp.json();
        const products = (data?.data?.products?.edges || []).map((e: any) => ({
          shopifyId: e.node.id,
          title: e.node.title,
          handle: e.node.handle,
          image: e.node.images?.edges?.[0]?.node?.url || null,
          variants: (e.node.variants?.edges || []).map((v: any) => ({
            variantId: v.node.id,
            title: v.node.title,
            price: v.node.price,
            sku: v.node.sku,
            available: v.node.availableForSale,
          })),
        }));

        return {
          success: true,
          data: {
            results: products,
            count: products.length,
            message: products.length > 0
              ? `Encontrei ${products.length} produto(s) para "${query}"`
              : `Nenhum produto encontrado para "${query}". Tente outro termo.`,
          },
        };
      } catch (err) {
        console.error('[find_product] Shopify search error:', err);
        return { success: false, error: 'Erro ao buscar produtos' };
      }
    }

    // ─── SWAP PRODUCT ───
    case 'swap_product': {
      const products = [...((order.products as any[]) || [])];
      const oldTitle = (args.old_product_title || '').toLowerCase();
      const idx = products.findIndex((p: any) => (p.title || '').toLowerCase().includes(oldTitle));

      if (idx === -1) {
        return { success: false, error: `Produto "${args.old_product_title}" não encontrado no pedido` };
      }

      products[idx] = {
        ...products[idx],
        shopifyId: args.new_product_shopify_id,
        title: args.new_product_title,
        variant: args.new_product_variant || products[idx].variant,
        price: args.new_product_price,
        sku: args.new_product_sku || products[idx].sku,
        image: args.new_product_image || products[idx].image,
      };

      await supabase.from('orders').update({ products, updated_at: new Date().toISOString() }).eq('id', orderId);

      const newTotal = products.reduce((s: number, p: any) => s + Number(p.price || 0) * Number(p.quantity || 1), 0);
      return {
        success: true,
        data: {
          message: `Produto trocado: "${args.old_product_title}" → "${args.new_product_title}" (R$${args.new_product_price.toFixed(2)})`,
          new_total: newTotal,
        },
      };
    }

    // ─── UPDATE ORDER SHIPPING ───
    case 'update_order_shipping': {
      const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
      if (args.free_shipping !== undefined) updateData.free_shipping = args.free_shipping;
      if (args.shipping_cost !== undefined) updateData.shipping_cost = args.shipping_cost;

      await supabase.from('orders').update(updateData).eq('id', orderId);
      return {
        success: true,
        data: {
          free_shipping: args.free_shipping,
          shipping_cost: args.shipping_cost,
          message: args.free_shipping ? 'Frete grátis aplicado!' : `Frete atualizado para R$${args.shipping_cost?.toFixed(2) || '0.00'}`,
        },
      };
    }

    // ─── CANCEL ORDER ───
    case 'cancel_order': {
      await supabase.rpc('update_order_stage', { p_order_id: orderId, p_stage: 'cancelado' });
      await supabase.from('orders').update({ stage: 'cancelled', updated_at: new Date().toISOString() }).eq('id', orderId);

      // Increment live_cancellation_count
      const { data: custData } = await supabase
        .from('customers')
        .select('live_cancellation_count')
        .eq('id', customerId)
        .single();

      const newCount = (custData?.live_cancellation_count || 0) + 1;
      await supabase.from('customers').update({ live_cancellation_count: newCount }).eq('id', customerId);

      // Deactivate AI session
      await supabase.from('automation_ai_sessions').update({ is_active: false }).eq('phone', phone);

      // Deactivate follow-ups
      await supabase.from('livete_followups').update({ is_active: false, completed_at: new Date().toISOString() }).eq('order_id', orderId);

      // Check if customer should be banned (3+ cancellations)
      let banWarning = '';
      if (newCount >= 3) {
        await supabase.from('customers').update({ is_banned: true, ban_reason: `Cancelou ${newCount} pedidos em lives` }).eq('id', customerId);
        banWarning = `ATENÇÃO: Cliente banido por ${newCount} cancelamentos.`;
      } else if (newCount === 2) {
        banWarning = `Aviso: Este é o 2º cancelamento. Mais um e o cliente será banido.`;
      }

      return {
        success: true,
        data: {
          cancellation_count: newCount,
          is_banned: newCount >= 3,
          ban_warning: banWarning,
          message: `Pedido cancelado. Motivo: ${args.reason}. Total de cancelamentos: ${newCount}/3.`,
        },
      };
    }

    // ─── NOTIFY PRESENTER ───
    case 'notify_presenter': {
      await supabase.from('livete_presenter_alerts').insert({
        event_id: eventId,
        order_id: orderId,
        phone,
        customer_name: ctx.customerInstagram,
        alert_type: args.alert_type,
        message: args.message,
        product_title: args.product_title || null,
      });

      return {
        success: true,
        data: { message: `Notificação enviada para a apresentadora: ${args.message}` },
      };
    }

    // ─── GENERATE BOLETO ───
    case 'generate_boleto': {
      const reg = ctx.registration;
      if (!reg || !reg.full_name || !reg.cpf) {
        return { success: false, error: 'Dados pessoais incompletos. Colete nome completo e CPF antes de gerar o boleto.' };
      }

      const nameParts = (reg.full_name || '').trim().split(' ');
      const payerData: any = {
        email: reg.email || undefined,
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(' ') || nameParts[0],
        cpf: reg.cpf,
      };

      try {
        const boletoResp = await fetch(`${supabaseUrl}/functions/v1/mercadopago-create-boleto`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ orderId, payer: payerData }),
        });

        const boletoData = await boletoResp.json();

        if (!boletoResp.ok || !boletoData.success) {
          console.error('[generate_boleto] Failed:', boletoData);
          return { success: false, error: boletoData.error || 'Erro ao gerar boleto' };
        }

        return {
          success: true,
          data: {
            boletoUrl: boletoData.boletoUrl,
            barcode: boletoData.barcode,
            dueDate: boletoData.dueDate,
            total: boletoData.total,
            message: `Boleto gerado! Vencimento: ${boletoData.dueDate}. Valor: R$${boletoData.total.toFixed(2)}`,
          },
        };
      } catch (err) {
        console.error('[generate_boleto] Error:', err);
        return { success: false, error: 'Erro técnico ao gerar boleto' };
      }
    }

    // ─── MARK DELAYED DESISTENTE ───
    case 'mark_delayed_desistente': {
      // Tag the customer
      const { data: custData } = await supabase
        .from('customers')
        .select('tags')
        .eq('id', customerId)
        .single();

      const currentTags: string[] = custData?.tags || [];
      const newTags = [...new Set([...currentTags, 'followup_pagamento_futuro', 'desistente_live'])];
      await supabase.from('customers').update({ tags: newTags }).eq('id', customerId);

      // Cancel order with specific reason
      await supabase.rpc('update_order_stage', { p_order_id: orderId, p_stage: 'cancelado' });
      await supabase.from('orders').update({
        stage: 'cancelled',
        notes: `Desistente: ${args.reason}`,
        updated_at: new Date().toISOString(),
      }).eq('id', orderId);

      // Deactivate AI session
      await supabase.from('automation_ai_sessions').update({ is_active: false }).eq('phone', phone);

      // Deactivate follow-ups
      await supabase.from('livete_followups').update({ is_active: false, completed_at: new Date().toISOString() }).eq('order_id', orderId);

      // Create presenter alert for future lives
      await supabase.from('livete_presenter_alerts').insert({
        event_id: eventId,
        order_id: orderId,
        phone,
        customer_name: ctx.customerInstagram,
        alert_type: 'returning_desistente',
        message: `Cliente desistiu: "${args.reason}". Se retornar em próximas lives, avaliar antes de aceitar pedido.`,
      });

      return {
        success: true,
        data: {
          tagged: true,
          tags_applied: ['followup_pagamento_futuro', 'desistente_live'],
          message: `Cliente marcado como desistente. Motivo: ${args.reason}. Alerta criado para próximas lives.`,
        },
      };
    }

    default:
      return { success: false, error: `Tool desconhecida: ${toolName}` };
  }
}
