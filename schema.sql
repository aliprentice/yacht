-- D1 schema for the ai-tracker database (exported 23 Nov 2026). Structure only, no data.

CREATE TABLE answers (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER UNIQUE, run_id INTEGER, prompt_id INTEGER, engine TEXT, model TEXT, text TEXT, created_at TEXT DEFAULT (datetime('now')), in_tok INTEGER DEFAULT 0, out_tok INTEGER DEFAULT 0, searches INTEGER DEFAULT 0, x_in INTEGER DEFAULT 0, x_out INTEGER DEFAULT 0, cached_tok INTEGER DEFAULT 0, reason_tok INTEGER DEFAULT 0);

CREATE TABLE brands (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id TEXT NOT NULL, name TEXT NOT NULL, aliases TEXT DEFAULT '[]', exhibitor INTEGER DEFAULT 0, booth TEXT, website TEXT, kind TEXT DEFAULT 'maker', note TEXT);

CREATE TABLE candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id TEXT, norm TEXT, raw_name TEXT, seen INTEGER DEFAULT 1, status TEXT DEFAULT 'pending', brand_id INTEGER, UNIQUE(category_id, norm));

CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER DEFAULT 1);

CREATE TABLE checks (id TEXT PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')), company TEXT, product TEXT, website TEXT, email TEXT, ip TEXT, status TEXT DEFAULT 'pending', result TEXT, named INTEGER, interest INTEGER DEFAULT 0, cost_usd REAL);

CREATE TABLE citations (id INTEGER PRIMARY KEY AUTOINCREMENT, answer_id INTEGER, run_id INTEGER, url TEXT, domain TEXT);

CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, prompt_id INTEGER NOT NULL, engine TEXT NOT NULL, status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, error TEXT, updated_at TEXT DEFAULT (datetime('now')));

CREATE TABLE leads (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, value TEXT, email TEXT, company TEXT, website TEXT, note TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));

CREATE TABLE mentions (id INTEGER PRIMARY KEY AUTOINCREMENT, answer_id INTEGER, run_id INTEGER, engine TEXT, brand_id INTEGER, raw_name TEXT, position INTEGER, norm TEXT);

CREATE TABLE prompts (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id TEXT NOT NULL, n INTEGER NOT NULL, text TEXT NOT NULL, persona TEXT, version INTEGER DEFAULT 1, active INTEGER DEFAULT 1, core INTEGER DEFAULT 1, weight INTEGER DEFAULT 1);

CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id TEXT NOT NULL, label TEXT, prompt_limit INTEGER, created_at TEXT DEFAULT (datetime('now')), status TEXT DEFAULT 'running');

CREATE INDEX ix_answers_run ON answers(run_id);
CREATE INDEX ix_checks_created ON checks(created_at);
CREATE INDEX ix_citations_answer ON citations(answer_id);
CREATE INDEX ix_citations_run ON citations(run_id);
CREATE INDEX ix_jobs_run ON jobs(run_id);
CREATE INDEX ix_jobs_status ON jobs(status);
CREATE INDEX ix_mentions_answer ON mentions(answer_id);
CREATE INDEX ix_mentions_run ON mentions(run_id);
CREATE INDEX jobs_status ON jobs(status);
CREATE INDEX mentions_run ON mentions(run_id);
