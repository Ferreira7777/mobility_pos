-- =============================================================
-- MOBILITY POS — Script de Migração para Supabase
-- Executa este script no SQL Editor do Supabase:
-- https://supabase.com/dashboard → SQL Editor → New Query
-- =============================================================

-- -------------------------------------------------------
-- 1. TIPOS ENUM (correspondentes às unions do TypeScript)
-- -------------------------------------------------------

CREATE TYPE table_status AS ENUM ('free', 'occupied', 'payment_pending');
CREATE TYPE order_status AS ENUM ('active', 'completed', 'on_hold', 'archived');
CREATE TYPE sync_action_type AS ENUM ('create_order', 'update_table', 'complete_order');
CREATE TYPE sync_status AS ENUM ('pending', 'synced', 'failed');
CREATE TYPE menu_category AS ENUM ('Comidas', 'Bebidas', 'Sobremesas', 'Entradas');

-- -------------------------------------------------------
-- 2. TABELA: menu_items
-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS menu_items (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  price       NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  category    menu_category NOT NULL,
  image       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_menu_items_category ON menu_items (category);

-- -------------------------------------------------------
-- 3. TABELA: restaurant_tables
-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id                  BIGSERIAL PRIMARY KEY,
  number              INTEGER NOT NULL UNIQUE,
  status              table_status NOT NULL DEFAULT 'free',
  current_order_total NUMERIC(10, 2) NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_restaurant_tables_status ON restaurant_tables (status);

-- -------------------------------------------------------
-- 4. TABELA: orders
-- Items são guardados como JSONB (array de OrderItem)
-- Evita tabela extra de order_items, mantendo a lógica
-- equivalente ao Dexie.js onde items é um array embutido.
-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS orders (
  id              BIGSERIAL PRIMARY KEY,
  table_id        INTEGER NOT NULL REFERENCES restaurant_tables(number) ON DELETE SET NULL,
  items           JSONB NOT NULL DEFAULT '[]',
  status          order_status NOT NULL DEFAULT 'active',
  total           NUMERIC(10, 2) NOT NULL DEFAULT 0,
  customer_name   TEXT,
  payment_method  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice composto para queries de pedidos ativos por mesa (equivalente ao [tableId+status] do Dexie)
CREATE INDEX idx_orders_table_status ON orders (table_id, status);
CREATE INDEX idx_orders_created_at   ON orders (created_at DESC);
CREATE INDEX idx_orders_status       ON orders (status);

-- -------------------------------------------------------
-- 5. TABELA: sync_queue
-- Fila de outbox para sincronização offline→online
-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS sync_queue (
  id          BIGSERIAL PRIMARY KEY,
  action      sync_action_type NOT NULL,
  payload     JSONB NOT NULL,
  status      sync_status NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_queue_status ON sync_queue (status);

-- -------------------------------------------------------
-- 6. TABELA: payment_methods
-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS payment_methods (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  icon        TEXT NOT NULL DEFAULT '💳',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- -------------------------------------------------------
-- 7. FUNÇÃO: updated_at automático via trigger
-- -------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_menu_items_updated_at
  BEFORE UPDATE ON menu_items
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_restaurant_tables_updated_at
  BEFORE UPDATE ON restaurant_tables
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- -------------------------------------------------------
-- 8. ROW LEVEL SECURITY (RLS)
-- Ativa RLS em todas as tabelas. Por defeito, bloqueia
-- tudo. Adicionar políticas conforme a autenticação.
-- Para uso apenas com anon key (single-tenant offline):
-- permite leitura e escrita pública.
-- -------------------------------------------------------

ALTER TABLE menu_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_tables  ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_queue         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods    ENABLE ROW LEVEL SECURITY;

-- Política: acesso público total (anon key — POS local sem autenticação)
-- ATENÇÃO: Se implementares autenticação de utilizadores, substitui por
-- políticas baseadas em auth.uid().

CREATE POLICY "public_all_menu_items"        ON menu_items        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all_restaurant_tables" ON restaurant_tables FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all_orders"            ON orders            FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all_sync_queue"        ON sync_queue        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all_payment_methods"   ON payment_methods   FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------
-- 9. DADOS INICIAIS (Seed)
-- Equivalente ao seedDatabase() do Dexie.js
-- -------------------------------------------------------

-- Mesas (1 a 8)
INSERT INTO restaurant_tables (number, status, current_order_total) VALUES
  (0, 'free', 0),  -- Balcão (tableId = 0)
  (1, 'free', 0),
  (2, 'free', 0),
  (3, 'free', 0),
  (4, 'free', 0),
  (5, 'free', 0),
  (6, 'free', 0),
  (7, 'free', 0),
  (8, 'free', 0)
ON CONFLICT (number) DO NOTHING;

-- Ementa padrão
INSERT INTO menu_items (name, price, category) VALUES
  -- Entradas
  ('Pão de Alho com Queijo',    3.50, 'Entradas'),
  ('Pataniscas de Bacalhau',    4.50, 'Entradas'),
  ('Azeitonas Temperadas',      1.80, 'Entradas'),
  -- Comidas
  ('Bacalhau à Brás',          14.50, 'Comidas'),
  ('Francesinha Especial',     12.00, 'Comidas'),
  ('Prego no Prato',           10.50, 'Comidas'),
  ('Arroz de Pato à Antiga',   13.00, 'Comidas'),
  -- Bebidas
  ('Super Bock 33cl',           2.20, 'Bebidas'),
  ('Copo Vinho Tinto',          3.00, 'Bebidas'),
  ('Água das Pedras',           1.80, 'Bebidas'),
  ('Sumo de Laranja Natural',   3.50, 'Bebidas'),
  -- Sobremesas
  ('Pudim Abade de Priscos',    4.50, 'Sobremesas'),
  ('Bolo de Bolacha',           3.80, 'Sobremesas'),
  ('Baba de Camelo',            3.50, 'Sobremesas')
ON CONFLICT DO NOTHING;

-- Formas de Pagamento padrão
INSERT INTO payment_methods (name, icon, active, sort_order) VALUES
  ('Numerário',              '💵', true, 1),
  ('Multibanco',             '🏧', true, 2),
  ('MB Way',                 '📱', true, 3),
  ('Cartão de Débito/Crédito', '💳', true, 4)
ON CONFLICT (name) DO NOTHING;

-- =============================================================
-- FIM DO SCRIPT
-- =============================================================
