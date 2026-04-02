import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "dataroom.db")

def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
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
    """)
    conn.commit()
    conn.close()
