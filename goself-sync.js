/**
 * GoSelf — Barramento Reativo de Integração e Sincronização em Tempo Real (v4.0)
 * 
 * Interliga o Totem de Autoatendimento do Cliente (index.html) e o
 * Portal de Retaguarda / Backoffice Corporativo (admin.html) em tempo real,
 * utilizando BroadcastChannel com fallback reativo para StorageEvent (localStorage).
 * 
 * Funcionalidades interligadas:
 * 1. Fila de Chamados de Ajuda (Totem aciona -> Retaguarda apita e exibe -> Fiscal atende -> Totem desbloqueia)
 * 2. Alertas de Divergência de Peso & Álcool 18+ (Totem bloqueia -> Retaguarda acende alerta -> Fiscal libera remoto ou local)
 * 3. Baixa Automática de Estoque na Venda (Totem emite NFC-e -> Retaguarda subtrai unidades e atualiza faturamento)
 * 4. Atualização de Preço e Reposição de Estoque (Estoquista abastece no Admin -> Totem reflete instantaneamente)
 * 5. Telemetria e Heartbeat do Totem (Monitoramento ao vivo de status, carrinho e total a pagar)
 */

(function (window) {
  'use strict';

  const CHANNEL_NAME = 'goself_interconnect_bus';
  const STORAGE_KEY_PREFIX = 'goself_store_';

  // Chaves de armazenamento compartilhado
  const KEYS = {
    CATALOG: STORAGE_KEY_PREFIX + 'catalog',
    CALLS: STORAGE_KEY_PREFIX + 'calls',
    AUDIT: STORAGE_KEY_PREFIX + 'audit',
    SALES: STORAGE_KEY_PREFIX + 'sales',
    TOTEMS: STORAGE_KEY_PREFIX + 'totems'
  };

  // Catálogo mestre padrão homologado de 15 produtos
  const DEFAULT_CATALOG = [
    { code: '22986', name: 'Pão Francês Tradicional', category: 'PADARIA', price: 17.99, unit: 'kg', weightNominal: 0.050, pesavel: true, isAlcohol: false, stock: 150 },
    { code: '22563', name: 'Patinho Bovino Moído', category: 'AÇOUGUE', price: 29.89, unit: 'kg', weightNominal: 0.500, pesavel: true, isAlcohol: false, stock: 80 },
    { code: '23658', name: 'Banana Prata Selecionada', category: 'HORTIFRÚTI', price: 5.49, unit: 'kg', weightNominal: 0.120, pesavel: true, isAlcohol: false, stock: 200 },
    { code: '21563', name: 'Repolho Verde Fresco', category: 'HORTIFRÚTI', price: 2.99, unit: 'uni', weightNominal: 0.850, pesavel: false, isAlcohol: false, stock: 65 },
    { code: '78533', name: 'Detergente Neutro Limpol 500ml', category: 'LIMPEZA', price: 1.99, unit: 'uni', weightNominal: 0.520, pesavel: false, isAlcohol: false, stock: 320 },
    { code: '78911', name: 'Cerveja Artesanal IPA 500ml', category: 'BEBIDAS', price: 14.90, unit: 'uni', weightNominal: 0.530, pesavel: false, isAlcohol: true, stock: 95 },
    { code: 'PLU-101', name: 'Pão Francês (Balcão)', category: 'PADARIA', price: 18.90, unit: 'kg', weightNominal: 0.050, pesavel: true, isAlcohol: false, stock: 300 },
    { code: 'PLU-102', name: 'Pão de Queijo Mineiro', category: 'PADARIA', price: 34.90, unit: 'kg', weightNominal: 0.030, pesavel: true, isAlcohol: false, stock: 120 },
    { code: 'PLU-103', name: 'Croissant Recheado Manteiga', category: 'PADARIA', price: 8.50, unit: 'uni', weightNominal: 0.150, pesavel: false, isAlcohol: false, stock: 45 },
    { code: 'PLU-201', name: 'Banana Prata Granel', category: 'FRUTAS', price: 6.99, unit: 'kg', weightNominal: 0.120, pesavel: true, isAlcohol: false, stock: 180 },
    { code: 'PLU-202', name: 'Maçã Gala Nacional', category: 'FRUTAS', price: 11.90, unit: 'kg', weightNominal: 0.150, pesavel: true, isAlcohol: false, stock: 110 },
    { code: 'PLU-203', name: 'Laranja Pera Doce', category: 'FRUTAS', price: 4.99, unit: 'kg', weightNominal: 0.180, pesavel: true, isAlcohol: false, stock: 250 },
    { code: 'PLU-301', name: 'Tomate Longa Vida', category: 'LEGUMES', price: 7.99, unit: 'kg', weightNominal: 0.130, pesavel: true, isAlcohol: false, stock: 140 },
    { code: 'PLU-302', name: 'Cenoura Higienizada', category: 'LEGUMES', price: 4.89, unit: 'kg', weightNominal: 0.100, pesavel: true, isAlcohol: false, stock: 90 },
    { code: 'PLU-401', name: 'Frango Assado Especial', category: 'ROTISSERIA', price: 39.90, unit: 'uni', weightNominal: 1.200, pesavel: false, isAlcohol: false, stock: 25 }
  ];

  // Trilha de auditoria inicia limpa (populada exclusivamente em tempo real por ações dos operadores e totens)
  const DEFAULT_AUDIT = [];

  // Chamados iniciam limpos na fila operacional (populados em tempo real quando o cliente solicita)
  const DEFAULT_CALLS = [];

  // Canais de comunicação
  let broadcastChannel = null;
  try {
    if (typeof window.BroadcastChannel === 'function') {
      broadcastChannel = new window.BroadcastChannel(CHANNEL_NAME);
    }
  } catch (err) {
    console.warn('[GoSelfSync] BroadcastChannel indisponível, usando fallback StorageEvent.', err);
  }

  const subscribers = {};

  function emitLocalEvent(type, payload) {
    if (subscribers[type]) {
      subscribers[type].forEach(function (cb) {
        try { cb(payload); } catch (e) { console.error('[GoSelfSync Handler Error]', e); }
      });
    }
  }

  // Ouvinte do BroadcastChannel
  if (broadcastChannel) {
    broadcastChannel.onmessage = function (event) {
      if (event && event.data && event.data.type) {
        emitLocalEvent(event.data.type, event.data.payload);
      }
    };
  }

  // Fallback via StorageEvent (funciona entre diferentes abas)
  window.addEventListener('storage', function (e) {
    if (e.key === 'goself_event_bus_signal' && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        if (parsed && parsed.type) {
          emitLocalEvent(parsed.type, parsed.payload);
        }
      } catch (err) {
        console.error('[GoSelfSync Storage Parse Error]', err);
      }
    }
  });

  // Utilitários de Storage
  function loadFromStorage(key, fallback) {
    try {
      const data = localStorage.getItem(key);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('[GoSelfSync Load Error]', key, e);
    }
    return fallback;
  }

  function saveToStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('[GoSelfSync Save Error]', key, e);
    }
  }

  // Migração e limpeza automática de dados antigos (garante ambiente 100% em tempo real sem dados pré-preenchidos)
  const CURRENT_STORAGE_VERSION = 'v5.0_clean_realtime';
  if (localStorage.getItem('goself_storage_ver') !== CURRENT_STORAGE_VERSION) {
    localStorage.removeItem(KEYS.CALLS);
    localStorage.removeItem(KEYS.AUDIT);
    localStorage.removeItem(KEYS.SALES);
    localStorage.removeItem(KEYS.TOTEMS);
    localStorage.setItem('goself_storage_ver', CURRENT_STORAGE_VERSION);
  }

  // Inicialização com dados padrão caso o storage esteja vazio
  if (!localStorage.getItem(KEYS.CATALOG)) {
    saveToStorage(KEYS.CATALOG, DEFAULT_CATALOG);
  }
  if (!localStorage.getItem(KEYS.CALLS)) {
    saveToStorage(KEYS.CALLS, DEFAULT_CALLS);
  }
  if (!localStorage.getItem(KEYS.AUDIT)) {
    saveToStorage(KEYS.AUDIT, DEFAULT_AUDIT);
  }
  if (!localStorage.getItem(KEYS.SALES)) {
    saveToStorage(KEYS.SALES, []);
  }
  if (!localStorage.getItem(KEYS.TOTEMS)) {
    saveToStorage(KEYS.TOTEMS, {
      'TOTEM-01': { name: 'Totem #01', status: 'STANDBY', andon: 'GREEN', activeStep: 's01', cartCount: 0, cartTotal: 0, lastHeartbeat: Date.now() },
      'TOTEM-02': { name: 'Totem #02', status: 'STANDBY', andon: 'GREEN', activeStep: 's01', cartCount: 0, cartTotal: 0, lastHeartbeat: Date.now() },
      'TOTEM-03': { name: 'Totem #03 (Ativo)', status: 'STANDBY', andon: 'GREEN', activeStep: 's01', cartCount: 0, cartTotal: 0, lastHeartbeat: Date.now() },
      'TOTEM-04': { name: 'Totem #04', status: 'STANDBY', andon: 'GREEN', activeStep: 's01', cartCount: 0, cartTotal: 0, lastHeartbeat: Date.now() }
    });
  }

  // API do Barramento
  const GoSelfSync = {
    /**
     * Publica uma mensagem no barramento em tempo real
     */
    publish: function (type, payload) {
      const msg = { type: type, payload: payload, senderId: Date.now() + '-' + Math.random().toString(36).substr(2, 5) };
      
      // 1. Envia via BroadcastChannel
      if (broadcastChannel) {
        try {
          broadcastChannel.postMessage(msg);
        } catch (e) {
          console.warn('[GoSelfSync BC Post Error]', e);
        }
      }

      // 2. Dispara sinal via localStorage (garante entrega em navegadores com restrições)
      try {
        localStorage.setItem('goself_event_bus_signal', JSON.stringify({
          type: type,
          payload: payload,
          timestamp: Date.now(),
          rnd: Math.random()
        }));
      } catch (e) {
        // Ignora quota se houver
      }

      // 3. Emite também no próprio contexto local
      emitLocalEvent(type, payload);
    },

    /**
     * Assina um evento do barramento
     */
    subscribe: function (type, callback) {
      if (!subscribers[type]) {
        subscribers[type] = [];
      }
      subscribers[type].push(callback);
      return function unsubscribe() {
        subscribers[type] = subscribers[type].filter(function (cb) { return cb !== callback; });
      };
    },

    /* =========================================================================
       MÓDULO: CATÁLOGO MESTRE & ESTOQUE
       ========================================================================= */
    getCatalog: function () {
      return loadFromStorage(KEYS.CATALOG, DEFAULT_CATALOG);
    },

    saveCatalog: function (catalog) {
      saveToStorage(KEYS.CATALOG, catalog);
      this.publish('CATALOG_UPDATED', catalog);
    },

    getProductByCode: function (code) {
      const cat = this.getCatalog();
      return cat.find(function (p) { return p.code === code; }) || null;
    },

    restockProduct: function (code, qty) {
      const cat = this.getCatalog();
      const item = cat.find(function (p) { return p.code === code; });
      if (item) {
        item.stock = (item.stock || 0) + (qty || 50);
        this.saveCatalog(cat);
        this.addAuditLog({
          totem: 'BACKOFFICE',
          operator: 'ESTOQUE',
          action: 'Reposição de Mercadoria',
          details: `Abastecido +${qty || 50} ${item.unit} de [${item.code}] ${item.name}. Novo saldo: ${item.stock}`,
          value: 'R$ 0,00'
        });
        return item;
      }
      return null;
    },

    deductStockOnSale: function (cartItems) {
      const cat = this.getCatalog();
      let changed = false;
      cartItems.forEach(function (cartItem) {
        const p = cat.find(function (item) { return item.code === cartItem.code; });
        if (p) {
          const deduct = cartItem.unit === 'kg' ? Math.ceil(cartItem.qty) : cartItem.qty;
          p.stock = Math.max(0, (p.stock || 0) - deduct);
          changed = true;
        }
      });
      if (changed) {
        this.saveCatalog(cat);
      }
    },

    /* =========================================================================
       MÓDULO: FILA DE CHAMADOS DE ATENDIMENTO
       ========================================================================= */
    getCalls: function () {
      return loadFromStorage(KEYS.CALLS, DEFAULT_CALLS);
    },

    requestAttendantCall: function (totemId, reason) {
      const calls = this.getCalls();
      const newCall = {
        id: 'CALL-' + Math.floor(1000 + Math.random() * 9000),
        totem: totemId || 'TOTEM-03',
        time: new Date().toLocaleTimeString('pt-BR'),
        reason: reason || 'Auxílio solicitado no terminal',
        status: 'PENDENTE'
      };
      calls.unshift(newCall);
      saveToStorage(KEYS.CALLS, calls);

      // Atualiza status do totem
      this.updateTotemState(totemId || 'TOTEM-03', {
        status: 'CHAMADO',
        andon: 'YELLOW',
        activeCallId: newCall.id,
        callReason: newCall.reason
      });

      this.publish('CALL_CREATED', newCall);
      return newCall;
    },

    resolveCall: function (callId, operatorName) {
      const calls = this.getCalls();
      const call = calls.find(function (c) { return c.id === callId; });
      if (call) {
        call.status = 'CONCLUÍDO';
        call.operator = operatorName || 'OP-2026 (Fiscal)';
        call.resolvedAt = new Date().toLocaleTimeString('pt-BR');
        saveToStorage(KEYS.CALLS, calls);

        // Restaura Andon do totem
        this.updateTotemState(call.totem, {
          status: 'ONLINE',
          andon: 'GREEN',
          activeCallId: null
        });

        this.addAuditLog({
          totem: call.totem,
          operator: operatorName || 'OP-2026 (Fiscal)',
          action: 'Atendimento de Chamado Concluído',
          details: `Chamado [${callId}] finalizado: ${call.reason}`,
          value: 'R$ 0,00'
        });

        this.publish('CALL_RESOLVED', call);
        return call;
      }
      return null;
    },

    cancelCallByTotem: function (totemId) {
      const calls = this.getCalls();
      const call = calls.find(function (c) { return c.totem === totemId && c.status === 'PENDENTE'; });
      if (call) {
        call.status = 'CANCELADO_CLIENTE';
        saveToStorage(KEYS.CALLS, calls);
        this.updateTotemState(totemId, {
          status: 'ONLINE',
          andon: 'GREEN',
          activeCallId: null
        });
        this.publish('CALL_CANCELLED', call);
      }
    },

    /* =========================================================================
       MÓDULO: DIVERGÊNCIA & TRAVAS REMOTAS (SUPERVISOR)
       ========================================================================= */
    reportDivergence: function (totemId, reason) {
      this.updateTotemState(totemId || 'TOTEM-03', {
        status: 'DIVERGENCIA',
        andon: 'RED',
        alertMsg: reason || 'Divergência de peso na balança'
      });
      this.publish('DIVERGENCE_TRIGGERED', { totem: totemId, reason: reason });
    },

    remoteUnlockTotem: function (totemId, operatorName) {
      this.updateTotemState(totemId || 'TOTEM-03', {
        status: 'ONLINE',
        andon: 'GREEN',
        alertMsg: null
      });

      this.addAuditLog({
        totem: totemId || 'TOTEM-03',
        operator: operatorName || 'OP-2026 (Fiscal)',
        action: 'Liberação Remota de Divergência',
        details: 'Divergência de balança liberada via Portal de Retaguarda',
        value: 'R$ 0,00'
      });

      this.publish('REMOTE_UNLOCKED', { totem: totemId, operator: operatorName });
    },

    /* =========================================================================
       MÓDULO: VENDAS & TRILHA DE AUDITORIA FORENSE
       ========================================================================= */
    getAuditLogs: function () {
      return loadFromStorage(KEYS.AUDIT, DEFAULT_AUDIT);
    },

    addAuditLog: function (entry) {
      const logs = this.getAuditLogs();
      const record = {
        timestamp: entry.timestamp || new Date().toLocaleString('pt-BR'),
        totem: entry.totem || 'TOTEM-03',
        operator: entry.operator || 'SISTEMA',
        action: entry.action || 'Operação Registrada',
        details: entry.details || '',
        value: entry.value || 'R$ 0,00'
      };
      logs.unshift(record);
      if (logs.length > 50) logs.pop(); // Mantém os 50 mais recentes
      saveToStorage(KEYS.AUDIT, logs);
      this.publish('AUDIT_LOG_ADDED', record);
      return record;
    },

    getSales: function () {
      return loadFromStorage(KEYS.SALES, []);
    },

    recordCompletedSale: function (saleData) {
      const sales = this.getSales();
      const saleRecord = {
        saleId: 'NFCe-' + Math.floor(1000 + Math.random() * 9000),
        totem: saleData.totem || 'TOTEM-03',
        timestamp: new Date().toLocaleString('pt-BR'),
        cpf: saleData.cpf || 'Não Informado',
        itemsCount: saleData.items ? saleData.items.length : 0,
        total: saleData.total || 0,
        paymentMode: saleData.paymentMode || 'PIX DINÂMICO',
        items: saleData.items || []
      };
      sales.unshift(saleRecord);
      saveToStorage(KEYS.SALES, sales);

      // Baixa no estoque
      if (saleData.items && saleData.items.length > 0) {
        this.deductStockOnSale(saleData.items);
      }

      // Registra na auditoria
      this.addAuditLog({
        totem: saleRecord.totem,
        operator: 'CLIENTE',
        action: 'Venda Concluída (NFC-e Emitida)',
        details: `Venda ${saleRecord.saleId} | CPF: ${saleRecord.cpf} | ${saleRecord.paymentMode}`,
        value: 'R$ ' + saleRecord.total.toFixed(2).replace('.', ',')
      });

      // Atualiza status do totem para conclusão/standby
      this.updateTotemState(saleRecord.totem, {
        status: 'CONCLUIDO',
        andon: 'GREEN',
        cartCount: 0,
        cartTotal: 0
      });

      this.publish('SALE_COMPLETED', saleRecord);
      return saleRecord;
    },

    /* =========================================================================
       MÓDULO: TELEMETRIA & MONITORAMENTO DOS TOTENS
       ========================================================================= */
    getTotemsState: function () {
      return loadFromStorage(KEYS.TOTEMS, {});
    },

    updateTotemState: function (totemId, partialState) {
      const totems = this.getTotemsState();
      if (!totems[totemId]) {
        totems[totemId] = { name: totemId, andon: 'GREEN', status: 'ONLINE' };
      }
      Object.assign(totems[totemId], partialState, { lastHeartbeat: Date.now() });
      saveToStorage(KEYS.TOTEMS, totems);
      this.publish('TOTEM_STATE_CHANGED', { totemId: totemId, state: totems[totemId] });
    },

    /**
     * Reseta todo o histórico e zera dados para teste limpo em tempo real
     */
    resetAllStoreData: function () {
      saveToStorage(KEYS.CALLS, []);
      saveToStorage(KEYS.AUDIT, []);
      saveToStorage(KEYS.SALES, []);
      saveToStorage(KEYS.TOTEMS, {
        'TOTEM-01': { name: 'Totem #01', status: 'STANDBY', andon: 'GREEN', activeStep: 's01', cartCount: 0, cartTotal: 0, lastHeartbeat: Date.now() },
        'TOTEM-02': { name: 'Totem #02', status: 'STANDBY', andon: 'GREEN', activeStep: 's01', cartCount: 0, cartTotal: 0, lastHeartbeat: Date.now() },
        'TOTEM-03': { name: 'Totem #03 (Ativo)', status: 'STANDBY', andon: 'GREEN', activeStep: 's01', cartCount: 0, cartTotal: 0, lastHeartbeat: Date.now() },
        'TOTEM-04': { name: 'Totem #04', status: 'STANDBY', andon: 'GREEN', activeStep: 's01', cartCount: 0, cartTotal: 0, lastHeartbeat: Date.now() }
      });
      this.publish('STORE_RESET', {});
    }
  };

  window.GoSelfSync = GoSelfSync;
})(window);
