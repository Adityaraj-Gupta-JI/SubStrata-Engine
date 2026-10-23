ALTER TABLE ai_conversations ADD COLUMN mysql_database_id TEXT REFERENCES mysql_databases(id);
