-- İletişim formu mesajları.
--
-- IP saklanmaz; yerine tuzlanmış özeti tutulur. Amaç kimliği kaydetmek değil,
-- aynı kaynaktan gelen seli tanımaktır ve bunun için özet yeterlidir.
CREATE TABLE contact_messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  organisation TEXT,
  message TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX contact_messages_rate ON contact_messages(source_hash, created_at);
CREATE INDEX contact_messages_recent ON contact_messages(created_at);
