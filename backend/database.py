import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "dataroom.db")

def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 30000")
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
    except Exception:
        pass
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            root_path TEXT NOT NULL,
            company_type TEXT DEFAULT 'cn',
            mode TEXT DEFAULT 'established',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            parent_id INTEGER,
            name TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            category_id INTEGER,
            file_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_size INTEGER DEFAULT 0,
            content_hash TEXT,
            last_modified DATETIME,
            notes TEXT,
            keyword_suggested INTEGER DEFAULT 0,
            registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (category_id) REFERENCES categories(id)
        );

        CREATE TABLE IF NOT EXISTS ldd_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            section_no TEXT NOT NULL,
            item_no TEXT NOT NULL,
            title TEXT NOT NULL,
            title_en TEXT,
            description TEXT,
            item_type TEXT DEFAULT 'file',
            risk_level TEXT DEFAULT 'medium',
            is_required INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        CREATE TABLE IF NOT EXISTS ldd_mappings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ldd_item_id INTEGER NOT NULL,
            file_id INTEGER NOT NULL,
            FOREIGN KEY (ldd_item_id) REFERENCES ldd_items(id),
            FOREIGN KEY (file_id) REFERENCES files(id)
        );

        CREATE TABLE IF NOT EXISTS ldd_status (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ldd_item_id INTEGER UNIQUE NOT NULL,
            status TEXT DEFAULT 'pending',
            statement TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (ldd_item_id) REFERENCES ldd_items(id)
        );

        CREATE TABLE IF NOT EXISTS founders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            role TEXT,
            id_number TEXT,
            join_date TEXT,
            employment_type TEXT DEFAULT 'full_time',
            notes TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );

        CREATE TABLE IF NOT EXISTS founder_checklist_status (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            founder_id INTEGER NOT NULL,
            item_code TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            statement TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (founder_id) REFERENCES founders(id),
            UNIQUE(founder_id, item_code)
        );

        CREATE TABLE IF NOT EXISTS founder_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            founder_id INTEGER NOT NULL,
            item_code TEXT,
            file_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            notes TEXT,
            registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (founder_id) REFERENCES founders(id)
        );

        -- Version history for files
        CREATE TABLE IF NOT EXISTS file_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL,
            version_no INTEGER NOT NULL,
            file_path TEXT NOT NULL,
            content_hash TEXT,
            file_size INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        );

        -- Full-text search content storage
        CREATE TABLE IF NOT EXISTS file_content (
            file_id INTEGER PRIMARY KEY,
            content TEXT,
            extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        );

        -- FTS5 virtual table for full-text search (if supported)
        CREATE VIRTUAL TABLE IF NOT EXISTS file_content_fts USING fts5(
            content,
            content='file_content',
            content_rowid='file_id'
        );

        -- LDD Checklist Templates
        CREATE TABLE IF NOT EXISTS ldd_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            round_type TEXT DEFAULT 'custom',
            description TEXT,
            is_builtin INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ldd_template_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id INTEGER NOT NULL,
            section_no TEXT NOT NULL,
            item_no TEXT NOT NULL,
            title TEXT NOT NULL,
            title_en TEXT,
            description TEXT,
            item_type TEXT DEFAULT 'file',
            risk_level TEXT DEFAULT 'medium',
            is_required INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (template_id) REFERENCES ldd_templates(id) ON DELETE CASCADE
        );
    """)
    conn.commit()
    conn.close()
    # Run migrations for existing databases
    migrate_db()

    # Seed default templates
    try:
        from .seed import seed_default_templates
        seed_conn = get_db()
        try:
            seed_default_templates(seed_conn)
        finally:
            seed_conn.close()
    except Exception:
        pass  # Ignore seed errors

def migrate_db():
    """Migrate existing database to latest schema."""
    conn = get_db()
    c = conn.cursor()

    # Migration: Add new columns to files table
    try:
        c.execute("ALTER TABLE files ADD COLUMN file_size INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass  # Column already exists

    try:
        c.execute("ALTER TABLE files ADD COLUMN content_hash TEXT")
    except sqlite3.OperationalError:
        pass

    try:
        c.execute("ALTER TABLE files ADD COLUMN last_modified DATETIME")
    except sqlite3.OperationalError:
        pass

    # Migration: Create new tables if not exist (for existing DBs)
    c.executescript("""
        CREATE TABLE IF NOT EXISTS file_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL,
            version_no INTEGER NOT NULL,
            file_path TEXT NOT NULL,
            content_hash TEXT,
            file_size INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS file_content (
            file_id INTEGER PRIMARY KEY,
            content TEXT,
            extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS file_content_fts USING fts5(
            content,
            content='file_content',
            content_rowid='file_id'
        );

        CREATE TABLE IF NOT EXISTS ldd_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            round_type TEXT DEFAULT 'custom',
            description TEXT,
            is_builtin INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ldd_template_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id INTEGER NOT NULL,
            section_no TEXT NOT NULL,
            item_no TEXT NOT NULL,
            title TEXT NOT NULL,
            title_en TEXT,
            description TEXT,
            item_type TEXT DEFAULT 'file',
            risk_level TEXT DEFAULT 'medium',
            is_required INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (template_id) REFERENCES ldd_templates(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_files_hash ON files(content_hash);
        CREATE INDEX IF NOT EXISTS idx_files_size ON files(file_size);
        CREATE INDEX IF NOT EXISTS idx_files_project_registered ON files(project_id, registered_at);
        CREATE INDEX IF NOT EXISTS idx_files_project_category ON files(project_id, category_id);
        CREATE INDEX IF NOT EXISTS idx_categories_project_parent ON categories(project_id, parent_id);
        CREATE INDEX IF NOT EXISTS idx_file_versions_file ON file_versions(file_id);
    """)

    # Migration: add notes column to ldd_mappings
    try:
        c.execute("ALTER TABLE ldd_mappings ADD COLUMN notes TEXT")
    except sqlite3.OperationalError:
        pass

    # Migration: add section_title columns to ldd_items
    try:
        c.execute("ALTER TABLE ldd_items ADD COLUMN section_title TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE ldd_items ADD COLUMN section_title_en TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass

    conn.commit()
    conn.close()
