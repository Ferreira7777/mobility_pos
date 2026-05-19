import Dexie, { type Table } from 'dexie';

export interface MenuItem {
  id?: number;
  name: string;
  price: number;
  category: 'Comidas' | 'Bebidas' | 'Sobremesas' | 'Entradas';
  image?: string;
}

export interface RestaurantTable {
  id?: number;
  number: number;
  status: 'free' | 'occupied' | 'payment_pending';
  currentOrderTotal: number;
}

export interface OrderItem {
  id: number;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id?: number;
  tableId: number;
  items: OrderItem[];
  status: 'active' | 'completed' | 'on_hold' | 'archived';
  total: number;
  createdAt: number;
  customerName?: string;
  customerNif?: string;
  paymentMethod?: string;
}

export interface SyncAction {
  id?: number;
  action: 'create_order' | 'update_table' | 'complete_order' | 'archive_orders' | 'delete_order';
  payload: string; // JSON string representation
  status: 'pending' | 'synced' | 'failed';
  createdAt: number;
}

export interface PaymentMethod {
  id?: number;
  name: string;
  icon: string;
  active: boolean;
  sortOrder: number;
}

export class MobilityPOSDatabase extends Dexie {
  menuItems!: Table<MenuItem>;
  restaurantTables!: Table<RestaurantTable>;
  orders!: Table<Order>;
  syncQueue!: Table<SyncAction>;
  paymentMethods!: Table<PaymentMethod>;

  constructor() {
    super('MobilityPOSDatabase');
    this.version(1).stores({
      menuItems: '++id, name, category',
      restaurantTables: '++id, number, status',
      orders: '++id, tableId, status, createdAt',
      syncQueue: '++id, action, status, createdAt'
    });
    // Versão 2: Adicionar tabela de formas de pagamento
    this.version(2).stores({
      menuItems: '++id, name, category',
      restaurantTables: '++id, number, status',
      orders: '++id, tableId, status, createdAt',
      syncQueue: '++id, action, status, createdAt',
      paymentMethods: '++id, name, active, sortOrder'
    });
    // Versão 3: Otimização de queries com compound index [tableId+status]
    this.version(3).stores({
      menuItems: '++id, name, category',
      restaurantTables: '++id, number, status',
      orders: '++id, [tableId+status], createdAt',
      syncQueue: '++id, action, status, createdAt',
      paymentMethods: '++id, name, active, sortOrder'
    });
    // Versão 4: Adicionar index individual para 'status' em orders para o Z-Report
    this.version(4).stores({
      menuItems: '++id, name, category',
      restaurantTables: '++id, number, status',
      orders: '++id, [tableId+status], status, createdAt',
      syncQueue: '++id, action, status, createdAt',
      paymentMethods: '++id, name, active, sortOrder'
    });
  }
}

export const db = new MobilityPOSDatabase();

// Injetar dados padrão para a primeira inicialização do POS de Restauração
export async function seedDatabase() {
  const tableCount = await db.restaurantTables.count();
  if (tableCount === 0) {
    await db.restaurantTables.bulkAdd([
      { number: 0, status: 'free', currentOrderTotal: 0 }, // Balcão
      { number: 1, status: 'free', currentOrderTotal: 0 },
      { number: 2, status: 'free', currentOrderTotal: 0 },
      { number: 3, status: 'free', currentOrderTotal: 0 },
      { number: 4, status: 'free', currentOrderTotal: 0 },
      { number: 5, status: 'free', currentOrderTotal: 0 },
      { number: 6, status: 'free', currentOrderTotal: 0 },
      { number: 7, status: 'free', currentOrderTotal: 0 },
      { number: 8, status: 'free', currentOrderTotal: 0 },
    ]);
  }

  const menuCount = await db.menuItems.count();
  if (menuCount === 0) {
    await db.menuItems.bulkAdd([
      // Entradas
      { name: 'Pão de Alho com Queijo', price: 3.50, category: 'Entradas' },
      { name: 'Pataniscas de Bacalhau', price: 4.50, category: 'Entradas' },
      { name: 'Azeitonas Temperadas', price: 1.80, category: 'Entradas' },
      // Comidas
      { name: 'Bacalhau à Brás', price: 14.50, category: 'Comidas' },
      { name: 'Francesinha Especial', price: 12.00, category: 'Comidas' },
      { name: 'Prego no Prato', price: 10.50, category: 'Comidas' },
      { name: 'Arroz de Pato à Antiga', price: 13.00, category: 'Comidas' },
      // Bebidas
      { name: 'Super Bock 33cl', price: 2.20, category: 'Bebidas' },
      { name: 'Copo Vinho Tinto', price: 3.00, category: 'Bebidas' },
      { name: 'Água das Pedras', price: 1.80, category: 'Bebidas' },
      { name: 'Sumo de Laranja Natural', price: 3.50, category: 'Bebidas' },
      // Sobremesas
      { name: 'Pudim Abade de Priscos', price: 4.50, category: 'Sobremesas' },
      { name: 'Bolo de Bolacha', price: 3.80, category: 'Sobremesas' },
      { name: 'Baba de Camelo', price: 3.50, category: 'Sobremesas' },
    ]);
  }

  // Seed das formas de pagamento padrão
  const paymentCount = await db.paymentMethods.count();
  if (paymentCount === 0) {
    await db.paymentMethods.bulkAdd([
      { name: 'Numerário', icon: '💵', active: true, sortOrder: 1 },
      { name: 'Multibanco', icon: '🏧', active: true, sortOrder: 2 },
      { name: 'MB Way', icon: '📱', active: true, sortOrder: 3 },
      { name: 'Cartão de Débito/Crédito', icon: '💳', active: true, sortOrder: 4 },
    ]);
  }
}
