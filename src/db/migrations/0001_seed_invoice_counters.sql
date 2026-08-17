-- Seed transactional invoice number counters.
-- Squash commit 0fc7bac folded old migrations into 0000 but dropped the
-- seed INSERT that previously lived in 0009_invoice_settlement_redesign.sql.
-- Without these rows, allocateOnlineInvoiceNumber throws
-- "Invoice number counter online is missing or invalid".
-- ON CONFLICT DO NOTHING makes this safe to re-run and safe on DBs
-- that already have rows. No data-destructive statements here.
INSERT INTO "invoice_number_counters" ("kind", "next_value")
VALUES
	('online', (SELECT COALESCE(MAX("s_no"), 0) + 1 FROM "invoices")),
	('offline', 1)
ON CONFLICT ("kind") DO NOTHING;
