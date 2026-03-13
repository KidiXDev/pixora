package db

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

type DB struct {
	db *sql.DB
}

type ImageRecord struct {
	ID             int64
	Path           string
	Hash           string
	Prompt         string
	NegativePrompt string
	Model          string
	Sampler        string
	Seed           string
	CfgScale       float64
	Width          int
	Height         int
	AddedAt        time.Time
}

func New() (*DB, error) {
	dataDir, err := os.UserConfigDir() // Will be ~/.config on Linux, %APPDATA% on Windows
	if err != nil {
		return nil, err
	}

	pixoraDir := filepath.Join(dataDir, "pixora")
	if err := os.MkdirAll(pixoraDir, 0755); err != nil {
		return nil, err
	}

	dbPath := filepath.Join(pixoraDir, "pixora.db")

	// Open database with foreign keys and WAL mode for better concurrency
	// Added busy_timeout to handle "database is locked" errors
	dsn := dbPath + "?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_busy_timeout=5000"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}

	// Limit to 1 open connection to avoid concurrent writers conflicting on the lock,
	// while WAL mode allows concurrent readers.
	db.SetMaxOpenConns(1)

	if err := db.Ping(); err != nil {
		return nil, err
	}

	database := &DB{db: db}
	if err := database.initSchema(); err != nil {
		return nil, err
	}

	return database, nil
}

func (d *DB) initSchema() error {
	schema := `
	CREATE TABLE IF NOT EXISTS images (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		path TEXT UNIQUE NOT NULL,
		hash TEXT NOT NULL,
		prompt TEXT,
		negative_prompt TEXT,
		model TEXT,
		sampler TEXT,
		seed TEXT,
		cfg_scale REAL,
		width INTEGER,
		height INTEGER,
		added_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_images_hash ON images(hash);
	CREATE INDEX IF NOT EXISTS idx_images_added_at ON images(added_at DESC);

	CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(
		prompt,
		negative_prompt,
		model,
		sampler,
		content='images',
		content_rowid='id'
	);

	-- Triggers to keep FTS index up to date
	CREATE TRIGGER IF NOT EXISTS images_ai AFTER INSERT ON images BEGIN
		INSERT INTO images_fts(rowid, prompt, negative_prompt, model, sampler)
		VALUES (new.id, new.prompt, new.negative_prompt, new.model, new.sampler);
	END;

	CREATE TRIGGER IF NOT EXISTS images_ad AFTER DELETE ON images BEGIN
		INSERT INTO images_fts(images_fts, rowid, prompt, negative_prompt, model, sampler)
		VALUES('delete', old.id, old.prompt, old.negative_prompt, old.model, old.sampler);
	END;

	CREATE TRIGGER IF NOT EXISTS images_au AFTER UPDATE ON images BEGIN
		INSERT INTO images_fts(images_fts, rowid, prompt, negative_prompt, model, sampler)
		VALUES('delete', old.id, old.prompt, old.negative_prompt, old.model, old.sampler);
		INSERT INTO images_fts(rowid, prompt, negative_prompt, model, sampler)
		VALUES (new.id, new.prompt, new.negative_prompt, new.model, new.sampler);
	END;
	`

	_, err := d.db.Exec(schema)
	return err
}

func (d *DB) Close() error {
	return d.db.Close()
}

// InsertOrUpdateImage adds or updates an image in the database.
func (d *DB) InsertOrUpdateImage(ctx context.Context, img ImageRecord) (int64, error) {
	query := `
		INSERT INTO images (path, hash, prompt, negative_prompt, model, sampler, seed, cfg_scale, width, height)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(path) DO UPDATE SET
			hash=excluded.hash,
			prompt=excluded.prompt,
			negative_prompt=excluded.negative_prompt,
			model=excluded.model,
			sampler=excluded.sampler,
			seed=excluded.seed,
			cfg_scale=excluded.cfg_scale,
			width=excluded.width,
			height=excluded.height
		RETURNING id;
	`

	var id int64
	err := d.db.QueryRowContext(ctx, query,
		img.Path, img.Hash, img.Prompt, img.NegativePrompt, img.Model, img.Sampler,
		img.Seed, img.CfgScale, img.Width, img.Height,
	).Scan(&id)

	if err != nil {
		return 0, err
	}

	return id, nil
}

// RemoveImage removes an image by path and returns its ID if it existed.
func (d *DB) RemoveImage(ctx context.Context, path string) error {
	query := `DELETE FROM images WHERE path = ?;`
	_, err := d.db.ExecContext(ctx, query, path)
	return err
}

// RemoveImagesByFolder removes all images that start with the given folder path.
func (d *DB) RemoveImagesByFolder(ctx context.Context, folderPath string) error {
	query := `DELETE FROM images WHERE path LIKE ?;`
	searchPath := folderPath + "%"
	_, err := d.db.ExecContext(ctx, query, searchPath)
	return err
}

// SearchImages retrieves images from the database, optionally filtering with FTS5.
func (d *DB) SearchImages(ctx context.Context, query string, offset, limit int) ([]ImageRecord, int, error) {
	var total int
	var countQuery string
	var rowsQuery string
	var args []interface{}

	if query == "" {
		countQuery = `SELECT COUNT(*) FROM images`
		rowsQuery = `SELECT id, path, hash, prompt, negative_prompt, model, sampler, seed, cfg_scale, width, height, added_at 
					 FROM images ORDER BY added_at DESC LIMIT ? OFFSET ?`
		args = []interface{}{limit, offset}
		err := d.db.QueryRowContext(ctx, countQuery).Scan(&total)
		if err != nil {
			return nil, 0, err
		}
	} else {
		// FTS5 MATCH
		countQuery = `SELECT COUNT(*) FROM images_fts WHERE images_fts MATCH ?`
		rowsQuery = `SELECT i.id, i.path, i.hash, i.prompt, i.negative_prompt, i.model, i.sampler, i.seed, i.cfg_scale, i.width, i.height, i.added_at 
					 FROM images_fts f 
					 JOIN images i ON f.rowid = i.id 
					 WHERE images_fts MATCH ? 
					 ORDER BY rank, i.added_at DESC LIMIT ? OFFSET ?`
		
		// format query to avoid sql injection or bad MATCH syntax
		searchStr := "\"" + query + "*\""
		
		args = []interface{}{searchStr, limit, offset}
		err := d.db.QueryRowContext(ctx, countQuery, searchStr).Scan(&total)
		if err != nil {
			return nil, 0, err
		}
	}

	rows, err := d.db.QueryContext(ctx, rowsQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var images []ImageRecord
	for rows.Next() {
		var img ImageRecord
		if err := rows.Scan(
			&img.ID, &img.Path, &img.Hash, &img.Prompt, &img.NegativePrompt,
			&img.Model, &img.Sampler, &img.Seed, &img.CfgScale, &img.Width, &img.Height, &img.AddedAt,
		); err != nil {
			return nil, 0, err
		}
		images = append(images, img)
	}

	return images, total, nil
}
