-- Yıllık abonelik: pasif gelirin taşıyıcısı.
--
-- Tek seferlik pilot siparişinden ayrı bir tablo, çünkü ömrü farklı: abonelik
-- her yenilemede YENİ bir sipariş üretir ama müşteri aynı kalır ve elindeki
-- indirme anahtarı değişmemelidir. 30 günlük satın alma çerezi ikinci yılın
-- lisansını teslim edemez; `access_key` tam olarak bunun için var.
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  access_key TEXT NOT NULL UNIQUE,
  licensee TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active','refunded')),
  license_json TEXT,
  updated_at TEXT NOT NULL
);
