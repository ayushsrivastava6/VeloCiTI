"""
database.py - Central SQLite database for City Vehicle Intelligence System
Stores every camera detection, camera metadata, blacklist, and alerts.
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "traffic.db")


def get_conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    """Create all tables if they don't exist. Called once at startup."""
    conn = get_conn()
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS cameras (
            id    TEXT PRIMARY KEY,
            name  TEXT NOT NULL,
            road  TEXT,
            lat   REAL,
            lon   REAL,
            area  TEXT
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS detections (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            plate        TEXT    NOT NULL,
            camera_id    TEXT    NOT NULL,
            timestamp    TEXT    NOT NULL,
            confidence   REAL    DEFAULT 0.0,
            speed_kmph   REAL    DEFAULT 0.0,
            lat          REAL,
            lon          REAL,
            direction    TEXT,
            vehicle_type TEXT    DEFAULT 'unknown',
            image_path   TEXT    DEFAULT '',
            voting_data  TEXT    DEFAULT ''
        )
    """)
    try:
        c.execute("ALTER TABLE detections ADD COLUMN image_path TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE detections ADD COLUMN voting_data TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE detections ADD COLUMN env_condition TEXT DEFAULT 'NORMAL'")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE detections ADD COLUMN quality_score REAL DEFAULT 0.85")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE detections ADD COLUMN plate_color TEXT DEFAULT 'WHITE'")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE detections ADD COLUMN category TEXT DEFAULT 'Private Vehicle'")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE detections ADD COLUMN violation TEXT DEFAULT 'NONE'")
    except sqlite3.OperationalError:
        pass


    c.execute("CREATE INDEX IF NOT EXISTS idx_plate ON detections(plate)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_ts    ON detections(timestamp)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_cam   ON detections(camera_id)")

    c.execute("""
        CREATE TABLE IF NOT EXISTS blacklist (
            plate  TEXT PRIMARY KEY,
            reason TEXT DEFAULT 'Flagged'
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            plate        TEXT    NOT NULL,
            camera_id    TEXT,
            timestamp    TEXT    NOT NULL,
            alert_type   TEXT    NOT NULL,
            message      TEXT,
            acknowledged INTEGER DEFAULT 0
        )
    """)

    conn.commit()
    conn.close()
    print("Database initialised:", DB_PATH)


# --- Camera helpers ---

def upsert_camera(cam_id, name, road, lat, lon, area=""):
    conn = get_conn()
    conn.execute(
        "INSERT OR REPLACE INTO cameras (id, name, road, lat, lon, area) VALUES (?,?,?,?,?,?)",
        (cam_id, name, road, lat, lon, area)
    )
    conn.commit(); conn.close()


def get_all_cameras():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM cameras ORDER BY id").fetchall()
    conn.close()
    return [dict(r) for r in rows]


# --- Detection helpers ---

def insert_detection(plate, camera_id, timestamp, confidence=0.0,
                     speed_kmph=0.0, lat=None, lon=None,
                     direction="", vehicle_type="unknown", image_path="", voting_data="",
                     env_condition="NORMAL", quality_score=0.85,
                     plate_color="WHITE", category="Private Vehicle", violation="NONE"):
    conn = get_conn()
    conn.execute("""
        INSERT INTO detections
            (plate, camera_id, timestamp, confidence, speed_kmph, lat, lon, direction, vehicle_type, image_path, voting_data, env_condition, quality_score, plate_color, category, violation)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (plate, camera_id, timestamp, confidence, speed_kmph, lat, lon, direction, vehicle_type, image_path, voting_data, env_condition, quality_score, plate_color, category, violation))
    conn.commit(); conn.close()




