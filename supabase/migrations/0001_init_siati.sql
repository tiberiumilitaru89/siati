-- ============================================================================
-- MIGRAȚIE CANONICĂ: FLORĂRIA SIATI (ASTRO + SUPABASE + STRIPE + SMARTBILL SPV)
-- Conform Modulelor 3, 6 și 7 (Ledger BIGINT, RLS Default-Deny, OUG 34/2014)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Tabel Produse (Catalogul Florăria Siati)
CREATE TABLE IF NOT EXISTS products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 150),
  slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  description TEXT NOT NULL DEFAULT '',
  price_bani BIGINT NOT NULL CHECK (price_bani > 0), -- Ex: 19000 = 190.00 RON
  category TEXT NOT NULL CHECK (
    category IN ('buchete', 'nunti', 'cutii', 'botez', 'corporate', 'funerare', 'ghiveci')
  ),
  badge TEXT,
  image_url TEXT NOT NULL,
  in_stock BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Tabel Pop-up "Oferta Săptămânii"
CREATE TABLE IF NOT EXISTS weekly_offer (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  description TEXT NOT NULL DEFAULT '',
  price_bani BIGINT NOT NULL CHECK (price_bani > 0),
  image_url TEXT NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Registrul Imutabil de Comenzi & Consimțământ Juridic OUG 34/2014 (Ledger)
CREATE TABLE IF NOT EXISTS orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL, -- Stripe Event / Checkout Session ID
  stripe_session_id TEXT,
  product_id UUID NOT NULL REFERENCES products(id),
  amount_bani BIGINT NOT NULL CHECK (amount_bani > 0),
  surcharge_bani BIGINT NOT NULL DEFAULT 0 CHECK (surcharge_bani >= 0),
  currency TEXT NOT NULL DEFAULT 'ron' CHECK (LOWER(currency) IN ('ron', 'eur')),
  delivery_zone TEXT NOT NULL DEFAULT 'ploiesti' CHECK (
    delivery_zone IN ('ploiesti', 'limitrophe', 'prahova_extins')
  ),
  delivery_slot TEXT NOT NULL DEFAULT 'standard_2_3h' CHECK (
    delivery_slot IN (
      'standard_2_3h',
      'morning_0830_1230',
      'afternoon_1230_1700',
      'evening_1700_2100',
      'next_day_0830_1230'
    )
  ),
  express_immediate BOOLEAN NOT NULL DEFAULT false,
  after_hours_vip BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'paid', 'invoiced_spv', 'fulfilled', 'failed')
  ),
  require_whatsapp_photo BOOLEAN NOT NULL DEFAULT true,
  customer_email TEXT,
  customer_phone TEXT,
  shipping_address_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  perishable_consent_accepted BOOLEAN NOT NULL CHECK (perishable_consent_accepted = true),
  perishable_consent_at TIMESTAMPTZ NOT NULL,
  terms_version TEXT NOT NULL DEFAULT 'v2026.11',
  smartbill_series TEXT,
  smartbill_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Jurnal de Audit Imutabil (SOC 2 / ISO 27001 Readiness - Modulul 7.6)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN ('CREATE', 'UPDATE', 'DELETE', 'CHECKOUT_INIT', 'WEBHOOK_PAID', 'SPV_INVOICED')
  ),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  after_state JSONB,
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Activare Row Level Security (Default-Deny)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_offer ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Politici Citire Publică (Vizitatori anonimi)
CREATE POLICY "Publicul poate citi produsele"
  ON products FOR SELECT
  USING (true);

CREATE POLICY "Publicul poate citi oferta saptamanii"
  ON weekly_offer FOR SELECT
  USING (is_active = true);

-- Politici Administrare (Doar utilizatori autentificați cu app_metadata.role = 'admin')
CREATE POLICY "Admin CRUD pe products"
  ON products FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "Admin CRUD pe weekly_offer"
  ON weekly_offer FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "Admin citire comenzi"
  ON orders FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "Admin citire audit_logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- 6. Seed Catalog Inițial Florăria Siati Ploiești
