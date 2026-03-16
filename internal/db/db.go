package db

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type DB struct {
	db *sql.DB
}

type GallerySortBy string

const (
	GallerySortByCreated  GallerySortBy = "created"
	GallerySortByModified GallerySortBy = "modified"
	GallerySortByName     GallerySortBy = "name"
	GallerySortBySize     GallerySortBy = "size"
)

type GallerySortDirection string

const (
	GallerySortDirectionAsc  GallerySortDirection = "asc"
	GallerySortDirectionDesc GallerySortDirection = "desc"
)

func normalizeGallerySort(sortBy string, direction string) (GallerySortBy, GallerySortDirection) {
	normalizedSortBy := GallerySortBy(strings.ToLower(strings.TrimSpace(sortBy)))
	switch normalizedSortBy {
	case GallerySortByCreated, GallerySortByModified, GallerySortByName, GallerySortBySize:
	default:
		normalizedSortBy = GallerySortByModified
	}

	normalizedDirection := GallerySortDirection(strings.ToLower(strings.TrimSpace(direction)))
	switch normalizedDirection {
	case GallerySortDirectionAsc, GallerySortDirectionDesc:
	default:
		normalizedDirection = GallerySortDirectionDesc
	}

	return normalizedSortBy, normalizedDirection
}

func buildGalleryOrderClause(tableAlias string, sortBy GallerySortBy, direction GallerySortDirection) string {
	column := "added_at"
	switch sortBy {
	case GallerySortByModified:
		column = "modified_unix_ns"
	case GallerySortByName:
		column = "path"
	case GallerySortBySize:
		column = "file_size"
	}

	prefix := ""
	if strings.TrimSpace(tableAlias) != "" {
		prefix = tableAlias + "."
	}

	return " ORDER BY " + prefix + column + " " + string(direction)
}

type ImageRecord struct {
	ID             int64
	Path           string
	Hash           string
	ThumbReady     bool
	MetadataStatus int
	FileSize       int64
	ModifiedUnixNs int64
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

type FolderRecord struct {
	Name string
	Path string
}

type FolderBrowseResult struct {
	Folders     []FolderRecord
	Images      []ImageRecord
	TotalImages int
}

const (
	MetadataStatusUnknown = 0
	MetadataStatusPresent = 1
	MetadataStatusMissing = 2
)

func New() (*DB, error) {
	dataDir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}

	pixoraDir := filepath.Join(dataDir, "pixora")
	if err := os.MkdirAll(pixoraDir, 0755); err != nil {
		return nil, err
	}

	dbPath := filepath.Join(pixoraDir, "pixora.db")

	dsn := dbPath + "?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_busy_timeout=5000"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}

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
		metadata_status INTEGER NOT NULL DEFAULT 0,
		file_size INTEGER NOT NULL DEFAULT 0,
		modified_unix_ns INTEGER NOT NULL DEFAULT 0,
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
	if err != nil {
		return err
	}

	if err := d.ensureImagesColumn("file_size", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}

	if err := d.ensureImagesColumn("thumb_ready", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}

	if err := d.ensureImagesColumn("metadata_status", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}

	return d.ensureImagesColumn("modified_unix_ns", "INTEGER NOT NULL DEFAULT 0")
}

func (d *DB) ensureImagesColumn(name string, definition string) error {
	rows, err := d.db.Query(`PRAGMA table_info(images);`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var colName string
		var colType string
		var notNull int
		var defaultValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &colName, &colType, &notNull, &defaultValue, &pk); err != nil {
			return err
		}
		if colName == name {
			return nil
		}
	}

	_, err = d.db.Exec(`ALTER TABLE images ADD COLUMN ` + name + ` ` + definition)
	return err
}

