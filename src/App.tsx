import { useState, useEffect } from 'react';
import { db, seedDatabase, type MenuItem, type RestaurantTable, type Order, type OrderItem, type PaymentMethod } from './db';
import { 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  Plus, 
  Minus, 
  Trash2, 
  DollarSign, 
  UtensilsCrossed, 
  Coffee, 
  IceCream, 
  Soup, 
  LayoutGrid,
  Settings,
  X,
  Camera,
  Pencil,
  Search,
  Moon,
  Sun,
  Receipt,
  LogOut,
  Printer,
  Download,
  UserPlus
} from 'lucide-react';

import { ZReportModal } from './components/ZReportModal';
import { supabase, syncOfflineData, syncAllHistoricalOrders, restoreDataFromSupabase } from './supabaseClient';

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved ? saved === 'dark' : true; // default dark
  });
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null);
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [activeCategory, setActiveCategory] = useState<'Comidas' | 'Bebidas' | 'Sobremesas' | 'Entradas'>('Comidas');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);

  // Estados do Modal de Gestão / Admin
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminTab, setAdminTab] = useState<'artigos' | 'vendas' | 'vendas_artigo' | 'pagamentos' | 'configuracoes'>('artigos');
  const [completedOrders, setCompletedOrders] = useState<Order[]>([]);
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [holdOrders, setHoldOrders] = useState<Order[]>([]);
  const [isEnteringCustomer, setIsEnteringCustomer] = useState(false);
  const [customerNameInput, setCustomerNameInput] = useState('');
  const [customerNifInput, setCustomerNifInput] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<'Comidas' | 'Bebidas' | 'Sobremesas' | 'Entradas'>('Comidas');
  const [newItemImage, setNewItemImage] = useState('');
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState<string>('Todos');

  // Estados de Formas de Pagamento e Checkout
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [newPaymentName, setNewPaymentName] = useState('');
  const [newPaymentIcon, setNewPaymentIcon] = useState('💳');

  // Estado de Configuração de Mesas
  const [tableCountInput, setTableCountInput] = useState<string>('');

  // Estados de Fecho de Caixa (Z-Report)
  const [showZReportModal, setShowZReportModal] = useState(false);
  const [selectedReceiptId, setSelectedReceiptId] = useState<number | null>(null);

  // Inicializar base de dados e carregar dados
  useEffect(() => {
    async function init() {
      // 1. Tentar restaurar a base de dados a partir do Supabase caso a BD local esteja vazia
      let restored = false;
      const localTableCount = await db.restaurantTables.count();
      const localOrderCount = await db.orders.count();
      
      if ((localTableCount === 0 || localOrderCount === 0) && navigator.onLine) {
        try {
          restored = await restoreDataFromSupabase();
        } catch (err) {
          console.error("Falha ao restaurar dados do Supabase:", err);
        }
      }
      
      // 2. Se não conseguiu restaurar (ou estava offline/vazio), corre o seed normal com dados padrão
      if (!restored) {
        await seedDatabase();
      }
      
      await loadData();
      syncMenuFromSupabase(); // Sincronizar ementa em segundo plano, sem bloquear o POS
    }
    init();

    // Função robusta para testar a ligação real ao Supabase (Heartbeat)
    const checkRealConnection = async () => {
      if (!navigator.onLine) {
        setIsOnline(false);
        return;
      }
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5 segundos de timeout
        
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co';
        // Testar ligação ao endpoint REST do Supabase
        await fetch(`${supabaseUrl}/rest/v1/`, {
          method: 'GET',
          mode: 'no-cors',
          signal: controller.signal,
          headers: {
            'Cache-Control': 'no-cache'
          }
        });
        
        clearTimeout(timeoutId);
        setIsOnline(true);
      } catch (err) {
        setIsOnline(false);
      }
    };

    // Executar verificação imediatamente
    checkRealConnection();

    // Agendar verificação a cada 10 segundos
    const intervalId = setInterval(checkRealConnection, 10000);

    // Eventos de rede para reagir instantaneamente
    const goOnline = () => {
      checkRealConnection();
    };
    const goOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(intervalId);
    };
  }, []);

  // Aplicar o tema atual sempre que isDarkMode mudar
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Selecionar mesa virtual do Balcão (número 0)
  const handleSelectCounter = async () => {
    let counterTable = tables.find(t => t.number === 0);
    if (!counterTable) {
      const id = await db.restaurantTables.add({ number: 0, status: 'free', currentOrderTotal: 0 });
      counterTable = { id, number: 0, status: 'free', currentOrderTotal: 0 };
    }
    handleSelectTable(counterTable);
  };

  // Recarregar dados do Dexie.js
  // Sincronizar ementa do Supabase de forma assíncrona em background
  const syncMenuFromSupabase = async () => {
    if (!navigator.onLine) return;
    console.log('A tentar sincronizar ementa do Supabase...');
    try {
      const { data: supabaseMenu, error } = await supabase
        .from('menu_items')
        .select('*');
        
      if (!error && supabaseMenu && supabaseMenu.length > 0) {
        console.log('A atualizar ementa local com artigos do Supabase.');
        await db.menuItems.clear();
        await db.menuItems.bulkAdd(supabaseMenu.map((item: any) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          category: item.category,
          image: item.image
        })));
        
        // Recarregar apenas os itens de menu para atualizar o ecrã
        const allMenu = await db.menuItems.toArray();
        setMenu(allMenu);
      }
    } catch (err) {
      console.error('Erro ao sincronizar ementa do Supabase:', err);
    }
  };

  const loadData = async () => {
    let allTables = await db.restaurantTables.toArray();
    
    // Correção: Remover mesas duplicadas com o mesmo número (pode ocorrer durante duplo seed)
    const tableMap = new Map<number, RestaurantTable>();
    const duplicateIds: number[] = [];
    
    for (const table of allTables) {
      if (!tableMap.has(table.number)) {
        tableMap.set(table.number, table);
      } else {
        duplicateIds.push(table.id!);
      }
    }
    
    if (duplicateIds.length > 0) {
      await db.restaurantTables.bulkDelete(duplicateIds);
      allTables = await db.restaurantTables.toArray();
    }

    const allMenu = await db.menuItems.toArray();
    const allCompletedOrders = await db.orders.where({ status: 'completed' }).toArray();
    const allHoldOrders = await db.orders.where({ status: 'on_hold' }).toArray();
    const allPaymentMethods = await db.paymentMethods.orderBy('sortOrder').toArray();
    
    // Remover duplicados por nome para exibição
    const uniquePaymentMethods: typeof allPaymentMethods = [];
    const seenNames = new Set();
    for (const method of allPaymentMethods) {
      if (!seenNames.has(method.name)) {
        seenNames.add(method.name);
        uniquePaymentMethods.push(method);
      }
    }
    
    setTables(allTables.sort((a, b) => a.number - b.number));
    setMenu(allMenu);
    setCompletedOrders(allCompletedOrders.sort((a, b) => b.createdAt - a.createdAt));
    setHoldOrders(allHoldOrders.sort((a, b) => b.createdAt - a.createdAt));
    setPaymentMethods(uniquePaymentMethods);

    // Se houver uma mesa selecionada, recarrega o estado dela
    if (selectedTable) {
      const updatedTable = allTables.find(t => t.id === selectedTable.id);
      if (updatedTable) {
        setSelectedTable(updatedTable);
        loadActiveOrder(updatedTable.id!);
      }
    }
  };

  // Carregar pedido ativo para a mesa selecionada
  const loadActiveOrder = async (tableId: number) => {
    const order = await db.orders
      .where({ tableId, status: 'active' })
      .first();
    setActiveOrder(order || null);
  };

  // Selecionar uma mesa
  const handleSelectTable = async (table: RestaurantTable) => {
    setSelectedTable(table);
    await loadActiveOrder(table.id!);
  };

  // Adicionar item ao pedido ativo da mesa
  const handleAddItemToOrder = async (menuItem: MenuItem) => {
    if (!selectedTable) return;

    let order = activeOrder;

    // Se a mesa estiver livre, muda o estado para ocupada e cria um novo pedido
    if (selectedTable.status === 'free') {
      const newOrder: Order = {
        tableId: selectedTable.id!,
        items: [],
        status: 'active',
        total: 0,
        createdAt: Date.now()
      };
      const orderId = await db.orders.add(newOrder);
      order = { ...newOrder, id: orderId };

      await db.restaurantTables.update(selectedTable.id!, { status: 'occupied' });
      // Criar ação na fila de sincronização offline-outbox
      await db.syncQueue.add({
        action: 'update_table',
        payload: JSON.stringify({ id: selectedTable.id, status: 'occupied' }),
        status: 'pending',
        createdAt: Date.now()
      });
    }

    if (!order) return;

    const existingItemIdx = order.items.findIndex(item => item.id === menuItem.id);
    const updatedItems = [...order.items];

    if (existingItemIdx > -1) {
      updatedItems[existingItemIdx].quantity += 1;
    } else {
      updatedItems.push({
        id: menuItem.id!,
        name: menuItem.name,
        price: menuItem.price,
        quantity: 1
      });
    }

    const newTotal = parseFloat(
      updatedItems.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)
    );

    await db.orders.update(order.id!, { items: updatedItems, total: newTotal });
    await db.restaurantTables.update(selectedTable.id!, { currentOrderTotal: newTotal });

    // Registar na fila de sincronização
    await db.syncQueue.add({
      action: 'create_order',
      payload: JSON.stringify({ id: order.id, items: updatedItems, total: newTotal }),
      status: 'pending',
      createdAt: Date.now()
    });

    loadData();
    syncOfflineData(); // Tenta sincronizar imediatamente com o Supabase
  };

  // Remover item completamente do pedido
  const handleRemoveItem = async (menuItemId: number) => {
    if (!activeOrder || !selectedTable) return;

    const updatedItems = activeOrder.items.filter(item => item.id !== menuItemId);

    const newTotal = parseFloat(
      updatedItems.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)
    );

    if (updatedItems.length === 0) {
      // Se não restarem itens, o pedido é apagado e a mesa fica livre
      await db.orders.delete(activeOrder.id!);
      await db.restaurantTables.update(selectedTable.id!, { status: 'free', currentOrderTotal: 0 });
      setActiveOrder(null);
    } else {
      await db.orders.update(activeOrder.id!, { items: updatedItems, total: newTotal });
      await db.restaurantTables.update(selectedTable.id!, { currentOrderTotal: newTotal });
    }

    loadData();
  };

  // Modificar quantidade de item no pedido
  const handleUpdateQuantity = async (menuItemId: number, delta: number) => {
    if (!activeOrder || !selectedTable) return;

    const updatedItems = activeOrder.items.map(item => {
      if (item.id === menuItemId) {
        const newQty = item.quantity + delta;
        return newQty > 0 ? { ...item, quantity: newQty } : null;
      }
      return item;
    }).filter(Boolean) as OrderItem[];

    const newTotal = parseFloat(
      updatedItems.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)
    );

    if (updatedItems.length === 0) {
      // Se não restarem itens, o pedido é apagado e a mesa fica livre
      await db.orders.delete(activeOrder.id!);
      await db.restaurantTables.update(selectedTable.id!, { status: 'free', currentOrderTotal: 0 });
      setActiveOrder(null);
    } else {
      await db.orders.update(activeOrder.id!, { items: updatedItems, total: newTotal });
      await db.restaurantTables.update(selectedTable.id!, { currentOrderTotal: newTotal });
    }

    loadData();
  };

  const handleSaveCustomer = async () => {
    if (!activeOrder) return;
    
    const updatedOrder = {
      ...activeOrder,
      customerName: customerNameInput,
      customerNif: customerNifInput
    };
    
    await db.orders.update(activeOrder.id!, updatedOrder);
    setActiveOrder(updatedOrder);
    setIsEnteringCustomer(false);
  };

  const handleRemoveCustomer = async () => {
    if (!activeOrder) return;
    
    const updatedOrder = {
      ...activeOrder,
      customerName: undefined,
      customerNif: undefined
    };
    
    await db.orders.update(activeOrder.id!, updatedOrder);
    setActiveOrder(updatedOrder);
    setCustomerNameInput('');
    setCustomerNifInput('');
  };

  // Pedir conta (Mudar estado da mesa para "payment_pending")
  const handleRequestBill = async () => {
    if (!selectedTable) return;
    await db.restaurantTables.update(selectedTable.id!, { status: 'payment_pending' });
    
    await db.syncQueue.add({
      action: 'update_table',
      payload: JSON.stringify({ id: selectedTable.id, status: 'payment_pending' }),
      status: 'pending',
      createdAt: Date.now()
    });

    loadData();
    syncOfflineData(); // Tenta sincronizar imediatamente com o Supabase
  };

  // Fechar conta - abre o modal de seleção de forma de pagamento
  const handleCheckout = () => {
    if (!selectedTable || !activeOrder || activeOrder.items.length === 0) return;
    setShowCheckoutModal(true);
  };

  // Confirmar pagamento com forma de pagamento selecionada
  const handleConfirmPayment = async (paymentMethodName: string) => {
    if (!selectedTable || !activeOrder) return;

    await db.orders.update(activeOrder.id!, { 
      status: 'completed',
      paymentMethod: paymentMethodName
    });
    await db.restaurantTables.update(selectedTable.id!, { status: 'free', currentOrderTotal: 0 });
    
    await db.syncQueue.add({
      action: 'complete_order',
      payload: JSON.stringify({ id: activeOrder.id, tableId: selectedTable.id, paymentMethod: paymentMethodName }),
      status: 'pending',
      createdAt: Date.now()
    });

    setShowCheckoutModal(false);
    setActiveOrder(null);
    setSelectedTable(null);
    loadData();
    syncOfflineData(); // Tenta sincronizar imediatamente com o Supabase
  };

  // Adicionar nova forma de pagamento
  const handleAddPaymentMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPaymentName.trim()) return;
    const count = await db.paymentMethods.count();
    await db.paymentMethods.add({
      name: newPaymentName.trim(),
      icon: newPaymentIcon || '💳',
      active: true,
      sortOrder: count + 1
    });
    setNewPaymentName('');
    setNewPaymentIcon('💳');
    loadData();
  };

  // Ativar / Desativar forma de pagamento
  const handleTogglePaymentMethod = async (method: PaymentMethod) => {
    await db.paymentMethods.update(method.id!, { active: !method.active });
    loadData();
  };

  // Eliminar forma de pagamento
  const handleDeletePaymentMethod = async (id: number) => {
    if (confirm('Tem a certeza que deseja eliminar esta forma de pagamento?')) {
      await db.paymentMethods.delete(id);
      loadData();
    }
  };

  // Colocar conta do balcão em espera (on_hold)
  const handlePutOrderOnHold = async () => {
    if (!activeOrder || !selectedTable) return;

    const defaultName = `Balcão #${holdOrders.length + 1}`;
    const name = prompt("Introduza o nome do cliente ou nota para a conta em espera:", defaultName) || defaultName;

    // Atualiza status do pedido para 'on_hold'
    await db.orders.update(activeOrder.id!, { 
      status: 'on_hold',
      customerName: name 
    });

    // Liberta a mesa virtual 0
    await db.restaurantTables.update(selectedTable.id!, { 
      status: 'free', 
      currentOrderTotal: 0 
    });

    setActiveOrder(null);
    setSelectedTable(null);
    loadData();
  };

  // Retomar uma conta em espera
  const handleResumeHoldOrder = async (order: Order) => {
    let counterTable = tables.find(t => t.number === 0);
    if (!counterTable) {
      const id = await db.restaurantTables.add({ number: 0, status: 'free', currentOrderTotal: 0 });
      counterTable = { id, number: 0, status: 'free', currentOrderTotal: 0 };
    }

    if (counterTable.status !== 'free') {
      alert("Já tem um pedido ativo no balcão. Feche ou coloque esse pedido em espera antes de retomar outro!");
      return;
    }

    // Altera status de volta para 'active'
    await db.orders.update(order.id!, { status: 'active' });
    await db.restaurantTables.update(counterTable.id!, { 
      status: 'occupied', 
      currentOrderTotal: order.total 
    });

    setSelectedTable(counterTable);
    setActiveOrder({ ...order, status: 'active' });
    loadData();
  };

  // Eliminar conta em espera cancelada
  const handleDeleteHoldOrder = async (e: React.MouseEvent, orderId: number) => {
    e.stopPropagation(); // Evita que clique para retomar
    if (confirm("Tem a certeza que deseja eliminar esta conta em espera?")) {
      await db.orders.delete(orderId);
      loadData();
    }
  };

  // Arquivar vendas para Fecho do Dia
  const handleArchiveZReport = async () => {
    if (confirm("Tem a certeza que deseja fechar o dia? Todas as vendas atuais serão arquivadas e os totais serão zerados para o próximo turno.")) {
      const ordersToArchive = await db.orders.where({ status: 'completed' }).toArray();
      for (const order of ordersToArchive) {
        await db.orders.update(order.id!, { status: 'archived' });
      }
      
      // Registar ação de arquivamento de faturas em massa na fila de sincronização
      await db.syncQueue.add({
        action: 'archive_orders',
        payload: JSON.stringify({ ids: ordersToArchive.map(o => o.id) }),
        status: 'pending',
        createdAt: Date.now()
      });

      setShowZReportModal(false);
      loadData();
      
      // Sincronizar instantaneamente com o Supabase se houver internet
      syncOfflineData();
    }
  };

  // Forçar Sincronização Real com o Supabase
  const handleForceSync = () => {
    setIsSyncing(true);
    syncMenuFromSupabase(); // Sincronizar ementa ativamente
    
    // Executar a sincronização de todas as vendas e mesas históricas + pendentes em paralelo
    Promise.all([
      syncAllHistoricalOrders(),
      syncOfflineData()
    ])
      .then(() => {
        setIsSyncing(false);
        loadData();
        alert("Sincronização concluída! Todas as mesas e vendas locais foram sincronizadas com o Supabase.");
      })
      .catch(err => {
        console.error("Erro na sincronização forçada:", err);
        setIsSyncing(false);
        loadData();
      });
  };

  // Restaurar Base de Dados a partir do Supabase (Disaster Recovery manual)
  const handleRestoreFromSupabase = () => {
    if (!navigator.onLine) {
      alert("Erro: Precisa de estar ligado à Internet para restaurar os dados do Supabase!");
      return;
    }

    const confirmRestore = window.confirm(
      "Aviso: Esta ação irá APAGAR TODOS os dados locais deste navegador (artigos, mesas, vendas e formas de pagamento) e irá repô-los com a informação guardada na sua última sincronização com o Supabase. Tem a certeza que deseja continuar?"
    );

    if (!confirmRestore) return;

    setIsSyncing(true);
    restoreDataFromSupabase()
      .then((success) => {
        setIsSyncing(false);
        if (success) {
          loadData();
          alert("Recuperação concluída! Toda a informação do Supabase foi reposta com sucesso nesta aplicação.");
        } else {
          alert("O Supabase não contém dados ou ocorreu um erro durante a recuperação. Os dados locais não foram alterados.");
        }
      })
      .catch(err => {
        console.error("Erro na recuperação de dados:", err);
        setIsSyncing(false);
        alert("Ocorreu um erro ao restaurar os dados: " + err.message);
      });
  };

  // Processar carregamento de ficheiro local de imagem e converter para Base64
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert("A imagem selecionada é demasiado grande. Por favor, escolha uma imagem com menos de 2MB.");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewItemImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Gravar Artigo (Criação ou Atualização)
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName || !newItemPrice) return;
    
    const priceNum = parseFloat(newItemPrice);

    if (editingItemId) {
      // Modo Edição
      console.log('A tentar atualizar item no Supabase:', editingItemId, { name: newItemName });
      try {
        const { error } = await supabase
          .from('menu_items')
          .update({
            name: newItemName,
            price: priceNum,
            category: newItemCategory,
            image: newItemImage || undefined
          })
          .eq('id', editingItemId);
          
        console.log('Resultado do update no Supabase:', { error });
          
        if (error) console.error('Erro ao atualizar no Supabase:', error);
      } catch (err) {
        console.error('Erro ao ligar ao Supabase:', err);
      }

      await db.menuItems.update(editingItemId, {
        name: newItemName,
        price: priceNum,
        category: newItemCategory,
        image: newItemImage || undefined
      });
      setEditingItemId(null);
    } else {
      // Modo Criação
      let newId;
      try {
        const { data, error } = await supabase
          .from('menu_items')
          .insert({
            name: newItemName,
            price: priceNum,
            category: newItemCategory,
            image: newItemImage || undefined
          })
          .select('id')
          .single();
          
        if (!error && data) {
          newId = data.id;
        } else if (error) {
          console.error('Erro ao inserir no Supabase:', error);
        }
      } catch (err) {
        console.error('Erro ao ligar ao Supabase:', err);
      }

      await db.menuItems.add({
        id: newId,
        name: newItemName,
        price: priceNum,
        category: newItemCategory,
        image: newItemImage || undefined
      });
    }
    
    setNewItemName('');
    setNewItemPrice('');
    setNewItemCategory('Comidas');
    setNewItemImage('');
    loadData();
  };

  // Iniciar Edição de Artigo
  const handleStartEditItem = (item: MenuItem) => {
    setEditingItemId(item.id || null);
    setNewItemName(item.name);
    setNewItemPrice(item.price.toString());
    setNewItemCategory(item.category);
    setNewItemImage(item.image || '');
  };

  // Cancelar Edição de Artigo
  const handleCancelEditItem = () => {
    setEditingItemId(null);
    setNewItemName('');
    setNewItemPrice('');
    setNewItemCategory('Comidas');
    setNewItemImage('');
  };

  // Remover artigo
  const handleDeleteItem = async (itemId: number) => {
    if (confirm("Tem a certeza que deseja eliminar este artigo?")) {
      await db.menuItems.delete(itemId);
      loadData();
    }
  };

  // Configurar quantidade de mesas
  const handleUpdateTableCount = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetCount = parseInt(tableCountInput);
    if (isNaN(targetCount) || targetCount < 1 || targetCount > 100) {
      alert('Por favor introduza um número entre 1 e 100.');
      return;
    }

    const physicalTables = tables.filter(t => t.number !== 0);
    const currentCount = physicalTables.length;

    if (targetCount > currentCount) {
      // Adicionar novas mesas
      const newTables = [];
      const existingNumbers = new Set(physicalTables.map(t => t.number));
      let next = 1;
      while (newTables.length < targetCount - currentCount) {
        if (!existingNumbers.has(next)) {
          newTables.push({ number: next, status: 'free' as const, currentOrderTotal: 0 });
        }
        next++;
      }
      await db.restaurantTables.bulkAdd(newTables);
    } else if (targetCount < currentCount) {
      // Remover mesas livres (só as que não estão ocupadas)
      const toRemove = physicalTables
        .filter(t => t.status === 'free' && t.currentOrderTotal === 0)
        .sort((a, b) => b.number - a.number)
        .slice(0, currentCount - targetCount);

      if (toRemove.length < currentCount - targetCount) {
        alert(`Apenas ${toRemove.length} mesa(s) livre(s) podem ser removidas. Mesas ocupadas ou com pedidos ativos não foram alteradas.`);
      }
      for (const table of toRemove) {
        await db.restaurantTables.delete(table.id!);
      }
    }
    setTableCountInput('');
    loadData();
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'Comidas': return <UtensilsCrossed className="w-5 h-5" />;
      case 'Bebidas': return <Coffee className="w-5 h-5" />;
      case 'Sobremesas': return <IceCream className="w-5 h-5" />;
      case 'Entradas': return <Soup className="w-5 h-5" />;
      default: return <UtensilsCrossed className="w-5 h-5" />;
    }
  };

  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    localStorage.setItem('theme', newTheme ? 'dark' : 'light');
  };

  const renderVendasArtigo = () => {
    const filteredOrders = completedOrders.filter(order => {
      const orderDate = new Date(order.createdAt);
      const start = startDateFilter ? new Date(startDateFilter) : null;
      const end = endDateFilter ? new Date(endDateFilter) : null;
      if (end) end.setHours(23, 59, 59, 999);
      
      if (start && orderDate < start) return false;
      if (end && orderDate > end) return false;
      return true;
    });

    const itemSalesMap = new Map<string, { name: string, price: number, quantity: number, total: number }>();
    
    filteredOrders.forEach(order => {
      order.items.forEach(item => {
        const key = item.id?.toString() || item.name;
        const existing = itemSalesMap.get(key) || { name: item.name, price: item.price, quantity: 0, total: 0 };
        existing.quantity += item.quantity;
        existing.total += item.quantity * item.price;
        itemSalesMap.set(key, existing);
      });
    });
    
    const sortedSales = Array.from(itemSalesMap.values()).sort((a, b) => b.total - a.total);
    const totalUnits = sortedSales.reduce((sum, item) => sum + item.quantity, 0);
    const totalVal = sortedSales.reduce((sum, item) => sum + item.total, 0);
    
    return (
      <div className="space-y-6">
        {/* Filtro de Datas */}
        <div className="bg-white dark:bg-slate-900/30 p-4 rounded-2xl border border-slate-900/5 dark:border-white/5 flex flex-col sm:flex-row gap-4 items-end">
          <div className="space-y-1 flex-1">
            <label className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600">Data Início</label>
            <input 
              type="date" 
              value={startDateFilter}
              onChange={(e) => setStartDateFilter(e.target.value)}
              onClick={(e) => { if ('showPicker' in e.currentTarget) e.currentTarget.showPicker(); }}
              className="w-full bg-slate-100/60 dark:bg-slate-950 light:bg-white border border-slate-900/10 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>
          <div className="space-y-1 flex-1">
            <label className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600">Data Fim</label>
            <input 
              type="date" 
              value={endDateFilter}
              onChange={(e) => setEndDateFilter(e.target.value)}
              onClick={(e) => { if ('showPicker' in e.currentTarget) e.currentTarget.showPicker(); }}
              className="w-full bg-slate-100/60 dark:bg-slate-950 light:bg-white border border-slate-900/10 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>
          <button
            onClick={() => { setStartDateFilter(''); setEndDateFilter(''); }}
            className="glass-interactive px-4 py-2.5 rounded-xl text-xs text-slate-600 dark:text-slate-400 font-semibold"
          >
            Limpar
          </button>
        </div>

        {/* Cards de Resumo */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white dark:bg-slate-900/30 p-5 rounded-2xl border border-slate-900/5 dark:border-white/5">
            <span className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600 block tracking-wider mb-1">Total Faturado (Valor)</span>
            <span className="text-3xl font-extrabold text-brand-700 dark:text-brand-300">
              {totalVal.toFixed(2)}€
            </span>
          </div>
          <div className="bg-white dark:bg-slate-900/30 p-5 rounded-2xl border border-slate-900/5 dark:border-white/5">
            <span className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600 block tracking-wider mb-1">Total de Unidades</span>
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {totalUnits}
            </span>
          </div>
        </div>

        {/* Tabela de Vendas por Artigo */}
        <div className="border border-slate-900/5 dark:border-white/5 rounded-2xl overflow-hidden bg-white/50 dark:bg-slate-900/10">
          <div className="max-h-[60vh] overflow-y-auto">
            {sortedSales.length === 0 ? (
              <div className="p-10 text-center text-slate-600 dark:text-slate-500 text-xs">
                Ainda não foram registadas vendas para o período selecionado.
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100/80 dark:bg-slate-950/40 border-b border-slate-900/5 dark:border-white/5 text-[10px] uppercase text-slate-500 dark:text-slate-400 light:text-slate-600 font-bold">
                    <th className="p-3">Artigo</th>
                    <th className="p-3 text-right">Valor Unitário</th>
                    <th className="p-3 text-right">Unidades</th>
                    <th className="p-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900/5 dark:divide-white/5 text-sm text-slate-900 dark:text-white">
                  {sortedSales.map((sale, index) => (
                    <tr key={index} className="hover:bg-slate-900/5 dark:hover:bg-white/5 transition-colors">
                      <td className="p-3 font-semibold">{sale.name}</td>
                      <td className="p-3 text-right">{sale.price.toFixed(2)}€</td>
                      <td className="p-3 text-right font-bold">{sale.quantity}</td>
                      <td className="p-3 text-right font-extrabold text-brand-700 dark:text-brand-300">{sale.total.toFixed(2)}€</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100/40 dark:bg-slate-950/20 border-t border-slate-900/10 dark:border-white/10 text-sm font-extrabold text-slate-900 dark:text-white">
                    <td className="p-3 font-bold">Total Geral</td>
                    <td className="p-3 text-right text-slate-400 font-medium">—</td>
                    <td className="p-3 text-right font-extrabold text-slate-900 dark:text-white">{totalUnits}</td>
                    <td className="p-3 text-right text-brand-700 dark:text-brand-300 font-extrabold">{totalVal.toFixed(2)}€</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderVendas = () => {
    const filteredOrders = completedOrders.filter(order => {
      const orderDate = new Date(order.createdAt);
      const start = startDateFilter ? new Date(startDateFilter) : null;
      const end = endDateFilter ? new Date(endDateFilter) : null;
      if (end) end.setHours(23, 59, 59, 999);
      
      if (start && orderDate < start) return false;
      if (end && orderDate > end) return false;
      return true;
    });
    
    return (
      <div className="space-y-6">
        {/* Filtro de Datas */}
        <div className="bg-white dark:bg-slate-900/30 p-4 rounded-2xl border border-slate-900/5 dark:border-white/5 flex flex-col sm:flex-row gap-4 items-end">
          <div className="space-y-1 flex-1">
            <label className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600">Data Início</label>
            <input 
              type="date" 
              value={startDateFilter}
              onChange={(e) => setStartDateFilter(e.target.value)}
              onClick={(e) => { if ('showPicker' in e.currentTarget) e.currentTarget.showPicker(); }}
              className="w-full bg-slate-100/60 dark:bg-slate-950 light:bg-white border border-slate-900/10 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>
          <div className="space-y-1 flex-1">
            <label className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600">Data Fim</label>
            <input 
              type="date" 
              value={endDateFilter}
              onChange={(e) => setEndDateFilter(e.target.value)}
              onClick={(e) => { if ('showPicker' in e.currentTarget) e.currentTarget.showPicker(); }}
              className="w-full bg-slate-100/60 dark:bg-slate-950 light:bg-white border border-slate-900/10 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>
          <button
            onClick={() => { setStartDateFilter(''); setEndDateFilter(''); }}
            className="glass-interactive px-4 py-2.5 rounded-xl text-xs text-slate-600 dark:text-slate-400 font-semibold"
          >
            Limpar
          </button>
        </div>

        {/* Cards de Resumo */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-slate-900/30 p-5 rounded-2xl border border-slate-900/5 dark:border-white/5">
            <span className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600 block tracking-wider mb-1">Total Faturado (Valor)</span>
            <span className="text-3xl font-extrabold text-brand-700 dark:text-brand-300">
              {filteredOrders.reduce((sum, o) => sum + o.total, 0).toFixed(2)}€
            </span>
          </div>
          <div className="bg-white dark:bg-slate-900/30 p-5 rounded-2xl border border-slate-900/5 dark:border-white/5">
            <span className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600 block tracking-wider mb-1">Total de Unidades</span>
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {filteredOrders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0)}
            </span>
          </div>
          <div className="bg-white dark:bg-slate-900/30 p-5 rounded-2xl border border-slate-900/5 dark:border-white/5">
            <span className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600 block tracking-wider mb-1">Número de Vendas</span>
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {filteredOrders.length}
            </span>
          </div>
        </div>

        {/* Tabela de Vendas Concluídas */}
        <div className="space-y-3">
          <h4 className="font-semibold text-slate-900 dark:text-white text-sm">Histórico de Transações</h4>
          <div className="border border-slate-900/5 dark:border-white/5 rounded-2xl overflow-hidden bg-white/50 dark:bg-slate-900/10">
            <div className="max-h-[40vh] overflow-y-auto">
              {filteredOrders.length === 0 ? (
                <div className="p-10 text-center text-slate-600 dark:text-slate-500 text-xs">
                  Ainda não foram registadas vendas concluídas para o período selecionado.
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100/80 dark:bg-slate-950/40 border-b border-slate-900/5 dark:border-white/5 text-[10px] uppercase text-slate-500 dark:text-slate-400 light:text-slate-600 font-bold">
                      <th className="p-3">ID / Data</th>
                      <th className="p-3">Origem</th>
                      <th className="p-3">Artigos</th>
                      <th className="p-3">Pagamento</th>
                      <th className="p-3 text-right">Total</th>
                      <th className="p-3 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/5 dark:divide-white/5 text-sm text-slate-900 dark:text-white">
                    {filteredOrders.map(order => (
                      <tr key={order.id} className="hover:bg-slate-900/5 dark:hover:bg-white/5 transition-colors">
                        <td className="p-3">
                          <span className="font-bold block text-xs">#{order.id}</span>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 light:text-slate-600">
                            {new Date(order.createdAt).toLocaleString('pt-PT')}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-slate-900/5 dark:border-white/5">
                            {order.tableId === 0 ? "Balcão" : `Mesa ${order.tableId}`}
                          </span>
                        </td>
                        <td className="p-3 text-xs max-w-[180px] truncate" title={order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}>
                          {order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                        </td>
                        <td className="p-3">
                          {order.paymentMethod ? (() => {
                            const pm = paymentMethods.find(m => m.name === order.paymentMethod);
                            return (
                              <span className="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 text-slate-200 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-slate-900/5 dark:border-white/5">
                                <span>{pm?.icon ?? '💳'}</span>
                                <span>{order.paymentMethod}</span>
                              </span>
                            );
                          })() : (
                            <span className="text-[10px] text-slate-600 italic">—</span>
                          )}
                        </td>
                        <td className="p-3 font-extrabold text-brand-700 dark:text-brand-300 text-right">{order.total.toFixed(2)}€</td>
                        <td className="p-3 text-center">
                          <button 
                            onClick={() => handlePrintReceipt(order)}
                            className="text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 flex items-center justify-center gap-1 mx-auto"
                          >
                            <Printer className="w-4 h-4" />
                            <span className="text-xs font-semibold">Talão</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100/40 dark:bg-slate-950/20 border-t border-slate-900/10 dark:border-white/10 text-sm font-extrabold text-slate-900 dark:text-white">
                      <td className="p-3 font-bold" colSpan={4}>Total Geral</td>
                      <td className="p-3 text-right text-brand-700 dark:text-brand-300 font-extrabold">{filteredOrders.reduce((sum, o) => sum + o.total, 0).toFixed(2)}€</td>
                      <td className="p-3"></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const handlePrintList = () => {
    let title = '';
    let headers: string[] = [];
    let rows: string[][] = [];
    let summaryHtml = '';
    let tfootHtml = '';

    const filteredOrders = completedOrders.filter(order => {
      const orderDate = new Date(order.createdAt);
      const start = startDateFilter ? new Date(startDateFilter) : null;
      const end = endDateFilter ? new Date(endDateFilter) : null;
      if (end) end.setHours(23, 59, 59, 999);
      
      if (start && orderDate < start) return false;
      if (end && orderDate > end) return false;
      return true;
    });

    if (adminTab === 'vendas_artigo') {
      title = 'Vendas por Artigo';
      headers = ['Artigo', 'Valor Unitário', 'Unidades', 'Total'];
      
      const itemSalesMap = new Map<string, { name: string, price: number, quantity: number, total: number }>();
      filteredOrders.forEach(order => {
        order.items.forEach(item => {
          const key = item.id?.toString() || item.name;
          const existing = itemSalesMap.get(key) || { name: item.name, price: item.price, quantity: 0, total: 0 };
          existing.quantity += item.quantity;
          existing.total += item.quantity * item.price;
          itemSalesMap.set(key, existing);
        });
      });
      const sortedSales = Array.from(itemSalesMap.values()).sort((a, b) => b.total - a.total);
      
      const printTotalUnits = sortedSales.reduce((sum, item) => sum + item.quantity, 0);
      const printTotalValue = sortedSales.reduce((sum, item) => sum + item.total, 0);

      rows = sortedSales.map(sale => [
        sale.name,
        `${sale.price.toFixed(2)}€`,
        sale.quantity.toString(),
        `${sale.total.toFixed(2)}€`
      ]);

      summaryHtml = `
        <div class="summary-box">
          <div><strong>Total Faturado (Valor):</strong> ${printTotalValue.toFixed(2)}€</div>
          <div><strong>Total de Unidades:</strong> ${printTotalUnits}</div>
        </div>
      `;

      tfootHtml = `
        <tfoot>
          <tr class="tfoot-row">
            <td>Total Geral</td>
            <td class="text-right">—</td>
            <td class="text-right">${printTotalUnits}</td>
            <td class="text-right">${printTotalValue.toFixed(2)}€</td>
          </tr>
        </tfoot>
      `;
    } else if (adminTab === 'vendas') {
      title = 'Histórico de Vendas';
      headers = ['ID / Data', 'Origem', 'Artigos', 'Pagamento', 'Total'];
      
      const printTotalUnits = filteredOrders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0);
      const printTotalValue = filteredOrders.reduce((sum, o) => sum + o.total, 0);

      rows = filteredOrders.map(order => [
        `#${order.id} - ${new Date(order.createdAt).toLocaleString('pt-PT')}`,
        order.tableId === 0 ? "Balcão" : `Mesa ${order.tableId}`,
        order.items.map(i => `${i.quantity}x ${i.name}`).join(', '),
        order.paymentMethod || '—',
        `${order.total.toFixed(2)}€`
      ]);

      summaryHtml = `
        <div class="summary-box">
          <div><strong>Total Faturado (Valor):</strong> ${printTotalValue.toFixed(2)}€</div>
          <div><strong>Total de Unidades:</strong> ${printTotalUnits}</div>
          <div><strong>Número de Vendas:</strong> ${filteredOrders.length}</div>
        </div>
      `;

      tfootHtml = `
        <tfoot>
          <tr class="tfoot-row">
            <td colspan="4">Total Geral</td>
            <td class="text-right">${printTotalValue.toFixed(2)}€</td>
          </tr>
        </tfoot>
      `;
    } else if (adminTab === 'artigos') {
      title = 'Lista de Artigos';
      headers = ['ID', 'Nome', 'Categoria', 'Preço'];
      rows = menu.map((item: any) => [
        item.id?.toString() || '—',
        item.name,
        item.category,
        `${item.price.toFixed(2)}€`
      ]);
    } else {
      return; // Nada para imprimir nas outras abas
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const html = `
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { font-family: sans-serif; padding: 20px; color: #333; }
            h1 { font-size: 20px; margin-bottom: 5px; }
            p { font-size: 12px; color: #666; margin-bottom: 15px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
            th { background-color: #f5f5f5; font-weight: bold; }
            .text-right { text-align: right; }
            .summary-box {
              display: flex;
              gap: 20px;
              background-color: #f9f9f9;
              border: 1px solid #ddd;
              border-radius: 8px;
              padding: 10px 15px;
              margin-bottom: 15px;
              font-size: 13px;
            }
            .tfoot-row {
              font-weight: bold;
              background-color: #f5f5f5;
            }
            .tfoot-row td {
              border-top: 2px solid #333;
            }
            @media print {
              body { padding: 0; }
              button { display: none; }
            }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          <p>Gerado em: ${new Date().toLocaleString('pt-PT')}</p>
          ${startDateFilter || endDateFilter ? `<p>Período: ${startDateFilter || 'Sempre'} até ${endDateFilter || 'Sempre'}</p>` : ''}
          
          ${summaryHtml}

          <table>
            <thead>
              <tr>
                ${headers.map(h => `<th>${h}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows.map(row => `
                <tr>
                  ${row.map((cell, idx) => `<td class="${idx === row.length - 1 || (adminTab === 'vendas_artigo' && idx === 2) ? 'text-right' : ''}">${cell}</td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
            ${tfootHtml}
          </table>
          <script>
            window.onload = () => { window.print(); window.close(); };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  const handlePrintReceipt = (order: Order) => {
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) return;

    const html = `
      <html>
        <head>
          <title>Talão #${order.id}</title>
          <style>
            body { 
              font-family: 'Courier New', Courier, monospace; 
              padding: 10px; 
              color: #000; 
              width: 300px; 
              margin: 0 auto;
              font-size: 12px;
            }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .bold { font-weight: bold; }
            .divider { border-top: 1px dashed #000; margin: 10px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            td { padding: 4px 0; }
            .header { font-size: 16px; font-weight: bold; margin-bottom: 5px; }
            .flex { display: flex; }
            .justify-between { justify-content: space-between; }
            @media print {
              body { padding: 0; }
            }
          </style>
        </head>
        <body>
          <div class="text-center header">MOBILITY POS</div>
          <div class="text-center">Restaurante & Bar</div>
          <div class="divider"></div>
          
          <div>Talão: #${order.id}</div>
          <div>Data: ${new Date(order.createdAt).toLocaleString('pt-PT')}</div>
          <div>Origem: ${order.tableId === 0 ? "Balcão" : `Mesa ${order.tableId}`}</div>
          
          ${order.customerName ? `<div>Cliente: ${order.customerName}</div>` : ''}
          ${order.customerNif ? `<div>NIF: ${order.customerNif}</div>` : ''}
          
          <div class="divider"></div>
          
          <table>
            <thead>
              <tr class="bold">
                <td>Qtd</td>
                <td>Artigo</td>
                <td class="text-right">Total</td>
              </tr>
            </thead>
            <tbody>
              ${order.items.map(item => `
                <tr>
                  <td>${item.quantity}x</td>
                  <td>${item.name}</td>
                  <td class="text-right">${(item.quantity * item.price).toFixed(2)}€</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          <div class="divider"></div>
          
          <div class="bold flex justify-between">
            <span>TOTAL:</span>
            <span class="text-right">${order.total.toFixed(2)}€</span>
          </div>
          
          ${order.paymentMethod ? `<div>Pagamento: ${order.paymentMethod}</div>` : ''}
          
          <div class="divider"></div>
          <div class="text-center">Obrigado pela preferência!</div>
          <div class="text-center">Volte sempre!</div>
          
          <script>
            window.onload = () => { window.print(); window.close(); };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* HEADER */}
      <header className="glass flex justify-between items-center px-6 py-4 z-10 border-b border-slate-900/5 dark:border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center shadow-lg shadow-brand-500/20 active-table">
            <LayoutGrid className="w-6 h-6 text-slate-900 dark:text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              Mobility POS <span className="text-[10px] uppercase font-semibold bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-300 px-2 py-0.5 rounded border border-brand-200 dark:border-brand-800">Restauração</span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 light:text-slate-600">Terminal de Vendas Offline-First</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Status do Supabase / Conetividade */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
            isOnline 
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
              : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
          }`}>
            {isOnline ? (
              <>
                <Wifi className="w-4 h-4" />
                <span>Supabase Sincronizado</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4" />
                <span>Modo Local / Offline</span>
              </>
            )}
          </div>

          {/* Botão de Fecho de Caixa (Z-Report) */}
          <button 
            onClick={() => setShowZReportModal(true)}
            className="bg-brand-500 hover:bg-brand-600 text-slate-900 dark:text-white shadow-lg shadow-brand-500/20 active-table flex items-center justify-center p-2.5 rounded-xl transition-all"
            title="Fecho de Caixa e Histórico"
          >
            <Receipt className="w-5 h-5" />
          </button>

          {/* Botão de Sincronização manual */}
          <button 
            onClick={handleForceSync}
            disabled={isSyncing}
            className="glass-interactive flex items-center justify-center p-2.5 rounded-xl text-brand-700 dark:hover:text-brand-300 disabled:opacity-50 text-slate-700 dark:text-slate-300"
            title="Sincronizar Dados"
          >
            <RefreshCw className={`w-5 h-5 ${isSyncing ? 'animate-spin text-brand-400' : ''}`} />
          </button>

          {/* Botão de Restaurar Dados do Supabase */}
          <button 
            onClick={handleRestoreFromSupabase}
            disabled={isSyncing}
            className="glass-interactive flex items-center justify-center p-2.5 rounded-xl text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 disabled:opacity-50"
            title="Restaurar Dados do Supabase"
          >
            <Download className={`w-5 h-5 ${isSyncing ? 'animate-pulse' : ''}`} />
          </button>

          {/* Botão de Alternar Tema (Dark/Light) */}
          <button 
            onClick={toggleTheme}
            className="glass-interactive flex items-center justify-center p-2.5 rounded-xl text-indigo-500 hover:text-indigo-600 dark:text-amber-400 dark:hover:text-amber-300 transition-colors"
            title={isDarkMode ? "Ativar Modo Claro" : "Ativar Modo Escuro"}
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

          {/* Botão de Gestão de Artigos */}
          <button 
            onClick={() => setShowAdminModal(true)}
            className="glass-interactive flex items-center justify-center p-2.5 rounded-xl text-brand-700 dark:hover:text-brand-300 text-slate-700 dark:text-slate-300"
            title="Gestão de Artigos"
          >
            <Settings className="w-5 h-5" />
          </button>

          {/* Botão de Sair / Logout */}
          <button 
            onClick={() => supabase.auth.signOut()}
            className="glass-interactive flex items-center justify-center p-2.5 rounded-xl text-rose-500 hover:text-rose-400 dark:text-rose-400 dark:hover:text-rose-300 transition-colors"
            title="Sair da sessão"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* DASHBOARD PRINCIPAL */}
      <main className="flex flex-1 overflow-hidden">
        {/* SEÇÃO ESQUERDA: Mesas ou Ecrã de Menu */}
        <section className="flex-[3] p-6 bg-slate-100/50 dark:bg-slate-950/20 flex flex-col overflow-hidden">
          {!selectedTable ? (
            <div className="flex flex-col h-full">
              {/* Botão de Venda Direta / Balcão */}
              <div className="flex gap-4 mb-6 flex-shrink-0">
                <button
                  onClick={handleSelectCounter}
                  className="glass-interactive flex items-center justify-between p-5 rounded-2xl flex-1 border border-brand-500/20 dark:border-brand-500/10 text-slate-900 dark:text-white bg-gradient-to-r from-brand-100/50 dark:from-brand-950/20 to-indigo-100/50 dark:to-indigo-950/20 text-left hover:border-brand-500/30"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-brand-500/20 border border-brand-500/30 rounded-xl flex items-center justify-center shadow-lg shadow-brand-500/5">
                      <Coffee className="w-6 h-6 text-brand-600 dark:text-brand-400" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Atendimento ao Balcão / Take-Away</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 light:text-slate-600">Venda direta rápida, sem ocupação de mesa física</p>
                    </div>
                  </div>
                  
                  {tables.find(t => t.number === 0)?.currentOrderTotal ? (
                    <div className="text-right">
                      <span className="text-[10px] text-brand-700 dark:text-brand-300 block font-semibold uppercase tracking-wider">Em Aberto</span>
                      <span className="text-xl font-extrabold text-slate-900 dark:text-white">
                        {tables.find(t => t.number === 0)?.currentOrderTotal.toFixed(2)}€
                      </span>
                    </div>
                  ) : (
                    <span className="text-[10px] font-semibold bg-brand-500/10 text-brand-700 dark:text-brand-300 border border-brand-500/20 px-3 py-1 rounded-full">
                      Balcão Livre
                    </span>
                  )}
                </button>
              </div>


              <h2 className="text-lg font-semibold mb-4 text-slate-900 dark:text-white flex items-center gap-2 flex-shrink-0">
                <LayoutGrid className="w-5 h-5 text-brand-600 dark:text-brand-400" />
                Disposição da Sala
              </h2>
              
              <div className="flex-1 overflow-y-auto pr-2 pb-4 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {tables.filter(t => t.number !== 0).map(table => {
                  let statusColor = 'bg-white dark:bg-slate-900 border-slate-900/5 dark:border-white/5 hover:border-slate-900/10 dark:hover:border-white/10 text-slate-900 dark:text-slate-300';
                  let badge = 'Livre';
                  let badgeColor = 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400';

                  if (table.status === 'occupied') {
                    statusColor = 'bg-brand-50 dark:bg-brand-950/30 border-brand-500/20 dark:border-brand-500/30 hover:border-brand-500/30 dark:hover:border-brand-500/50 text-brand-900 dark:text-white';
                    badge = 'Ocupada';
                    badgeColor = 'bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 border border-brand-500/20 dark:border-brand-500/30';
                  } else if (table.status === 'payment_pending') {
                    statusColor = 'bg-amber-50 dark:bg-amber-950/20 border-amber-500/20 dark:border-amber-500/30 hover:border-amber-500/30 dark:hover:border-amber-500/50 text-amber-900 dark:text-white';
                    badge = 'Conta Pedida';
                    badgeColor = 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/20 dark:border-amber-500/30 animate-pulse';
                  }

                  return (
                    <button
                      key={table.id}
                      onClick={() => handleSelectTable(table)}
                      className={`glass-interactive flex flex-col justify-between p-4 rounded-2xl min-h-[7rem] h-auto text-left border ${statusColor}`}
                    >
                      <div className="flex flex-wrap justify-between items-start w-full gap-1 mb-2">
                        <span className="text-lg font-bold tracking-tight min-w-0 truncate">Mesa {table.number}</span>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap ${badgeColor}`}>
                          {badge}
                        </span>
                      </div>
                      
                      {table.currentOrderTotal > 0 && (
                        <div className="mt-auto pt-2">
                          <span className="text-xs text-slate-500 dark:text-slate-400 block">Subtotal</span>
                          <span className="text-xl font-bold text-slate-900 dark:text-white">
                            {table.currentOrderTotal.toFixed(2)}€
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
                </div>
              </div>

              {/* Contas em Espera no Balcão (Posicionadas Abaixo das Mesas) */}
              {holdOrders.length > 0 && (
                <div className="flex-shrink-0 mt-2 border-t border-slate-900/5 dark:border-indigo-500/10 pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Coffee className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Contas em Espera ({holdOrders.length})
                    </span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-2 snap-x scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                    {holdOrders.map(order => (
                      <div
                        key={order.id}
                        onClick={() => handleResumeHoldOrder(order)}
                        className="group glass-interactive cursor-pointer bg-white dark:bg-indigo-950/20 border border-slate-900/10 dark:border-indigo-500/20 hover:border-indigo-500/40 dark:hover:border-indigo-400/50 hover:bg-slate-50 dark:hover:bg-indigo-950/40 rounded-xl transition-all flex-shrink-0 flex items-center gap-3 px-3 py-2 snap-start"
                        style={{ minWidth: '180px', maxWidth: '200px' }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-indigo-200 truncate leading-tight">
                            {order.customerName || 'Em Espera'}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400">
                              {new Date(order.createdAt).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="text-[10px] text-brand-700 dark:text-brand-400 font-bold">
                              {order.total.toFixed(2)}€
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleDeleteHoldOrder(e, order.id!)}
                          className="w-7 h-7 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-500 dark:text-rose-400 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all opacity-0 group-hover:opacity-100 flex-shrink-0"
                          title="Eliminar"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // MENU DE SELEÇÃO DE ARTIGOS
            <div className="flex flex-col h-full overflow-hidden">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <button 
                    onClick={() => { setSelectedTable(null); setActiveOrder(null); }}
                    className="text-xs text-brand-600 dark:text-brand-400 text-brand-700 dark:hover:text-brand-300 flex items-center gap-1 mb-1 font-medium"
                  >
                    ← Voltar às Mesas
                  </button>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                    {selectedTable.number === 0 ? "Menu: Atendimento ao Balcão" : `Menu: Mesa ${selectedTable.number}`}
                  </h2>
                </div>

                {/* Categorias */}
                <div className="flex gap-2 bg-white dark:bg-slate-900/60 p-1.5 rounded-xl border border-slate-900/5 dark:border-white/5">
                  {(['Entradas', 'Comidas', 'Bebidas', 'Sobremesas'] as const).map(cat => (
                    <button
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                        activeCategory === cat 
                          ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/10' 
                          : 'text-slate-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {getCategoryIcon(cat)}
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Grelha de Itens de Menu */}
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 overflow-y-auto flex-1 pb-4 pr-2">
                {menu.filter(item => item.category === activeCategory).map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleAddItemToOrder(item)}
                    className="glass-interactive flex flex-col p-2.5 rounded-xl text-left border border-slate-900/5 dark:border-white/5 h-36 hover:border-brand-500/30 transition-all flex-shrink-0"
                  >
                    {/* Imagem ou Gradiente de Categoria */}
                    <div className="w-full h-14 rounded-lg overflow-hidden mb-1.5 relative bg-slate-100 dark:bg-slate-950 flex items-center justify-center border border-slate-900/5 dark:border-white/5 p-0.5">
                      {item.image ? (
                        <img 
                          src={item.image} 
                          alt={item.name} 
                          className="max-w-full max-h-full object-contain rounded-lg"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-slate-900 to-slate-950 flex items-center justify-center rounded-lg">
                          <div className="text-slate-600 opacity-60">
                            {getCategoryIcon(item.category)}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 flex flex-col justify-between w-full">
                      <h3 className="text-[11px] font-bold text-slate-900 dark:text-white leading-tight line-clamp-2" title={item.name}>
                        {item.name}
                      </h3>
                      
                      <div className="flex justify-between items-center mt-1 w-full">
                        <span className="text-xs font-extrabold text-brand-700 dark:text-brand-300">
                          {item.price.toFixed(2)}€
                        </span>
                        <span className="w-6 h-6 rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400 flex items-center justify-center font-bold text-sm hover:bg-brand-500 hover:text-slate-900 dark:hover:text-white light:text-slate-900 transition-all">
                          +
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Contas em Espera no Balcão - fila horizontal compacta */}
              {selectedTable.number === 0 && holdOrders.length > 0 && (
                <div className="border-t border-indigo-500/10 pt-3 mt-1 pb-1 flex-shrink-0">
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <Coffee className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                    <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600 uppercase tracking-wider">
                      Em Espera ({holdOrders.length})
                    </span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-2 pr-2 snap-x scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                    {holdOrders.map(order => (
                      <div
                        key={order.id}
                        onClick={() => handleResumeHoldOrder(order)}
                        className="group glass-interactive cursor-pointer bg-white dark:bg-indigo-950/20 border border-slate-900/10 dark:border-indigo-500/20 hover:border-indigo-500/40 dark:hover:border-indigo-400/50 hover:bg-slate-50 dark:hover:bg-indigo-950/40 rounded-xl transition-all flex-shrink-0 flex items-center gap-2 px-3 py-2 snap-start"
                        style={{ minWidth: '160px', maxWidth: '180px' }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-900 dark:text-indigo-200 truncate leading-tight">
                            {order.customerName || 'Em Espera'}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[9px] text-slate-500 dark:text-slate-400">
                              {new Date(order.createdAt).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="text-[9px] text-brand-700 dark:text-brand-400 font-bold">
                              {order.total.toFixed(2)}€
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleDeleteHoldOrder(e, order.id!)}
                          className="w-5 h-5 rounded-md bg-rose-500/10 text-rose-400 flex items-center justify-center hover:bg-rose-500 hover:text-slate-900 dark:hover:text-white light:text-slate-900 transition-all opacity-0 group-hover:opacity-100 flex-shrink-0"
                          title="Eliminar"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* SEÇÃO DIREITA: Carrinho / Pedido Ativo / Faturação */}
        <aside className="w-[380px] border-l border-slate-900/5 dark:border-white/5 glass flex flex-col justify-between h-full bg-white/50 dark:bg-slate-900/10">
          {selectedTable ? (
            <div className="flex flex-col h-full justify-between">
              {/* Cabeçalho do Carrinho */}
              <div className="p-5 border-b border-slate-900/5 dark:border-white/5 flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-lg">
                    {selectedTable.number === 0 ? "Venda Direta / Balcão" : `Mesa ${selectedTable.number}`}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 light:text-slate-600">
                    {selectedTable.status === 'free' ? 'Novo Pedido' : 'Pedido em Curso'}
                  </p>
                </div>
                <div className={`w-3 h-3 rounded-full ${
                  selectedTable.status === 'occupied' 
                    ? 'bg-brand-400 shadow-lg shadow-brand-400/50' 
                    : selectedTable.status === 'payment_pending'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-slate-600'
                }`} />
              </div>

              {/* Secção de Cliente */}
              {activeOrder && (
                <div className="px-5 py-3 border-b border-slate-900/5 dark:border-white/5 bg-slate-50/50 dark:bg-slate-900/50">
                  {isEnteringCustomer ? (
                    <div className="space-y-2">
                      <input 
                        type="text" 
                        placeholder="Nome do Cliente"
                        value={customerNameInput}
                        onChange={(e) => setCustomerNameInput(e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-900/10 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-brand-500 transition-colors"
                      />
                      <input 
                        type="text" 
                        placeholder="NIF / Contribuinte"
                        value={customerNifInput}
                        onChange={(e) => setCustomerNifInput(e.target.value)}
                        maxLength={9}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-900/10 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-brand-500 transition-colors"
                      />
                      <div className="flex gap-2 justify-end">
                        <button 
                          onClick={() => setIsEnteringCustomer(false)}
                          className="px-3 py-1 text-xs font-semibold text-slate-500 dark:text-slate-400"
                        >
                          Cancelar
                        </button>
                        <button 
                          onClick={() => handleSaveCustomer()}
                          className="px-3 py-1 text-xs font-semibold bg-brand-500 text-slate-900 dark:text-white rounded-lg"
                        >
                          Gravar
                        </button>
                      </div>
                    </div>
                  ) : activeOrder.customerName || activeOrder.customerNif ? (
                    <div className="flex justify-between items-center text-xs">
                      <div>
                        {activeOrder.customerName && <span className="font-semibold text-slate-900 dark:text-white block">Cliente: {activeOrder.customerName}</span>}
                        {activeOrder.customerNif && <span className="text-slate-500 dark:text-slate-400">NIF: {activeOrder.customerNif}</span>}
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => {
                            setCustomerNameInput(activeOrder.customerName || '');
                            setCustomerNifInput(activeOrder.customerNif || '');
                            setIsEnteringCustomer(true);
                          }}
                          className="text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-semibold"
                        >
                          Editar
                        </button>
                        <button 
                          onClick={() => handleRemoveCustomer()}
                          className="text-red-500 hover:text-red-600 font-semibold"
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button 
                      onClick={() => setIsEnteringCustomer(true)}
                      className="w-full flex items-center justify-center gap-2 py-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
                    >
                      <UserPlus className="w-4 h-4" />
                      Associar Cliente / NIF
                    </button>
                  )}
                </div>
              )}

              {/* Lista de Itens do Pedido */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {activeOrder && activeOrder.items.length > 0 ? (
                  activeOrder.items.map(item => (
                    <div key={item.id} className="flex justify-between items-center bg-white dark:bg-slate-900/30 p-3 rounded-xl border border-slate-900/5 dark:border-white/5">
                      <div className="flex-1 pr-3">
                        <h4 className="font-semibold text-slate-900 dark:text-white text-sm">{item.name}</h4>
                        <span className="text-xs text-brand-700 dark:text-brand-300">{item.price.toFixed(2)}€/un</span>
                      </div>

                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => handleUpdateQuantity(item.id, -1)}
                          className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-700 text-slate-900 dark:text-white flex items-center justify-center transition-colors"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="font-bold text-slate-900 dark:text-white text-sm w-4 text-center">{item.quantity}</span>
                        <button 
                          onClick={() => handleUpdateQuantity(item.id, 1)}
                          className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-700 text-slate-900 dark:text-white flex items-center justify-center transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <button 
                          onClick={() => handleRemoveItem(item.id)}
                          className="w-7 h-7 ml-1 rounded-lg bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-500 text-rose-500 dark:text-rose-400 hover:text-white flex items-center justify-center transition-colors"
                          title="Remover Artigo"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-600 dark:text-slate-500">
                    <p className="text-sm font-medium">O carrinho está vazio</p>
                    <p className="text-xs mt-1">Selecione artigos no menu para começar</p>
                  </div>
                )}
              </div>

              {/* Totais e Operações */}
              <div className="p-5 border-t border-slate-900/5 dark:border-white/5 space-y-4 bg-slate-100/50 dark:bg-slate-950/20">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 light:text-slate-600">
                    <span>Subtotal</span>
                    <span>{activeOrder ? (activeOrder.total * 0.77).toFixed(2) : '0.00'}€</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 light:text-slate-600">
                    <span>Taxa / IVA (23%)</span>
                    <span>{activeOrder ? (activeOrder.total * 0.23).toFixed(2) : '0.00'}€</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-900 dark:text-white border-t border-slate-900/5 dark:border-white/5 pt-2 mt-1">
                    <span className="font-bold">Total a Pagar</span>
                    <span className="text-2xl font-extrabold text-slate-900 dark:text-white">
                      {activeOrder ? activeOrder.total.toFixed(2) : '0.00'}€
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2">
                  {selectedTable.number === 0 ? (
                    <button
                      onClick={handlePutOrderOnHold}
                      disabled={!activeOrder || activeOrder.items.length === 0}
                      className="glass-interactive py-3 px-4 rounded-xl font-bold text-xs text-center border border-indigo-500/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/10 hover:border-indigo-500/40 disabled:opacity-50 disabled:pointer-events-none"
                    >
                      Colocar em Espera
                    </button>
                  ) : selectedTable.status === 'occupied' ? (
                    <button
                      onClick={handleRequestBill}
                      disabled={!activeOrder || activeOrder.items.length === 0}
                      className="glass-interactive py-3 px-4 rounded-xl font-bold text-xs text-center border border-amber-500/20 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 hover:border-amber-500/40 disabled:opacity-50 disabled:pointer-events-none"
                    >
                      Pedir Conta
                    </button>
                  ) : (
                    <div className="bg-amber-100 dark:bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-[10px] py-2 px-3 rounded-xl flex items-center justify-center font-bold uppercase animate-pulse">
                      Conta Solicitada
                    </div>
                  )}

                  <button
                    onClick={handleCheckout}
                    disabled={!activeOrder || activeOrder.items.length === 0}
                    className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-slate-900 dark:text-white font-bold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-brand-500/20 active-table transition-all disabled:pointer-events-none"
                  >
                    <DollarSign className="w-4 h-4" />
                    Fechar e Pagar
                  </button>
                </div>
                
                <button
                  onClick={() => { setSelectedTable(null); setActiveOrder(null); }}
                  className="w-full text-center text-xs text-slate-500 dark:text-slate-400 light:text-slate-600 hover:text-slate-900 dark:hover:text-white light:text-slate-900 py-1.5 transition-colors"
                >
                  Fechar Painel Lateral
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-600 dark:text-slate-500">
              <div className="w-16 h-16 bg-white dark:bg-slate-900 rounded-2xl flex items-center justify-center mb-4 border border-slate-900/5 dark:border-white/5">
                <UtensilsCrossed className="w-8 h-8 text-slate-600" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">Nenhuma Mesa Selecionada</h3>
              <p className="text-xs mt-1 max-w-[240px]">
                Escolha uma mesa à esquerda para abrir um novo pedido, ver o carrinho ativo ou fechar contas.
              </p>
            </div>
          )}
        </aside>
      </main>

      {/* MODAL DE GESTÃO DE ARTIGOS */}
      {showAdminModal && (
        <div className="fixed inset-0 bg-slate-100/80 dark:bg-slate-950 bg-white/50 dark:light:bg-slate-900/10 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass max-w-5xl w-full max-h-[85vh] rounded-3xl overflow-hidden flex flex-col border border-slate-900/10 dark:border-white/10 shadow-2xl">
            {/* Cabeçalho do Modal */}
            <div className="p-6 border-b border-slate-900/5 dark:border-white/5 flex justify-between items-center bg-white/40 dark:bg-slate-900 light:bg-slate-50">
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Settings className="w-5 h-5 text-brand-600 dark:text-brand-400" />
                  Administração do POS
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 light:text-slate-600">Gerir artigos do menu e consultar o histórico de vendas</p>
              </div>
              <button 
                onClick={() => setShowAdminModal(false)}
                className="w-9 h-9 rounded-xl glass-interactive flex items-center justify-center text-slate-500 dark:text-slate-400 light:text-slate-600 hover:text-slate-900 dark:hover:text-white light:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Separadores do Painel */}
            <div className="flex gap-2 px-6 pt-4 bg-white/80 dark:bg-slate-900/20 border-b border-slate-900/5 dark:border-white/5">
              <button
                onClick={() => setAdminTab('artigos')}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl border-b-2 transition-all ${
                  adminTab === 'artigos' 
                    ? 'border-brand-500 text-brand-400 bg-brand-500/5' 
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Gestão de Artigos
              </button>
              <button
                onClick={() => setAdminTab('vendas')}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl border-b-2 transition-all ${
                  adminTab === 'vendas' 
                    ? 'border-brand-500 text-brand-400 bg-brand-500/5' 
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Histórico de Vendas ({completedOrders.length})
              </button>
              <button
                onClick={() => setAdminTab('vendas_artigo')}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl border-b-2 transition-all ${
                  adminTab === 'vendas_artigo' 
                    ? 'border-brand-500 text-brand-400 bg-brand-500/5' 
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Vendas por Artigo
              </button>
              <button
                onClick={() => setAdminTab('pagamentos')}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl border-b-2 transition-all ${
                  adminTab === 'pagamentos' 
                    ? 'border-brand-500 text-brand-400 bg-brand-500/5' 
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Formas de Pagamento
              </button>
              <button
                onClick={() => setAdminTab('configuracoes')}
                className={`px-4 py-2 text-xs font-bold rounded-t-xl border-b-2 transition-all ${
                  adminTab === 'configuracoes' 
                    ? 'border-brand-500 text-brand-400 bg-brand-500/5' 
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Configurações
              </button>
            </div>

            <div className="p-6 flex-1 flex flex-col min-h-0 overflow-y-auto">
              {adminTab === 'artigos' ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start flex-1 min-h-0">
                  {/* Coluna Esquerda: Formulário CRUD */}
                  <div className="lg:col-span-5 space-y-4 overflow-y-auto max-h-full pr-2">
                    <form onSubmit={handleSaveItem} className={`p-5 rounded-2xl border transition-all space-y-4 ${editingItemId ? 'bg-amber-950/10 border-amber-500/30' : 'bg-slate-900/30 border-white/5'}`}>
                      <h4 className="font-semibold text-sm flex justify-between items-center text-slate-900 dark:text-white">
                        <span>{editingItemId ? `Editar Artigo` : "Adicionar Novo Artigo"}</span>
                        {editingItemId && (
                          <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded uppercase font-bold tracking-wider animate-pulse">
                            Modo Edição
                          </span>
                        )}
                      </h4>
                      
                      <div className="space-y-3">
                        {/* Nome */}
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600">Nome do Artigo</label>
                          <input 
                            type="text" 
                            placeholder="Ex: Tarte de Maçã" 
                            value={newItemName}
                            onChange={(e) => setNewItemName(e.target.value)}
                            required
                            className="w-full bg-slate-100/60 dark:bg-slate-950 light:bg-white border border-slate-900/10 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-brand-500 transition-colors"
                          />
                        </div>

                        {/* Preço */}
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600">Preço (€)</label>
                          <input 
                            type="number" 
                            step="0.01" 
                            placeholder="Ex: 4.50" 
                            value={newItemPrice}
                            onChange={(e) => setNewItemPrice(e.target.value)}
                            required
                            className="w-full bg-slate-100/60 dark:bg-slate-950 light:bg-white border border-slate-900/10 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-brand-500 transition-colors"
                          />
                        </div>

                        {/* Categoria */}
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600">Categoria</label>
                          <select 
                            value={newItemCategory}
                            onChange={(e) => setNewItemCategory(e.target.value as any)}
                            className="w-full bg-slate-100/60 dark:bg-slate-950 light:bg-white border border-slate-900/10 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-brand-500 transition-colors"
                          >
                            <option value="Comidas">Comidas</option>
                            <option value="Bebidas">Bebidas</option>
                            <option value="Sobremesas">Sobremesas</option>
                            <option value="Entradas">Entradas</option>
                          </select>
                        </div>
                      </div>

                      {/* Foto do Artigo */}
                      <div className="space-y-1 bg-slate-100/50 dark:bg-slate-950/20 p-4 rounded-xl border border-slate-900/5 dark:border-white/5">
                        <label className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600 block tracking-wider">Foto do Artigo (Opcional)</label>
                        <div className="flex flex-col gap-3">
                          <div className="flex items-center gap-4">
                            <input 
                              type="file" 
                              accept="image/*" 
                              onChange={handleImageChange}
                              className="hidden" 
                              id="item-image-upload"
                            />
                            <label 
                              htmlFor="item-image-upload"
                              className="glass-interactive px-4 py-2.5 rounded-xl text-xs text-brand-700 dark:text-brand-300 border border-brand-500/20 hover:border-brand-500/40 cursor-pointer font-semibold flex items-center gap-1.5 transition-all w-full justify-center"
                            >
                              <Camera className="w-4 h-4" />
                              Carregar Foto
                            </label>
                          </div>
                          
                          {newItemImage ? (
                            <div className="flex items-center justify-between bg-slate-100/80 dark:bg-slate-950/40 p-2 rounded-xl border border-slate-900/5 dark:border-white/5">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-900/10 dark:border-white/10 shadow-lg flex-shrink-0">
                                  <img src={newItemImage} className="w-full h-full object-cover" />
                                </div>
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 light:text-slate-600 font-semibold uppercase">Imagem Selecionada</span>
                              </div>
                              <button 
                                type="button"
                                onClick={() => setNewItemImage('')}
                                className="text-xs text-rose-400 hover:text-rose-300 font-semibold"
                              >
                                Remover
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-600 dark:text-slate-500 text-center block">Exibe placeholder dinâmico</span>
                          )}
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-2">
                        {editingItemId && (
                          <button 
                            type="button"
                            onClick={handleCancelEditItem}
                            className="glass-interactive text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white light:text-slate-900 font-bold px-4 py-2.5 rounded-xl text-xs transition-colors flex-1"
                          >
                            Cancelar
                          </button>
                        )}
                        <button 
                          type="submit"
                          className={`${editingItemId ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/10' : 'bg-brand-500 hover:bg-brand-600 shadow-brand-500/10'} text-white font-bold px-4 py-2.5 rounded-xl text-xs shadow-lg transition-colors flex-1`}
                        >
                          {editingItemId ? "Gravar" : "Adicionar"}
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Coluna Direita: Listagem de Artigos Disponíveis */}
                  <div className="lg:col-span-7 flex flex-col h-full min-h-0 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-slate-900 dark:text-white text-sm">Artigos Disponíveis ({menu.length})</h4>
                    </div>
                    
                    {/* Pesquisa e Filtro de Artigos */}
                    <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white dark:bg-slate-900/30 p-4 rounded-2xl border border-slate-900/5 dark:border-white/5">
                      <div className="relative flex-1 w-full">
                        <Search className="w-4 h-4 text-slate-600 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input 
                          type="text" 
                          placeholder="Pesquisar por nome do artigo..." 
                          value={productSearchQuery}
                          onChange={(e) => setProductSearchQuery(e.target.value)}
                          className="w-full bg-slate-100/60 dark:bg-slate-950 light:bg-white border border-slate-900/10 dark:border-white/10 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-brand-500 transition-colors text-slate-600 dark:placeholder:text-slate-500"
                        />
                      </div>
                      
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <span className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600 whitespace-nowrap">Categoria:</span>
                        <select 
                          value={productCategoryFilter}
                          onChange={(e) => setProductCategoryFilter(e.target.value)}
                          className="bg-slate-100/60 dark:bg-slate-950 light:bg-white border border-slate-900/10 dark:border-white/10 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-brand-500 transition-colors"
                        >
                          <option value="Todos">Todas as Categorias</option>
                          <option value="Comidas">Comidas</option>
                          <option value="Bebidas">Bebidas</option>
                          <option value="Sobremesas">Sobremesas</option>
                          <option value="Entradas">Entradas</option>
                        </select>
                      </div>
                    </div>

                    <div className="border border-slate-900/5 dark:border-white/5 rounded-2xl overflow-hidden bg-white/50 dark:bg-slate-900/10 flex-1 flex flex-col min-h-0">
                      <div className="flex-1 overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-100/80 dark:bg-slate-950/40 border-b border-slate-900/5 dark:border-white/5 text-[10px] uppercase text-slate-500 dark:text-slate-400 light:text-slate-600 font-bold">
                              <th className="p-3">Artigo</th>
                              <th className="p-3">Categoria</th>
                              <th className="p-3">Preço</th>
                              <th className="p-3 text-right">Ações</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-900/5 divide-slate-900/5 dark:divide-white/5 text-sm text-slate-900 dark:text-white">
                            {menu.filter(item => {
                              const matchesSearch = item.name.toLowerCase().includes(productSearchQuery.toLowerCase());
                              const matchesCategory = productCategoryFilter === 'Todos' || item.category === productCategoryFilter;
                              return matchesSearch && matchesCategory;
                            }).map(item => (
                              <tr key={item.id} className="hover:bg-slate-900/5 dark:hover:bg-white/5 transition-colors">
                                <td className="p-3 font-semibold flex items-center gap-3">
                                  {item.image ? (
                                    <div className="w-8 h-8 rounded-lg overflow-hidden border border-slate-900/5 dark:border-white/5 shadow-md flex-shrink-0 bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-0.5">
                                      <img src={item.image} alt={item.name} className="max-w-full max-h-full object-contain rounded" />
                                    </div>
                                  ) : (
                                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-500 flex-shrink-0 border border-slate-900/5 dark:border-white/5">
                                      {getCategoryIcon(item.category)}
                                    </div>
                                  )}
                                  <span>{item.name}</span>
                                </td>
                                <td className="p-3">
                                  <span className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-slate-900/5 dark:border-white/5">
                                    {item.category}
                                  </span>
                                </td>
                                <td className="p-3 font-medium text-brand-700 dark:text-brand-300">{item.price.toFixed(2)}€</td>
                                <td className="p-3 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <button 
                                      onClick={() => handleStartEditItem(item)}
                                      className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center hover:bg-amber-500 hover:text-slate-900 dark:hover:text-white light:text-slate-900 transition-all"
                                      title="Editar Artigo"
                                    >
                                      <Pencil className="w-4 h-4" />
                                    </button>
                                    <button 
                                      onClick={() => handleDeleteItem(item.id!)}
                                      className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center hover:bg-rose-500 hover:text-slate-900 dark:hover:text-white light:text-slate-900 transition-all"
                                      title="Eliminar Artigo"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              ) : adminTab === 'vendas_artigo' ? (
                renderVendasArtigo()
              ) : adminTab === 'pagamentos' ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* Coluna Esquerda: Formulário de Adição */}
                  <div className="lg:col-span-4 space-y-4">
                    <form onSubmit={handleAddPaymentMethod} className="bg-white dark:bg-slate-900/30 p-5 rounded-2xl border border-slate-900/5 dark:border-white/5 space-y-4">
                      <h4 className="font-semibold text-sm text-slate-900 dark:text-white">Adicionar Forma de Pagamento</h4>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600">Emoji / Ícone</label>
                          <input
                            type="text"
                            placeholder="Ex: 💵"
                            value={newPaymentIcon}
                            onChange={(e) => setNewPaymentIcon(e.target.value)}
                            maxLength={4}
                            className="w-full bg-slate-100/60 dark:bg-slate-950 light:bg-white border border-slate-900/10 dark:border-white/10 rounded-xl px-3 py-2 text-2xl text-center focus:outline-none focus:border-brand-500 transition-colors"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600">Nome da Forma de Pagamento</label>
                          <input
                            type="text"
                            placeholder="Ex: Transferência Bancária"
                            value={newPaymentName}
                            onChange={(e) => setNewPaymentName(e.target.value)}
                            required
                            className="w-full bg-slate-100/60 dark:bg-slate-950 light:bg-white border border-slate-900/10 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-brand-500 transition-colors"
                          />
                        </div>
                      </div>
                      <button type="submit" className="w-full bg-brand-500 hover:bg-brand-600 text-slate-900 dark:text-white font-bold px-4 py-2.5 rounded-xl text-xs shadow-lg transition-colors">
                        Adicionar
                      </button>
                    </form>
                    <div className="bg-white/80 dark:bg-slate-900/20 p-4 rounded-2xl border border-slate-900/5 dark:border-white/5">
                      <p className="text-[10px] text-slate-600 dark:text-slate-500 leading-relaxed">
                        <span className="font-bold text-slate-500 dark:text-slate-400 light:text-slate-600 block mb-1">Dica</span>
                        Pode desativar temporariamente uma forma de pagamento clicando no botão de toggle. Apenas as formas <span className="text-emerald-400 font-semibold">ativas</span> aparecem no checkout.
                      </p>
                    </div>
                  </div>

                  <div className="lg:col-span-8 space-y-3">
                    <h4 className="font-semibold text-slate-900 dark:text-white text-sm">Formas de Pagamento Configuradas ({paymentMethods.length})</h4>
                    <div className="border border-slate-900/5 dark:border-white/5 rounded-2xl overflow-hidden bg-white/50 dark:bg-slate-900/10">
                      {paymentMethods.length === 0 ? (
                        <div className="p-10 text-center text-slate-600 dark:text-slate-500 text-xs">Nenhuma forma de pagamento configurada.</div>
                      ) : (
                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                          {paymentMethods.map(method => (
                            <div key={method.id} className="glass-interactive p-4 rounded-xl flex justify-between items-center bg-white dark:bg-slate-900/5 border border-slate-900/5 dark:border-white/5 shadow-sm">
                              <div className="flex items-center gap-3">
                                <span className="text-2xl">{method.icon}</span>
                                <p className={`font-semibold text-sm ${method.active ? 'text-slate-900 dark:text-white' : 'text-slate-500 line-through'}`}>
                                  {method.name}
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleTogglePaymentMethod(method)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                                    method.active
                                      ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500 hover:text-white'
                                      : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-900/10 dark:border-white/10 hover:bg-slate-300 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'
                                  }`}
                                >
                                  {method.active ? 'Ativo' : 'Inativo'}
                                </button>
                                <button
                                  onClick={() => handleDeletePaymentMethod(method.id!)}
                                  className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all"
                                  title="Eliminar"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : adminTab === 'configuracoes' ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                  {/* Bloco de Configuração de Mesas */}
                  <div className="bg-white dark:bg-slate-900/30 p-6 rounded-2xl border border-slate-900/5 dark:border-white/5 space-y-4">
                    <h4 className="font-semibold text-lg text-slate-900 dark:text-white flex items-center gap-2">
                      <LayoutGrid className="w-5 h-5 text-brand-600 dark:text-brand-400" />
                      Disposição da Sala
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 light:text-slate-600">
                      Configure a quantidade de mesas físicas disponíveis no restaurante. O número mínimo é 1.
                      Se reduzir a quantidade, as mesas extra só serão eliminadas se estiverem livres.
                    </p>
                    
                    <div className="bg-slate-100/80 dark:bg-slate-950/40 p-5 rounded-xl border border-slate-900/5 dark:border-white/5 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] uppercase font-semibold text-slate-600 dark:text-slate-500 block mb-1">Mesas Físicas Atuais</span>
                        <span className="text-3xl font-bold text-slate-900 dark:text-white">{tables.filter(t => t.number !== 0).length}</span>
                      </div>
                      
                      <form onSubmit={handleUpdateTableCount} className="flex gap-2">
                        <input
                          type="number"
                          min="1"
                          max="100"
                          placeholder="Nova quant..."
                          value={tableCountInput}
                          onChange={(e) => setTableCountInput(e.target.value)}
                          className="w-32 bg-white dark:bg-slate-900 border border-slate-900/10 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-brand-500 transition-colors"
                          required
                        />
                        <button
                          type="submit"
                          className="bg-brand-500 hover:bg-brand-600 text-slate-900 dark:text-white font-bold px-4 py-2 rounded-xl text-sm shadow-lg transition-colors"
                        >
                          Atualizar
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              ) : (
                renderVendas()
              )}
            </div>

            <div className="p-5 border-t border-slate-900/5 dark:border-white/5 bg-slate-100/50 dark:bg-slate-950/20 flex justify-end">
              <button 
                onClick={handlePrintList}
                className="glass-interactive px-5 py-2.5 rounded-xl font-bold text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 mr-2 flex items-center gap-2"
              >
                <Printer className="w-4 h-4" />
                Imprimir Lista
              </button>
              <button 
                onClick={() => setShowAdminModal(false)}
                className="glass-interactive px-5 py-2.5 rounded-xl font-bold text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white light:text-slate-900"
              >
                Fechar Painel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CHECKOUT - Seleção de Forma de Pagamento */}
      {showCheckoutModal && activeOrder && (
        <div className="fixed inset-0 bg-slate-100/90 dark:bg-slate-950 bg-white/80 dark:light:bg-slate-900/20 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="glass max-w-md w-full rounded-3xl overflow-hidden border border-slate-900/10 dark:border-white/10 shadow-2xl">
            {/* Cabeçalho */}
            <div className="p-6 border-b border-slate-900/5 dark:border-white/5 flex justify-between items-center bg-white/40 dark:bg-slate-900 light:bg-slate-50">
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-brand-600 dark:text-brand-400" />
                  Finalizar Pagamento
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 light:text-slate-600">Selecione a forma de pagamento do cliente</p>
              </div>
              <button
                onClick={() => setShowCheckoutModal(false)}
                className="w-9 h-9 rounded-xl glass-interactive flex items-center justify-center text-slate-500 dark:text-slate-400 light:text-slate-600 hover:text-slate-900 dark:hover:text-white light:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Total a Pagar */}
            <div className="px-6 pt-6 pb-4">
              <div className="bg-brand-500/5 border border-brand-500/20 rounded-2xl p-5 text-center">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600 uppercase tracking-wider mb-1">Total a Pagar</p>
                <p className="text-5xl font-extrabold text-slate-900 dark:text-white">{activeOrder.total.toFixed(2)}<span className="text-2xl text-brand-700 dark:text-brand-300 ml-1">€</span></p>
                <p className="text-xs text-slate-600 dark:text-slate-500 mt-2">
                  {activeOrder.items.length} artigo(s) &middot; {selectedTable?.number === 0 ? 'Balcão' : `Mesa ${selectedTable?.number}`}
                </p>
              </div>
            </div>

            {/* Formas de Pagamento */}
            <div className="px-6 pb-6 space-y-3">
              <p className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 light:text-slate-600 tracking-wider">Forma de Pagamento</p>
              {paymentMethods.filter(m => m.active).length === 0 ? (
                <div className="text-center text-slate-600 dark:text-slate-500 text-xs py-6">
                  Nenhuma forma de pagamento ativa. Configure no painel de Administração.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {paymentMethods.filter(m => m.active).map(method => (
                    <button
                      key={method.id}
                      onClick={() => handleConfirmPayment(method.name)}
                      className="glass-interactive flex flex-col items-center gap-2 p-4 rounded-2xl border border-slate-900/5 dark:border-white/5 hover:border-brand-500/40 hover:bg-brand-500/5 transition-all group"
                    >
                      <span className="text-3xl">{method.icon}</span>
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:group-hover:text-white light:text-slate-900 transition-colors text-center leading-tight">{method.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <ZReportModal 
        showZReportModal={showZReportModal}
        setShowZReportModal={setShowZReportModal}
        completedOrders={completedOrders}
        handleArchiveZReport={handleArchiveZReport}
        selectedReceiptId={selectedReceiptId}
        setSelectedReceiptId={setSelectedReceiptId}
      />
    </div>
  );
}
