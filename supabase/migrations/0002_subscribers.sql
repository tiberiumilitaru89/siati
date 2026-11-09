-- ============================================================================
-- MIGRAȚIE 0002: ABONAȚI NEWSLETTER (dovada consimțământului GDPR)
-- Rulează în Supabase → SQL Editor, DUPĂ 0001_init_siati.sql.
--
-- Fără această tabelă, abonările din footer și din checkout NU se salvează în producție.
-- Accesul se face exclusiv server-side cu SUPABASE_SERVICE_ROLE_KEY (RLS activ, fără politici
-- pentru rolurile anon/authenticated => default-deny).
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY CHECK (
    email = LOWER(email) AND char_length(email) BETWEEN 3 AND 254
  ),
  name TEXT CHECK (name IS NULL OR char_length(name) <= 100),
  source TEXT NOT NULL DEFAULT 'footer' CHECK (source IN ('checkout', 'footer', 'popup')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed')),
  preferences JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_order_product TEXT,
  opted_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- data primului consimțământ
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;

-- Index util pentru facturile care așteaptă emitere manuală (smartbill_number lipsă):
--   SELECT * FROM orders WHERE status = 'paid' AND smartbill_number IS NULL ORDER BY created_at;
CREATE INDEX IF NOT EXISTS idx_orders_pending_invoice
  ON orders (created_at)
  WHERE smartbill_number IS NULL;