func (d *DB) Close() error {
	if _, err := d.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE);`); err != nil {
		return err
	}

	return d.db.Close()
}

// InsertOrUpdateImage adds or updates an image in the database.
func (d *DB) InsertOrUpdateImage(ctx context.Context, img ImageRecord) (int64, error) {
	query := `
		INSERT INTO images (path, hash, thumb_ready, metadata_status, file_size, modified_unix_ns, prompt, negative_prompt, model, sampler, seed, cfg_scale, width, height)
		VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(path) DO UPDATE SET
			hash=excluded.hash,
			thumb_ready=0,
			metadata_status=excluded.metadata_status,
			file_size=excluded.file_size,
			modified_unix_ns=excluded.modified_unix_ns,
			prompt=excluded.prompt,
			negative_prompt=excluded.negative_prompt,
			model=excluded.model,
			sampler=excluded.sampler,
			seed=excluded.seed,
			cfg_scale=excluded.cfg_scale,
			width=excluded.width,
			height=excluded.height
		WHERE
			images.hash IS NOT excluded.hash OR
			images.metadata_status IS NOT excluded.metadata_status OR
			images.file_size IS NOT excluded.file_size OR
			images.modified_unix_ns IS NOT excluded.modified_unix_ns OR
			images.prompt IS NOT excluded.prompt OR
			images.negative_prompt IS NOT excluded.negative_prompt OR
			images.model IS NOT excluded.model OR
			images.sampler IS NOT excluded.sampler OR
			images.seed IS NOT excluded.seed OR
			images.cfg_scale IS NOT excluded.cfg_scale OR
			images.width IS NOT excluded.width OR
			images.height IS NOT excluded.height
		RETURNING id;
	`

	var id int64
	err := d.db.QueryRowContext(ctx, query,
		img.Path, img.Hash, img.MetadataStatus, img.FileSize, img.ModifiedUnixNs, img.Prompt, img.NegativePrompt, img.Model, img.Sampler,
		img.Seed, img.CfgScale, img.Width, img.Height,
	).Scan(&id)

	if err == sql.ErrNoRows {
		err = d.db.QueryRowContext(ctx, `SELECT id FROM images WHERE path = ?`, img.Path).Scan(&id)
	}

	if err != nil {
		return 0, err
	}

	return id, nil
}

func (d *DB) GetImageFileState(ctx context.Context, path string) (*ImageRecord, error) {
	var img ImageRecord
	err := d.db.QueryRowContext(ctx, `SELECT id, path, hash, thumb_ready, metadata_status, file_size, modified_unix_ns, model, prompt FROM images WHERE path = ?`, path).Scan(
		&img.ID,
		&img.Path,
		&img.Hash,
		&img.ThumbReady,
		&img.MetadataStatus,
		&img.FileSize,
		&img.ModifiedUnixNs,
		&img.Model,
		&img.Prompt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &img, nil
}

func (d *DB) GetImageByPath(ctx context.Context, path string) (*ImageRecord, error) {
	var img ImageRecord
	err := d.db.QueryRowContext(ctx, `SELECT id, path, hash, thumb_ready, metadata_status, file_size, modified_unix_ns, prompt, negative_prompt, model, sampler, seed, cfg_scale, width, height, added_at FROM images WHERE path = ?`, path).Scan(
		&img.ID,
		&img.Path,
		&img.Hash,
		&img.ThumbReady,
		&img.MetadataStatus,
		&img.FileSize,
		&img.ModifiedUnixNs,
		&img.Prompt,
		&img.NegativePrompt,
		&img.Model,
		&img.Sampler,
		&img.Seed,
		&img.CfgScale,
		&img.Width,
		&img.Height,
		&img.AddedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &img, nil
}

func (d *DB) UpdateImageMetadataByPath(ctx context.Context, img ImageRecord) error {
	_, err := d.db.ExecContext(ctx, `
		UPDATE images
		SET hash = ?, metadata_status = ?, file_size = ?, modified_unix_ns = ?, prompt = ?, negative_prompt = ?, model = ?, sampler = ?, seed = ?, cfg_scale = ?, width = ?, height = ?
		WHERE path = ?
	`,
		img.Hash,
		img.MetadataStatus,
		img.FileSize,
		img.ModifiedUnixNs,
		img.Prompt,
		img.NegativePrompt,
		img.Model,
		img.Sampler,
		img.Seed,
		img.CfgScale,
		img.Width,
		img.Height,
		img.Path,
	)

	return err
}

func (d *DB) GetImageFileStatesByFolder(ctx context.Context, folderPath string) (map[string]ImageRecord, error) {
	rows, err := d.db.QueryContext(ctx, `SELECT id, path, hash, thumb_ready, metadata_status, file_size, modified_unix_ns, model, prompt FROM images WHERE path LIKE ?`, folderPath+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	states := make(map[string]ImageRecord)
	for rows.Next() {
		var img ImageRecord
		if err := rows.Scan(&img.ID, &img.Path, &img.Hash, &img.ThumbReady, &img.MetadataStatus, &img.FileSize, &img.ModifiedUnixNs, &img.Model, &img.Prompt); err != nil {
			return nil, err
		}
		states[img.Path] = img
	}

	return states, nil
}

func (d *DB) RemoveImage(ctx context.Context, path string) error {
	query := `DELETE FROM images WHERE path = ?;`
	_, err := d.db.ExecContext(ctx, query, path)
	return err
}

func (d *DB) RemoveImageAndGetHash(ctx context.Context, path string) (string, error) {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}

	var hash string
	err = tx.QueryRowContext(ctx, `SELECT hash FROM images WHERE path = ?`, path).Scan(&hash)
	if err != nil {
		_ = tx.Rollback()
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", err
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM images WHERE path = ?`, path); err != nil {
		_ = tx.Rollback()
		return "", err
	}

	var remainingCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM images WHERE hash = ?`, hash).Scan(&remainingCount); err != nil {
		_ = tx.Rollback()
		return "", err
	}

	if err := tx.Commit(); err != nil {
		return "", err
	}

	if remainingCount > 0 {
		return "", nil
	}

	return hash, nil
}

func (d *DB) RemoveImagesByFolder(ctx context.Context, folderPath string) ([]string, error) {
	searchPath := folderPath + "%"

	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}

	rows, err := tx.QueryContext(ctx, `SELECT DISTINCT hash FROM images WHERE path LIKE ?`, searchPath)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}

	hashes := make([]string, 0)
	for rows.Next() {
		var hash string
		if err := rows.Scan(&hash); err != nil {
			rows.Close()
			_ = tx.Rollback()
			return nil, err
		}
		if strings.TrimSpace(hash) != "" {
			hashes = append(hashes, hash)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		_ = tx.Rollback()
		return nil, err
	}
	rows.Close()

	if len(hashes) == 0 {
		if _, err := tx.ExecContext(ctx, `DELETE FROM images WHERE path LIKE ?;`, searchPath); err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return []string{}, nil
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM images WHERE path LIKE ?;`, searchPath); err != nil {
		_ = tx.Rollback()
		return nil, err
	}

	placeholders := make([]string, len(hashes))
	args := make([]interface{}, len(hashes))
	for idx, hash := range hashes {
		placeholders[idx] = "?"
		args[idx] = hash
	}

	remainingRows, err := tx.QueryContext(ctx,
		`SELECT DISTINCT hash FROM images WHERE hash IN (`+strings.Join(placeholders, ",")+`)`,
		args...,
	)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}

	remainingHashes := make(map[string]struct{}, len(hashes))
	for remainingRows.Next() {
		var hash string
		if err := remainingRows.Scan(&hash); err != nil {
			remainingRows.Close()
			_ = tx.Rollback()
			return nil, err
		}
		remainingHashes[hash] = struct{}{}
	}
	if err := remainingRows.Err(); err != nil {
		remainingRows.Close()
		_ = tx.Rollback()
		return nil, err
	}
	remainingRows.Close()

	orphanHashes := make([]string, 0, len(hashes))
	for _, hash := range hashes {
		if _, exists := remainingHashes[hash]; !exists {
			orphanHashes = append(orphanHashes, hash)
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return orphanHashes, nil
}

func (d *DB) ClearImages(ctx context.Context) error {
	_, err := d.db.ExecContext(ctx, `DELETE FROM images;`)
	return err
}

func (d *DB) MarkThumbnailReadyByHash(ctx context.Context, hash string) error {
	if strings.TrimSpace(hash) == "" {
		return nil
	}
	_, err := d.db.ExecContext(ctx, `UPDATE images SET thumb_ready = 1 WHERE hash = ?`, hash)
	return err
}

func (d *DB) CheckpointWAL(ctx context.Context) error {
	_, err := d.db.ExecContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE);`)
	return err
}

func (d *DB) SearchImages(ctx context.Context, query string, folderPath string, offset, limit int, sortBy string, direction string) ([]ImageRecord, int, error) {
	var total int
	var countQuery string
	var rowsQuery string
	var args []interface{}
	var countArgs []interface{}

	query = strings.TrimSpace(query)
	normalizedSortBy, normalizedDirection := normalizeGallerySort(sortBy, direction)

	whereClause := " WHERE thumb_ready = 1"
	if folderPath != "" {
		whereClause += " AND path LIKE ?"
	}

	if query == "" {
		countQuery = "SELECT COUNT(*) FROM images" + whereClause
		if folderPath != "" {
			countArgs = append(countArgs, folderPath+"%")
		}

		rowsQuery = "SELECT id, path, hash, thumb_ready, metadata_status, file_size, modified_unix_ns, prompt, negative_prompt, model, sampler, seed, cfg_scale, width, height, added_at FROM images"
		if whereClause != "" {
			rowsQuery += whereClause
			if folderPath != "" {
				args = append(args, folderPath+"%")
			}
		}
		rowsQuery += buildGalleryOrderClause("", normalizedSortBy, normalizedDirection)
		rowsQuery += " LIMIT ? OFFSET ?"
		args = append(args, limit, offset)

		err := d.db.QueryRowContext(ctx, countQuery, countArgs...).Scan(&total)
		if err != nil {
			return nil, 0, err
		}
	} else {
		// FTS5 MATCH
		searchStr := buildFTSQuery(query)
		if searchStr == "" {
			return d.SearchImages(ctx, "", folderPath, offset, limit, sortBy, direction)
		}

		countQuery = "SELECT COUNT(*) FROM images_fts WHERE images_fts MATCH ?"
		countArgs = nil
		countArgs = append(countArgs, searchStr)

		if folderPath != "" {
			// Joining with images table to filter by path
			countQuery = `SELECT COUNT(*) FROM images_fts f 
						 JOIN images i ON f.rowid = i.id 
						 WHERE images_fts MATCH ? AND i.thumb_ready = 1 AND i.path LIKE ?`
			countArgs = append(countArgs, folderPath+"%")
		} else {
			countQuery = `SELECT COUNT(*) FROM images_fts f 
						 JOIN images i ON f.rowid = i.id 
						 WHERE images_fts MATCH ? AND i.thumb_ready = 1`
		}

		rowsQuery = `SELECT i.id, i.path, i.hash, i.thumb_ready, i.metadata_status, i.file_size, i.modified_unix_ns, i.prompt, i.negative_prompt, i.model, i.sampler, i.seed, i.cfg_scale, i.width, i.height, i.added_at 
					 FROM images_fts f 
					 JOIN images i ON f.rowid = i.id 
					 WHERE images_fts MATCH ? AND i.thumb_ready = 1`

		args = append(args, searchStr)
		if folderPath != "" {
			rowsQuery += " AND i.path LIKE ?"
			args = append(args, folderPath+"%")
		}

		rowsQuery += buildGalleryOrderClause("i", normalizedSortBy, normalizedDirection)
		rowsQuery += " LIMIT ? OFFSET ?"
		args = append(args, limit, offset)

		err := d.db.QueryRowContext(ctx, countQuery, countArgs...).Scan(&total)
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
			&img.ID, &img.Path, &img.Hash, &img.ThumbReady, &img.MetadataStatus, &img.FileSize, &img.ModifiedUnixNs,
			&img.Prompt, &img.NegativePrompt, &img.Model, &img.Sampler, &img.Seed, &img.CfgScale,
			&img.Width, &img.Height, &img.AddedAt,
		); err != nil {
			return nil, 0, err
		}
		images = append(images, img)
	}

	return images, total, nil
}

func (d *DB) BrowseFolder(ctx context.Context, folderPath string, query string, offset, limit int, sortBy string, direction string) (FolderBrowseResult, error) {
	normalizedFolderPath := strings.TrimSpace(filepath.Clean(folderPath))
	if normalizedFolderPath == "" {
		return FolderBrowseResult{}, nil
	}

	folderPrefix := normalizedFolderPath + string(filepath.Separator)
	sep := string(filepath.Separator)

	folderRows, err := d.db.QueryContext(ctx, `
		SELECT DISTINCT substr(rest, 1, instr(rest, ?) - 1) AS folder_name
		FROM (
			SELECT substr(path, length(?) + 1) AS rest
			FROM images
			WHERE thumb_ready = 1 AND path LIKE ?
		) AS children
		WHERE instr(rest, ?) > 0
		ORDER BY folder_name COLLATE NOCASE ASC
	`, sep, folderPrefix, folderPrefix+"%", sep)
	if err != nil {
		return FolderBrowseResult{}, err
	}
	defer folderRows.Close()

	folders := make([]FolderRecord, 0)
	for folderRows.Next() {
		var folderName string
		if err := folderRows.Scan(&folderName); err != nil {
			return FolderBrowseResult{}, err
		}

		trimmedFolderName := strings.TrimSpace(folderName)
		if trimmedFolderName == "" {
			continue
		}

		folders = append(folders, FolderRecord{
			Name: trimmedFolderName,
			Path: filepath.Join(normalizedFolderPath, trimmedFolderName),
		})
	}

	if err := folderRows.Err(); err != nil {
		return FolderBrowseResult{}, err
	}

	if query != "" {
		queryLower := strings.ToLower(strings.TrimSpace(query))
		if queryLower != "" {
			filteredFolders := make([]FolderRecord, 0, len(folders))
			for _, folder := range folders {
				if strings.Contains(strings.ToLower(folder.Name), queryLower) {
					filteredFolders = append(filteredFolders, folder)
				}
			}
			folders = filteredFolders
		}
	}

	images, total, err := d.searchImagesDirectChildren(ctx, normalizedFolderPath, query, offset, limit, sortBy, direction)
	if err != nil {
		return FolderBrowseResult{}, err
	}

	return FolderBrowseResult{
		Folders:     folders,
		Images:      images,
		TotalImages: total,
	}, nil
}

func (d *DB) searchImagesDirectChildren(ctx context.Context, folderPath string, query string, offset, limit int, sortBy string, direction string) ([]ImageRecord, int, error) {
	var total int
	var countQuery string
	var rowsQuery string
	var args []interface{}
	var countArgs []interface{}

	trimmedQuery := strings.TrimSpace(query)
	normalizedSortBy, normalizedDirection := normalizeGallerySort(sortBy, direction)
	folderPrefix := folderPath + string(filepath.Separator)
	sep := string(filepath.Separator)

	directChildClause := `thumb_ready = 1 AND path LIKE ? AND instr(substr(path, length(?) + 1), ?) = 0`

	if trimmedQuery == "" {
		countQuery = "SELECT COUNT(*) FROM images WHERE " + directChildClause
		countArgs = append(countArgs, folderPrefix+"%", folderPrefix, sep)

		rowsQuery = "SELECT id, path, hash, thumb_ready, metadata_status, file_size, modified_unix_ns, prompt, negative_prompt, model, sampler, seed, cfg_scale, width, height, added_at FROM images WHERE " + directChildClause
		args = append(args, folderPrefix+"%", folderPrefix, sep)
		rowsQuery += buildGalleryOrderClause("", normalizedSortBy, normalizedDirection)
		rowsQuery += " LIMIT ? OFFSET ?"
		args = append(args, limit, offset)

		err := d.db.QueryRowContext(ctx, countQuery, countArgs...).Scan(&total)
		if err != nil {
			return nil, 0, err
		}
	} else {
		searchStr := buildFTSQuery(trimmedQuery)
		if searchStr == "" {
			return d.searchImagesDirectChildren(ctx, folderPath, "", offset, limit, sortBy, direction)
		}

		countQuery = `SELECT COUNT(*)
			FROM images_fts f
			JOIN images i ON f.rowid = i.id
			WHERE images_fts MATCH ?
			  AND i.thumb_ready = 1
			  AND i.path LIKE ?
			  AND instr(substr(i.path, length(?) + 1), ?) = 0`
		countArgs = append(countArgs, searchStr, folderPrefix+"%", folderPrefix, sep)

		rowsQuery = `SELECT i.id, i.path, i.hash, i.thumb_ready, i.metadata_status, i.file_size, i.modified_unix_ns, i.prompt, i.negative_prompt, i.model, i.sampler, i.seed, i.cfg_scale, i.width, i.height, i.added_at
			FROM images_fts f
			JOIN images i ON f.rowid = i.id
			WHERE images_fts MATCH ?
			  AND i.thumb_ready = 1
			  AND i.path LIKE ?
			  AND instr(substr(i.path, length(?) + 1), ?) = 0`
		args = append(args, searchStr, folderPrefix+"%", folderPrefix, sep)
		rowsQuery += buildGalleryOrderClause("i", normalizedSortBy, normalizedDirection)
		rowsQuery += " LIMIT ? OFFSET ?"
		args = append(args, limit, offset)

		err := d.db.QueryRowContext(ctx, countQuery, countArgs...).Scan(&total)
		if err != nil {
			return nil, 0, err
		}
	}

	rows, err := d.db.QueryContext(ctx, rowsQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	images := make([]ImageRecord, 0)
	for rows.Next() {
		var img ImageRecord
		if err := rows.Scan(
			&img.ID, &img.Path, &img.Hash, &img.ThumbReady, &img.MetadataStatus, &img.FileSize, &img.ModifiedUnixNs,
			&img.Prompt, &img.NegativePrompt, &img.Model, &img.Sampler, &img.Seed, &img.CfgScale,
			&img.Width, &img.Height, &img.AddedAt,
		); err != nil {
			return nil, 0, err
		}
		images = append(images, img)
	}

	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	return images, total, nil
}

func buildFTSQuery(raw string) string {
	tokens := strings.Fields(raw)
	if len(tokens) == 0 {
		return ""
	}

	built := make([]string, 0, len(tokens))
	for _, t := range tokens {
		clean := sanitizeFTSToken(t)
		if clean == "" {
			continue
		}
		built = append(built, clean+"*")
	}

	if len(built) == 0 {
		return ""
	}

	return strings.Join(built, " AND ")
}

func sanitizeFTSToken(token string) string {
	var b strings.Builder
	for _, r := range token {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' {
			b.WriteRune(r)
		}
	}
	return b.String()
}