INSERT INTO products (id, name, slug, description, price_bani, category, badge, image_url, in_stock)
VALUES
  (
    '11111111-1111-4111-8111-111111111101',
    'Buchetul Monocrom: Lalele Albe',
    'buchet-monocrom-lalele-albe',
    '25 de lalele albe olandeze premium, legate cu panglică din satin și eucalipt proaspăt.',
    19000,
    'buchete',
    'Colecția Semnătură',
    'https://images.unsplash.com/photo-1520763185298-1b434c919102?auto=format&fit=crop&w=900&q=80',
    true
  ),
  (
    '11111111-1111-4111-8111-111111111102',
    'Simfonie Pastel & Eucalipt',
    'simfonie-pastel-eucalipt',
    'Trandafiri de grădină roz pudrat, frezii parfumate și ramuri de eucalipt Cinerea.',
    22000,
    'buchete',
    'Cel mai comandat',
    'https://images.unsplash.com/photo-1561181286-d3fee7d55364?auto=format&fit=crop&w=900&q=80',
    true
  ),
  (
    '11111111-1111-4111-8111-111111111103',
    'Cutie Catifea Dusty Rose',
    'cutie-catifea-dusty-rose',
    'Aranjament în cutie de catifea cu bujori, miniroze și lisianthus alb.',
    26000,
    'cutii',
    'Cadou Premium',
    'https://images.unsplash.com/photo-1582794543139-8ac9cb0f7b11?auto=format&fit=crop&w=900&q=80',
    true
  ),
  (
    '11111111-1111-4111-8111-111111111104',
    'Buchet Mireasă White Grace',
    'buchet-mireasa-white-grace',
    'Buchet de mireasă lucrat manual din trandafiri englezești albi, frezii și gypsophila.',
    35000,
    'nunti',
    'Atelier Nuntă',
    'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?auto=format&fit=crop&w=900&q=80',
    true
  ),
  (
    '11111111-1111-4111-8111-111111111105',
    'Lumânare & Aranjament Cristelniță Botez',
    'lumanare-aranjament-cristelnita-botez',
    'Set festiv de botez cu hortensie albă, trandafiri spray și verdeață nobilă.',
    32000,
    'botez',
    'Botez Ploiești',
    'https://images.unsplash.com/photo-1519378058457-4c29a0a2efac?auto=format&fit=crop&w=900&q=80',
    true
  ),
  (
    '11111111-1111-4111-8111-111111111106',
    'Aranjament Corporate Reception',
    'aranjament-corporate-reception',
    'Design floral arhitectural pentru birouri, clinici și recepții din Ploiești.',
    28000,
    'corporate',
    'B2B & Evenimente',
    'https://images.unsplash.com/photo-1487530811176-3780de880c2d?auto=format&fit=crop&w=900&q=80',
    true
  ),
  (
    '11111111-1111-4111-8111-111111111107',
    'Coroană Funerară pe Suport de Brad Natural',
    'coroana-funerara-brad-natural',
    'Aranjament funerar sobru lucrat pe brad natural cu crini imperiali și trandafiri albi, cu panglică caligrafiată inclusă.',
    29000,
    'funerare',
    'Omagiu & Respect',
    'https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=900&q=80',
    true
  )
ON CONFLICT (slug) DO NOTHING;

INSERT INTO weekly_offer (id, title, description, price_bani, image_url, product_id, is_active)
VALUES (
  '22222222-2222-4222-8222-222222222201',
  'Oferta Săptămânii: Buchetul Monocrom Lalele Albe',
  'Comandă astăzi cu livrare gratuită în Municipiul Ploiești și primești fotografia buchetului real pe WhatsApp înainte de plecarea curierului.',
  19000,
  'https://images.unsplash.com/photo-1520763185298-1b434c919102?auto=format&fit=crop&w=900&q=80',
  '11111111-1111-4111-8111-111111111101',
  true
)
ON CONFLICT (id) DO NOTHING;
