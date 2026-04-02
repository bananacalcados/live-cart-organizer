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
      name: "generate_pix",
      description: "Gerar cobrança PIX via Mercado Pago. Use quando o cliente escolher pagar com PIX. Retorna o código copia-e-cola do PIX.",
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
      name: "generate_card_link",
      description: "Gerar link de pagamento via cartão de crédito. Use quando o cliente escolher pagar com cartão.",
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
      const fields = ['nome', 'tamanho', 'cidade', 'estado', 'cpf', 'email', 'cep', 'endereco'];
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

    // ─── GENERATE PIX ───
    case 'generate_pix': {
      const accessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');
      if (!accessToken) {
        return { success: false, error: 'Gateway de pagamento não configurado' };
      }

      try {
        const payerEmail = collectedData.email || `${phone}@ads-lead.com`;
        const payerName = collectedData.nome || 'Cliente';

        const pixResp = await fetch('https://api.mercadopago.com/v1/payments', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': `ads-${leadId}-${Date.now()}`,
          },
          body: JSON.stringify({
            transaction_amount: args.amount,
            description: args.product_name,
            payment_method_id: 'pix',
            payer: {
              email: payerEmail,
              first_name: payerName.split(' ')[0],
              last_name: payerName.split(' ').slice(1).join(' ') || payerName.split(' ')[0],
            },
          }),
        });

        const pixData = await pixResp.json();

        if (!pixResp.ok || pixData.status === 'rejected') {
          console.error('[generate_pix] MP error:', pixData);
          return { success: false, error: 'Erro ao gerar PIX. Tente novamente.' };
        }

        const pixCode = pixData.point_of_interaction?.transaction_data?.qr_code || '';
        const pixUrl = pixData.point_of_interaction?.transaction_data?.ticket_url || '';

        // Save payment ID to lead
        await supabase.from('ad_leads').update({
          payment_link_sent: true,
          collected_data: { ...collectedData, mercadopago_payment_id: pixData.id, payment_method: 'pix' },
        }).eq('id', leadId);

        return {
          success: true,
          data: {
            pix_code: pixCode,
            pix_url: pixUrl,
            payment_id: pixData.id,
            amount: args.amount,
            message: `PIX gerado! Valor: R$ ${args.amount.toFixed(2)}. Envie o código copia-e-cola em uma mensagem SEPARADA.`,
          },
        };
      } catch (err) {
        console.error('[generate_pix] Error:', err);
        return { success: false, error: 'Erro técnico ao gerar PIX' };
      }
    }

    // ─── GENERATE CARD LINK ───
    case 'generate_card_link': {
      const accessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');
      if (!accessToken) {
        return { success: false, error: 'Gateway de pagamento não configurado' };
      }

      try {
        const prefResp = await fetch('https://api.mercadopago.com/checkout/preferences', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            items: [{
              title: args.product_name,
              quantity: 1,
              unit_price: args.amount,
              currency_id: 'BRL',
            }],
            payment_methods: {
              installments: 6,
              excluded_payment_types: [{ id: 'ticket' }],
            },
            back_urls: {
              success: 'https://www.bananacalcados.com.br/obrigado',
              failure: 'https://www.bananacalcados.com.br',
            },
            auto_return: 'approved',
            external_reference: `ads-${leadId}`,
          }),
        });

        const prefData = await prefResp.json();

        if (!prefResp.ok) {
          console.error('[generate_card_link] MP error:', prefData);
          return { success: false, error: 'Erro ao gerar link de pagamento' };
        }

        // Save to lead
        await supabase.from('ad_leads').update({
          payment_link_sent: true,
          collected_data: { ...collectedData, checkout_url: prefData.init_point, payment_method: 'cartao' },
        }).eq('id', leadId);

        return {
          success: true,
          data: {
            checkout_url: prefData.init_point,
            amount: args.amount,
            message: `Link de pagamento gerado: ${prefData.init_point}`,
          },
        };
      } catch (err) {
        console.error('[generate_card_link] Error:', err);
        return { success: false, error: 'Erro técnico ao gerar link' };
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

    default:
      return { success: false, error: `Tool desconhecida: ${toolName}` };
  }
}
