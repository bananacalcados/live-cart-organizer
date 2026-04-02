// Tool definitions for the Ads AI agent (Jess) — tool calling
export const adsTools = [
  {
    type: "function",
    function: {
      name: "search_product",
      description: "Buscar produto na loja por nome, cor, tipo, tamanho ou descrição. Use quando o cliente perguntar sobre detalhes do produto (tamanhos disponíveis, cores, variações, preço). Retorna variantes com estoque.",
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
      name: "save_lead_data",
      description: "Salvar dados extraídos do lead (nome, cidade, tamanho, CPF, email, endereço). Chame sempre que extrair qualquer dado da conversa.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome completo do cliente" },
          tamanho: { type: "string", description: "Tamanho/número do calçado" },
          cor: { type: "string", description: "Cor do produto desejada pelo cliente" },
          cidade: { type: "string", description: "Cidade do cliente" },
          estado: { type: "string", description: "Estado (UF)" },
          cpf: { type: "string", description: "CPF do cliente" },
          email: { type: "string", description: "E-mail do cliente" },
          cep: { type: "string", description: "CEP do endereço" },
          endereco: { type: "string", description: "Endereço completo" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_checkout_link",
      description: "Gerar link do checkout transparente para o cliente finalizar a compra. O checkout aceita PIX (com desconto automático) e cartão de crédito. IMPORTANTE: Antes de chamar esta ferramenta, você DEVE ter coletado o tamanho E a cor desejada do produto. Se faltar algum desses dados, pergunte ao cliente antes de gerar o link.",
      parameters: {
        type: "object",
        properties: {
          product_name: { type: "string", description: "Nome do produto" },
          amount: { type: "number", description: "Valor unitário em reais" },
          quantity: { type: "number", description: "Quantidade do produto (padrão: 1)" },
          variant: { type: "string", description: "Variante/tamanho do produto (ex: '38')" },
          color: { type: "string", description: "Cor do produto escolhida pelo cliente (ex: 'Preto', 'Rosa')" },
        },
        required: ["product_name", "amount", "variant", "color"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_delivery_payment",
      description: "Confirmar pagamento na entrega (somente para clientes de Governador Valadares). Registra o pedido para entrega local.",
      parameters: {
        type: "object",
        properties: {
          product_name: { type: "string", description: "Nome do produto" },
          amount: { type: "number", description: "Valor total em reais" },
        },
        required: ["product_name", "amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_cep",
      description: "Consultar CEP para obter endereço completo. Use quando o cliente informar um CEP.",
      parameters: {
        type: "object",
        properties: {
          cep: { type: "string", description: "CEP com 8 dígitos" },
        },
        required: ["cep"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "register_live_reminder",
      description: "Registrar que o cliente quer ser lembrado quando a live começar. Use quando o cliente aceitar o convite da live.",
      parameters: {
        type: "object",
        properties: {
          confirmed: { type: "boolean", description: "Se o cliente confirmou que quer ser lembrado" },
        },
        required: ["confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_product_image",
      description: "Enviar foto do produto para o cliente via WhatsApp. Use quando o cliente pedir para ver fotos, ou após apresentar o produto para reforçar visualmente. Busca a imagem diretamente da Shopify.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Nome ou termo de busca do produto para encontrar a imagem" },
          caption: { type: "string", description: "Legenda curta para acompanhar a foto (ex: 'Tênis Jess Ortopédico 😍')" },
        },
        required: ["query"],
      },
    },
  },
];

// ─── Tool Execution ───

interface AdsToolContext {
  supabase: any;
  supabaseUrl: string;
  supabaseKey: string;
  phone: string;
  leadId: string;
  lead: any;
  campaign: any;
  collectedData: Record<string, any>;
}

export async function executeAdsToolCall(
  toolName: string,
  args: Record<string, any>,
  ctx: AdsToolContext,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const { supabase, supabaseUrl, supabaseKey, phone, leadId, lead, campaign, collectedData } = ctx;

  switch (toolName) {
    // ─── SEARCH PRODUCT ───
    case 'search_product': {
      const query = args.query;
      const shopifyDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
      const shopifyToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

      if (!shopifyDomain || !shopifyToken) {
        // Fallback: use catalog info from campaign
        const catalog = campaign.product_info?.catalogo || [];
        const results = catalog.filter((p: any) => {
          const searchLower = query.toLowerCase();
          return (p.nome || '').toLowerCase().includes(searchLower) ||
            (p.keywords || []).some((kw: string) => searchLower.includes(kw.toLowerCase()));
        });
        return {
          success: true,
          data: {
            source: 'catalog',
            results: results.length > 0 ? results : catalog,
            message: results.length > 0
              ? `Encontrei ${results.length} produto(s) no catálogo`
              : 'Mostrando todos os produtos do catálogo',
          },
        };
      }

      try {
        const graphql = `{
          products(first: 5, query: "${query.replace(/"/g, '\\"')}") {
            edges {
              node {
                id
                title
                description
                variants(first: 20) {
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
          title: e.node.title,
          description: (e.node.description || '').substring(0, 200),
          image: e.node.images?.edges?.[0]?.node?.url || null,
          variants: (e.node.variants?.edges || []).map((v: any) => ({
            title: v.node.title,
            price: v.node.price,
            sku: v.node.sku,
            available: v.node.availableForSale,
          })),
          available_sizes: (e.node.variants?.edges || [])
            .filter((v: any) => v.node.availableForSale)
            .map((v: any) => v.node.title),
        }));

        return {
          success: true,
          data: {
            source: 'shopify',
            results: products,
            count: products.length,
            message: products.length > 0
              ? `Encontrei ${products.length} produto(s). Tamanhos disponíveis: ${products[0]?.available_sizes?.join(', ') || 'verificar'}`
              : `Nenhum produto encontrado para "${query}"`,
          },
        };
      } catch (err) {
        console.error('[search_product] Error:', err);
        return { success: false, error: 'Erro ao buscar produtos' };
      }
    }

    // ─── SAVE LEAD DATA ───
    case 'save_lead_data': {
      const fields = ['nome', 'tamanho', 'cor', 'cidade', 'estado', 'cpf', 'email', 'cep', 'endereco'];
      const newData: Record<string, any> = { ...collectedData };
      const savedFields: string[] = [];

      for (const f of fields) {
        if (args[f] && String(args[f]).trim()) {
          newData[f] = args[f];
          savedFields.push(f);
        }
      }

      const updates: Record<string, any> = {
        collected_data: newData,
      };
      if (args.nome) updates.name = args.nome;

      // Detect GV for delivery options
      const city = (newData.cidade || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const isGV = city.includes('valadares') || city.includes('gv');

      await supabase.from('ad_leads').update(updates).eq('id', leadId);

      return {
        success: true,
        data: {
          saved_fields: savedFields,
          is_from_gv: isGV,
          all_collected: newData,
          message: `Dados salvos: ${savedFields.join(', ')}`,
        },
      };
    }

    // ─── GENERATE CHECKOUT LINK ───
    case 'generate_checkout_link': {
      const CHECKOUT_BASE_URL = 'https://checkout.bananacalcados.com.br';

      try {
        // 1. Find or create customer
        const phoneDigits = phone.replace(/\D/g, '');
        let customerId: string | null = null;

        // Search by phone (last 8 digits)
        const { data: existingCustomers } = await supabase
          .from('customers')
          .select('id')
          .ilike('whatsapp', `%${phoneDigits.slice(-8)}%`)
          .limit(1);

        if (existingCustomers && existingCustomers.length > 0) {
          customerId = existingCustomers[0].id;
        } else {
          // Create customer
          const { data: newCustomer } = await supabase
            .from('customers')
            .insert({
              whatsapp: phoneDigits,
              instagram_handle: collectedData.nome || 'Lead Campanha',
              tags: ['ads-lead'],
            })
            .select('id')
            .single();
          customerId = newCustomer?.id || null;
        }

        if (!customerId) {
          return { success: false, error: 'Não foi possível criar o cadastro do cliente' };
        }

        // 2. Determine event_id from campaign
        const eventId = campaign.event_id;

        // 3. Build product entry
        const quantity = args.quantity || 1;
        const variantLabel = args.variant || collectedData.tamanho || '';
        const colorLabel = args.color || collectedData.cor || '';
        const product = {
          title: args.product_name,
          price: args.amount,
          quantity,
          variant: [variantLabel, colorLabel].filter(Boolean).join(' / '),
          size: variantLabel,
          color: colorLabel,
        };

        // 4. Determine shipping
        const shippingRule = campaign.shipping_rule;
        let freeShipping = false;
        let shippingCost = 0;
        if (shippingRule?.type === 'free') {
          freeShipping = true;
        } else if (shippingRule?.type === 'fixed') {
          shippingCost = Number(shippingRule.value) || 0;
        }

        // 5. Create order
        const orderPayload: Record<string, any> = {
          customer_id: customerId,
          products: [product],
          stage: 'new',
          free_shipping: freeShipping,
          shipping_cost: shippingCost,
          delivery_method: 'shipping',
        };
        if (eventId) orderPayload.event_id = eventId;

        const { data: order, error: orderErr } = await supabase
          .from('orders')
          .insert(orderPayload)
          .select('id')
          .single();

        if (orderErr || !order) {
          console.error('[generate_checkout_link] Order creation error:', orderErr);
          return { success: false, error: 'Erro ao criar pedido para checkout' };
        }

        // 6. Save customer registration data for checkout
        const regData: any = {
          order_id: order.id,
          full_name: collectedData.nome || '',
          whatsapp: phoneDigits,
          cpf: collectedData.cpf || '',
          email: collectedData.email || '',
          cep: collectedData.cep || '',
          address: collectedData.endereco || '',
          address_number: collectedData.numero || '',
          neighborhood: collectedData.bairro || '',
          city: collectedData.cidade || '',
          state: collectedData.estado || '',
        };

        await supabase.from('customer_registrations').upsert(regData, { onConflict: 'order_id' });

        const checkoutUrl = `${CHECKOUT_BASE_URL}/checkout/order/${order.id}`;

        // 7. Update lead
        await supabase.from('ad_leads').update({
          payment_link_sent: true,
          collected_data: { ...collectedData, checkout_url: checkoutUrl, order_id: order.id },
        }).eq('id', leadId);

        // 8. Update order with cart link
        await supabase.from('orders').update({ cart_link: checkoutUrl }).eq('id', order.id);

        const total = args.amount * quantity;
        return {
          success: true,
          data: {
            checkout_url: checkoutUrl,
            order_id: order.id,
            amount: total,
            message: `Link de checkout gerado: ${checkoutUrl} — O cliente pode escolher entre PIX (com 5% de desconto) ou cartão de crédito (até 6x sem juros).`,
          },
        };
      } catch (err) {
        console.error('[generate_checkout_link] Error:', err);
        return { success: false, error: 'Erro técnico ao gerar link de checkout' };
      }
    }

    // ─── CONFIRM DELIVERY PAYMENT ───
    case 'confirm_delivery_payment': {
      await supabase.from('ad_leads').update({
        payment_link_sent: true,
        collected_data: { ...collectedData, payment_method: 'entrega', delivery_amount: args.amount },
        temperature: 'convertido',
      }).eq('id', leadId);

      return {
        success: true,
        data: {
          payment_method: 'entrega',
          amount: args.amount,
          message: `Pagamento na entrega confirmado! Valor: R$ ${args.amount.toFixed(2)}. Produto: ${args.product_name}`,
        },
      };
    }

    // ─── LOOKUP CEP ───
    case 'lookup_cep': {
      const cep = (args.cep || '').replace(/\D/g, '');
      if (cep.length !== 8) {
        return { success: false, error: 'CEP inválido. Deve ter 8 dígitos.' };
      }

      try {
        const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await resp.json();

        if (data.erro) {
          return { success: false, error: 'CEP não encontrado.' };
        }

        // Auto-save address data
        const newData = {
          ...collectedData,
          cep,
          endereco: `${data.logradouro || ''}, ${data.bairro || ''} - ${data.localidade || ''}/${data.uf || ''}`,
          cidade: data.localidade || '',
          estado: data.uf || '',
        };

        await supabase.from('ad_leads').update({
          collected_data: newData,
        }).eq('id', leadId);

        return {
          success: true,
          data: {
            cep,
            logradouro: data.logradouro || '',
            bairro: data.bairro || '',
            cidade: data.localidade || '',
            estado: data.uf || '',
            message: `Endereço: ${data.logradouro}, ${data.bairro} - ${data.localidade}/${data.uf}. Qual o número?`,
          },
        };
      } catch (e) {
        return { success: false, error: 'Erro ao consultar CEP' };
      }
    }

    // ─── REGISTER LIVE REMINDER ───
    case 'register_live_reminder': {
      if (args.confirmed) {
        await supabase.from('ad_leads').update({
          live_invite_sent: true,
          collected_data: { ...collectedData, live_reminder: true },
        }).eq('id', leadId);

        // Add tag to CRM if exists
        const { data: customers } = await supabase
          .from('customers')
          .select('id, tags')
          .ilike('whatsapp', `%${phone.slice(-8)}%`)
          .limit(1);

        if (customers && customers.length > 0) {
          const currentTags: string[] = customers[0].tags || [];
          if (!currentTags.includes('lembrar_live')) {
            await supabase.from('customers').update({
              tags: [...currentTags, 'lembrar_live'],
            }).eq('id', customers[0].id);
          }
        }
      }

      return {
        success: true,
        data: {
          confirmed: args.confirmed,
          message: args.confirmed ? 'Cliente registrado para lembrete da live!' : 'Cliente não quis lembrete.',
        },
      };
    }

    // ─── SEND PRODUCT IMAGE ───
    case 'send_product_image': {
      const query = args.query;
      const caption = args.caption || '';
      const shopifyDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
      const shopifyToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

      let imageUrl: string | null = null;
      let productTitle = query;

      if (shopifyDomain && shopifyToken) {
        try {
          const graphql = `{
            products(first: 1, query: "${query.replace(/"/g, '\\"')}") {
              edges {
                node {
                  title
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
          const product = data?.data?.products?.edges?.[0]?.node;
          if (product) {
            productTitle = product.title;
            imageUrl = product.images?.edges?.[0]?.node?.url || null;
          }
        } catch (err) {
          console.error('[send_product_image] Shopify error:', err);
        }
      }

      // Fallback: check catalog for image
      if (!imageUrl) {
        const catalog = campaign.product_info?.catalogo || [];
        const searchLower = query.toLowerCase();
        const matched = catalog.find((p: any) =>
          (p.nome || '').toLowerCase().includes(searchLower) ||
          (p.keywords || []).some((kw: string) => searchLower.includes(kw.toLowerCase()))
        );
        if (matched?.imagem) {
          imageUrl = matched.imagem;
          productTitle = matched.nome || query;
        }
      }

      if (!imageUrl) {
        return {
          success: false,
          error: 'Não encontrei imagem para esse produto. Descreva o produto por texto.',
        };
      }

      // Send image via edge function (supports both Z-API and Meta)
      try {
        const sendPayload: any = {
          phone,
          mediaUrl: imageUrl,
          mediaType: 'image',
          caption: caption || productTitle,
        };

        // Determine which channel to use based on lead
        const leadChannel = lead?.channel || 'zapi';
        const whatsappNumberId = lead?.whatsapp_number_id;

        if (leadChannel === 'meta') {
          sendPayload.whatsapp_number_id = whatsappNumberId;
          await fetch(`${supabaseUrl}/functions/v1/meta-whatsapp-send`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(sendPayload),
          });
        } else {
          sendPayload.whatsapp_number_id = whatsappNumberId;
          await fetch(`${supabaseUrl}/functions/v1/zapi-send-media`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(sendPayload),
          });
        }

        // Save message to DB
        await supabase.from('whatsapp_messages').insert({
          phone,
          message: `[IA-ADS] 📷 ${caption || productTitle}`,
          direction: 'outgoing',
          media_type: 'image',
          media_url: imageUrl,
          whatsapp_number_id: whatsappNumberId,
          is_mass_dispatch: false,
          channel: leadChannel,
        });

        return {
          success: true,
          data: {
            image_sent: true,
            product_title: productTitle,
            image_url: imageUrl,
            message: `Foto do ${productTitle} enviada com sucesso!`,
          },
        };
      } catch (err) {
        console.error('[send_product_image] Send error:', err);
        return { success: false, error: 'Erro ao enviar foto. Tente descrever o produto por texto.' };
      }
    }

    default:
      return { success: false, error: `Tool desconhecida: ${toolName}` };
  }
}