def get_trajectory(plate):
    conn = get_conn()
    rows = conn.execute("""
        SELECT d.*, c.name as camera_name, c.road, c.area, c.lat as cam_lat, c.lon as cam_lon
        FROM detections d
        LEFT JOIN cameras c ON c.id = d.camera_id
        WHERE d.plate = ?
        ORDER BY d.timestamp ASC
    """, (plate,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_violations(limit=30):
    conn = get_conn()
    rows = conn.execute("""
        SELECT d.*, c.name as camera_name, c.road, c.area
        FROM detections d
        LEFT JOIN cameras c ON d.camera_id = c.id
        WHERE d.violation != 'NONE' OR d.plate LIKE '%NO PLATE%' OR d.plate LIKE '%UNREADABLE%'
        ORDER BY d.timestamp DESC
        LIMIT ?
    """, (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_recent_detections(minutes=15, limit=60):
    conn = get_conn()
    rows = conn.execute("""
        SELECT d.*, c.name as camera_name, c.road
        FROM detections d
        LEFT JOIN cameras c ON c.id = d.camera_id
        WHERE d.timestamp >= datetime('now', ?, 'localtime')
        ORDER BY d.timestamp DESC
    """, (f"-{minutes} minutes",)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_camera_traffic(minutes=15):
    conn = get_conn()
    rows = conn.execute("""
        SELECT d.camera_id,
               c.name AS camera_name, c.road, c.lat, c.lon, c.area,
               COUNT(DISTINCT d.plate)                                   AS unique_vehicles,
               COUNT(*)                                                   AS total_detections,
               COALESCE(AVG(CASE WHEN d.speed_kmph > 0 THEN d.speed_kmph END), 0) AS avg_speed
        FROM detections d
        LEFT JOIN cameras c ON c.id = d.camera_id
        WHERE d.timestamp >= datetime('now', ?, 'localtime')
        GROUP BY d.camera_id
        ORDER BY unique_vehicles DESC
    """, (f"-{minutes} minutes",)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_total_today():
    conn = get_conn()
    row = conn.execute("""
        SELECT COUNT(DISTINCT plate) AS unique_plates,
               COUNT(*)              AS total_detections
        FROM detections
        WHERE timestamp >= date('now', 'localtime')
    """).fetchone()
    conn.close()
    return dict(row)


def get_od_patterns(limit=10):
    conn = get_conn()
    rows = conn.execute("""
        WITH numbered AS (
            SELECT plate, camera_id, timestamp,
                   ROW_NUMBER() OVER (PARTITION BY plate ORDER BY timestamp) AS rn
            FROM detections
        )
        SELECT a.camera_id AS origin,
               b.camera_id AS destination,
               COUNT(*)    AS trips
        FROM numbered a
        JOIN numbered b ON a.plate = b.plate AND b.rn = a.rn + 1
        GROUP BY origin, destination
        ORDER BY trips DESC
        LIMIT ?
    """, (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def search_plates(query, limit=20):
    conn = get_conn()
    rows = conn.execute("""
        SELECT DISTINCT plate FROM detections
        WHERE plate LIKE ?
        ORDER BY plate LIMIT ?
    """, (f"%{query.upper()}%", limit)).fetchall()
    conn.close()
    return [r["plate"] for r in rows]


# --- Blacklist helpers ---

def add_to_blacklist(plate, reason="Flagged"):
    p = plate.upper().replace(" ", "")
    conn = get_conn()
    conn.execute("INSERT OR REPLACE INTO blacklist (plate, reason) VALUES (?,?)", (p, reason))
    conn.commit(); conn.close()


def remove_from_blacklist(plate):
    p = plate.upper().replace(" ", "")
    conn = get_conn()
    conn.execute("DELETE FROM blacklist WHERE plate=?", (p,))
    conn.commit(); conn.close()


def get_blacklist():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM blacklist ORDER BY plate").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def is_blacklisted(plate):
    p = plate.upper().replace(" ", "")
    conn = get_conn()
    row = conn.execute("SELECT reason FROM blacklist WHERE plate=?", (p,)).fetchone()
    conn.close()
    return dict(row) if row else None


# --- Alert helpers ---

def insert_alert(plate, camera_id, timestamp, alert_type, message):
    conn = get_conn()
    conn.execute("""
        INSERT INTO alerts (plate, camera_id, timestamp, alert_type, message)
        VALUES (?,?,?,?,?)
    """, (plate, camera_id, timestamp, alert_type, message))
    conn.commit(); conn.close()


def get_alerts(limit=50, unack_only=False):
    conn = get_conn()
    where = "WHERE acknowledged=0" if unack_only else ""
    rows = conn.execute(
        f"SELECT * FROM alerts {where} ORDER BY timestamp DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def acknowledge_alert(alert_id):
    conn = get_conn()
    conn.execute("UPDATE alerts SET acknowledged=1 WHERE id=?", (alert_id,))
    conn.commit(); conn.close()


if __name__ == "__main__":
    init_db()
