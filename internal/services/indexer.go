package services

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"pixora/internal/config"
	"pixora/internal/db"
	"pixora/internal/parser"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/zeebo/xxh3"
)

type ScanStatus struct {
	FolderPath     string `json:"folderPath"`
	ProcessedFiles int    `json:"processedFiles"`
	TotalFiles     int    `json:"totalFiles"`
	IsRunning      bool   `json:"isRunning"`
}

type MetadataRefetchMode string

const (
	MetadataRefetchModeDefault MetadataRefetchMode = "default"
	MetadataRefetchModePlugin  MetadataRefetchMode = "plugin"
)

type thumbnailJob struct {
	path string
	hash string
}

type thumbnailReadyEvent struct {
	Hash       string `json:"hash"`
	Path       string `json:"path"`
	FolderPath string `json:"folderPath"`
}

type Indexer struct {
	configManager *config.Manager
	database      *db.DB
	thumbnailSvc  *ThumbnailService
	pluginManager *ParserPluginManager
	watcher       *fsnotify.Watcher
	ctx           context.Context
	cancel        context.CancelFunc
	wg            sync.WaitGroup
	activeScans   map[string]context.CancelFunc
	scansMu       sync.RWMutex
	writeSem      chan struct{}
	thumbSem      chan struct{}
	thumbJobs     chan thumbnailJob
}

func NewIndexer(cfgMgr *config.Manager, database *db.DB, thumbSvc *ThumbnailService, pluginManager *ParserPluginManager) (*Indexer, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())

	indexer := &Indexer{
		configManager: cfgMgr,
		database:      database,
		thumbnailSvc:  thumbSvc,
		pluginManager: pluginManager,
		watcher:       watcher,
		ctx:           ctx,
		cancel:        cancel,
		activeScans:   make(map[string]context.CancelFunc),
		writeSem:      make(chan struct{}, max(4, min(runtime.NumCPU(), 12))),
		thumbSem:      make(chan struct{}, max(2, min(runtime.NumCPU()/2, 4))),
		thumbJobs:     make(chan thumbnailJob, 256),
	}

	indexer.wg.Add(1)
	go indexer.watchLoop()

	thumbWorkers := max(2, min(runtime.NumCPU()/2, 4))
	for range make([]struct{}, thumbWorkers) {
		indexer.wg.Add(1)
		go indexer.thumbnailWorker()
	}

	return indexer, nil
}

func (i *Indexer) Close() error {
	i.cancel()
	err := i.watcher.Close()
	i.wg.Wait()
	return err
}

func (i *Indexer) ScanAll() {
	cfg := i.configManager.GetConfig()
	for _, folder := range cfg.Folders {
		go i.ScanFolder(folder) // Parallel scan
	}
}

func (i *Indexer) ScanFolder(folder config.FolderConfig) {
	i.scansMu.Lock()
	if _, exists := i.activeScans[folder.Path]; exists {
		i.scansMu.Unlock()
		return // already scanning
	}
	ctx, cancel := context.WithCancel(i.ctx)
	i.activeScans[folder.Path] = cancel
	i.scansMu.Unlock()

	defer func() {
		i.scansMu.Lock()
		delete(i.activeScans, folder.Path)
		i.scansMu.Unlock()
		if app := application.Get(); app != nil && app.Event != nil {
			app.Event.Emit("indexing:end", folder.Path)
		}
	}()

	if app := application.Get(); app != nil && app.Event != nil {
		app.Event.Emit("indexing:start", folder.Path)
	}

	status := ScanStatus{
		FolderPath: folder.Path,
		IsRunning:  true,
	}

	knownStates, err := i.database.GetImageFileStatesByFolder(ctx, folder.Path)
	if err != nil {
		log.Printf("Failed preloading file states for %s: %v", folder.Path, err)
		knownStates = map[string]db.ImageRecord{}
	}

	workerCount := max(2, min(runtime.NumCPU(), cap(i.writeSem)))
	paths := make(chan string, workerCount*4)
	var processed atomic.Int64
	var totalFiles atomic.Int64
	var lastEmitNs atomic.Int64 // nanosecond timestamp of last progress emit
	var workers sync.WaitGroup

	// emitProgress fires at most once every 50 ms using a CAS gate so only
	// one goroutine wins the race and the event bus is never flooded.
	emitProgress := func() {
		now := time.Now().UnixNano()
		last := lastEmitNs.Load()
		const minIntervalNs = 50_000_000 // 50 ms
		if now-last >= minIntervalNs && lastEmitNs.CompareAndSwap(last, now) {
			if app := application.Get(); app != nil && app.Event != nil {
				app.Event.Emit("indexing:progress", ScanStatus{
					FolderPath:     folder.Path,
					ProcessedFiles: int(processed.Load()),
					TotalFiles:     int(totalFiles.Load()),
					IsRunning:      true,
				})
			}
		}
	}

	for range make([]struct{}, workerCount) {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for path := range paths {
				select {
				case <-ctx.Done():
					return
				default:
				}

				var stored *db.ImageRecord
				if img, ok := knownStates[path]; ok {
					copy := img
					stored = &copy
				}

				i.processFile(path, stored)
				processed.Add(1)
				emitProgress()
			}
		}()
	}

	err = filepath.WalkDir(folder.Path, func(path string, d fs.DirEntry, err error) error {
		select {
		case <-ctx.Done():
			return filepath.SkipDir
		default:
		}

		if err != nil {
			return nil // skip errors
		}

		if d.IsDir() {
			if path != folder.Path && folder.ScanMode == config.ScanModeNormal {
				return filepath.SkipDir
			}
			// Add to watcher
			if err := i.watcher.Add(path); err != nil {
				log.Printf("Failed to watch folder %s: %v", path, err)
			}
			return nil
		}

		if i.isImageFile(path) {
			totalFiles.Add(1)
			select {
			case <-ctx.Done():
				return filepath.SkipDir
			case paths <- path:
			}
		}
		return nil
	})
	close(paths)
	workers.Wait()
	status.ProcessedFiles = int(processed.Load())
	status.TotalFiles = int(totalFiles.Load())
	status.IsRunning = false
	if app := application.Get(); app != nil && app.Event != nil {
		app.Event.Emit("indexing:progress", status)
	}

	if err != nil {
		log.Printf("Failed scanning folder %s: %v", folder.Path, err)
	}
}

func (i *Indexer) StopScan(folderPath string) {
	i.scansMu.RLock()
	cancel, exists := i.activeScans[folderPath]
	i.scansMu.RUnlock()
	if exists {
		cancel()
	}
}

// StopAllScans cancels all currently running folder scans.
func (i *Indexer) StopAllScans() {
	i.scansMu.RLock()
	cancels := make([]context.CancelFunc, 0, len(i.activeScans))
	for _, cancel := range i.activeScans {
		cancels = append(cancels, cancel)
	}
	i.scansMu.RUnlock()

	for _, cancel := range cancels {
		cancel()
	}
}

func (i *Indexer) isImageFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".png" || ext == ".jpg" || ext == ".jpeg"
}

func (i *Indexer) processFile(path string, stored *db.ImageRecord) {
	var refreshMetadata bool
	if !i.isImageFile(path) {
		return
	}

	ext := strings.ToLower(filepath.Ext(path))
	info, err := os.Stat(path)
	if err != nil {
		return
	}

	modifiedUnixNs := info.ModTime().UnixNano()
	if stored != nil && stored.FileSize == info.Size() && stored.ModifiedUnixNs == modifiedUnixNs {
		refreshMetadata = shouldRefreshPNGMetadata(ext, stored)
		if refreshMetadata {
			log.Printf("Refreshing stale PNG metadata for %s (missing parsed metadata)", path)
		} else if stored.ThumbReady {
			return
		}

		if stored.Hash == "" {
			return
		}

		if !refreshMetadata && i.thumbnailSvc.Exists(stored.Hash) {
			if err := i.database.MarkThumbnailReadyByHash(context.Background(), stored.Hash); err != nil {
				log.Printf("Failed marking existing thumbnail ready for %s: %v", path, err)
				return
			}
			i.emitThumbnailReadyEvent(path, stored.Hash)
			return
		}

		if !refreshMetadata {
			select {
			case <-i.ctx.Done():
				return
			case i.thumbJobs <- thumbnailJob{path: path, hash: stored.Hash}:
			}
			return
		}
	}

	// Acquire semaphore only when a write is actually needed.
	i.writeSem <- struct{}{}
	defer func() { <-i.writeSem }()

	hash, err := i.calculateFastHash(path, info)
	if err != nil {
		return
	}

	var prompt, negPrompt, model, sampler, seed string
	var cfgScale float64
	var width, height int
	metadataStatus := db.MetadataStatusUnknown

	if ext == ".png" {
		meta, parseCtx, err := parser.ParsePNGMetadataWithContext(path)
		if err != nil {
			metadataStatus = db.MetadataStatusMissing
			if refreshMetadata {
				log.Printf("PNG metadata unavailable after refresh for %s: %v", path, err)
			}
		} else {
			if meta == nil {
				meta = &parser.ImageMetadata{}
			}

			if i.pluginManager != nil {
				if pluginMeta, _, pluginErr := i.pluginManager.ParsePNG(parseCtx); pluginErr == nil && pluginMeta != nil {
					meta = mergeParsedMetadata(meta, pluginMeta)
				} else if pluginErr != nil {
					log.Printf("Plugin parse failed for %s: %v", path, pluginErr)
				}
			}

			metadataStatus = classifyMetadataStatus(meta)
			if refreshMetadata {
				if metadataStatus == db.MetadataStatusPresent {
					log.Printf("Fixed stale metadata for %s", path)
				} else {
					log.Printf("PNG metadata unavailable after refresh for %s", path)
				}
			}

			prompt = meta.Prompt
			negPrompt = meta.NegativePrompt
			model = meta.Model
			sampler = meta.Sampler
			seed = meta.Seed
			cfgScale = meta.CfgScale
			width = meta.Width
			height = meta.Height
		}
	}

	record := db.ImageRecord{
		Path:           path,
		Hash:           hash,
		FileSize:       info.Size(),
		ModifiedUnixNs: modifiedUnixNs,
		MetadataStatus: metadataStatus,
		Prompt:         prompt,
		NegativePrompt: negPrompt,
		Model:          model,
		Sampler:        sampler,
		Seed:           seed,
		CfgScale:       cfgScale,
		Width:          width,
		Height:         height,
		AddedAt:        info.ModTime(),
	}

	_, err = i.database.InsertOrUpdateImage(context.Background(), record)
	if err != nil {
		log.Printf("Failed saving image %s to DB: %v", path, err)
		return
	}

	select {
	case <-i.ctx.Done():
		return
	case i.thumbJobs <- thumbnailJob{path: path, hash: hash}:
	}
}

func mergeParsedMetadata(base *parser.ImageMetadata, override *parser.ImageMetadata) *parser.ImageMetadata {
	if base == nil {
		base = &parser.ImageMetadata{}
	}
	if override == nil {
		return base
	}

	result := *base
	if strings.TrimSpace(override.Prompt) != "" {
		result.Prompt = strings.TrimSpace(override.Prompt)
	}
	if strings.TrimSpace(override.NegativePrompt) != "" {
		result.NegativePrompt = strings.TrimSpace(override.NegativePrompt)
	}
	if strings.TrimSpace(override.Model) != "" {
		result.Model = strings.TrimSpace(override.Model)
	}
	if strings.TrimSpace(override.Sampler) != "" {
		result.Sampler = strings.TrimSpace(override.Sampler)
	}
	if strings.TrimSpace(override.Seed) != "" {
		result.Seed = strings.TrimSpace(override.Seed)
	}
	if override.CfgScale != 0 {
		result.CfgScale = override.CfgScale
	}
	if override.Width > 0 {
		result.Width = override.Width
	}
	if override.Height > 0 {
		result.Height = override.Height
	}
	if strings.TrimSpace(override.Raw) != "" {
		result.Raw = strings.TrimSpace(override.Raw)
	}

	return &result
}

func (i *Indexer) RefetchMetadata(path string, mode MetadataRefetchMode, pluginID string) (*db.ImageRecord, error) {
	if !i.isImageFile(path) {
		return nil, fmt.Errorf("unsupported file type")
	}

	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}

	hash, err := i.calculateFastHash(path, info)
	if err != nil {
		return nil, err
	}

	record, err := i.database.GetImageByPath(context.Background(), path)
	if err != nil {
		return nil, err
	}
	if record == nil {
		record = &db.ImageRecord{Path: path, AddedAt: info.ModTime()}
	}

	metadata := &parser.ImageMetadata{}
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".png" {
		builtInMeta, parseCtx, parseErr := parser.ParsePNGMetadataWithContext(path)
		if parseErr == nil && builtInMeta != nil {
			metadata = builtInMeta
		}

		if mode == MetadataRefetchModePlugin {
			if i.pluginManager == nil {
				return nil, fmt.Errorf("plugin manager unavailable")
			}
			pluginMeta, pluginErr := i.pluginManager.ParsePNGWithPlugin(parseCtx, pluginID)
			if pluginErr != nil {
				return nil, pluginErr
			}
			if pluginMeta != nil {
				metadata = mergeParsedMetadata(metadata, pluginMeta)
			}
		}

		record.MetadataStatus = classifyMetadataStatus(metadata)
		if parseErr != nil {
			record.MetadataStatus = db.MetadataStatusMissing
		}
	}

	record.Hash = hash
	record.FileSize = info.Size()
	record.ModifiedUnixNs = info.ModTime().UnixNano()
	record.Prompt = metadata.Prompt
	record.NegativePrompt = metadata.NegativePrompt
	record.Model = metadata.Model
	record.Sampler = metadata.Sampler
	record.Seed = metadata.Seed
	record.CfgScale = metadata.CfgScale
	record.Width = metadata.Width
	record.Height = metadata.Height

	if record.ID == 0 {
		if _, err := i.database.InsertOrUpdateImage(context.Background(), *record); err != nil {
			return nil, err
		}
	} else {
		if err := i.database.UpdateImageMetadataByPath(context.Background(), *record); err != nil {
			return nil, err
		}
	}

	updated, err := i.database.GetImageByPath(context.Background(), path)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return record, nil
	}

	return updated, nil
}

func shouldRefreshPNGMetadata(ext string, stored *db.ImageRecord) bool {
	if stored == nil || ext != ".png" {
		return false
	}

	// Refresh legacy rows that still have unknown metadata status and no parsed metadata.
	if stored.MetadataStatus != db.MetadataStatusUnknown {
		return false
	}

	return strings.TrimSpace(stored.Model) == "" && strings.TrimSpace(stored.Prompt) == ""
}

func classifyMetadataStatus(meta *parser.ImageMetadata) int {
	if hasMeaningfulMetadata(meta) {
		return db.MetadataStatusPresent
	}

	return db.MetadataStatusMissing
}

func hasMeaningfulMetadata(meta *parser.ImageMetadata) bool {
	if meta == nil {
		return false
	}

	if strings.TrimSpace(meta.Prompt) != "" {
		return true
	}
	if strings.TrimSpace(meta.NegativePrompt) != "" {
		return true
	}
	if strings.TrimSpace(meta.Model) != "" {
		return true
	}
	if strings.TrimSpace(meta.Sampler) != "" {
		return true
	}
	if strings.TrimSpace(meta.Seed) != "" {
		return true
	}
	if meta.CfgScale != 0 {
		return true
	}
	if strings.TrimSpace(meta.Raw) != "" {
		return true
	}

	return false
}

// calculateFastHash computes a fast hash using leading 64KB and file size.
// xxh3 is used instead of SHA-256 — it is extremely fast and sufficient for
// a non-security cache key.
func (i *Indexer) calculateFastHash(path string, info os.FileInfo) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	buf := make([]byte, 64*1024)
	n, _ := io.ReadFull(f, buf)

	h := xxh3.New()
	h.Write(buf[:n])
	h.Write([]byte(fmt.Sprintf("%d", info.Size())))

	return fmt.Sprintf("%016x", h.Sum64()), nil
}

func (i *Indexer) watchLoop() {
	defer i.wg.Done()
	for {
		select {
		case <-i.ctx.Done():
			return
		case event, ok := <-i.watcher.Events:
			if !ok {
				return
			}

			if event.Has(fsnotify.Create) || event.Has(fsnotify.Write) {
				time.Sleep(100 * time.Millisecond) // simple debounce

				info, err := os.Stat(event.Name)
				if err == nil {
					if info.IsDir() {
						cfg := i.configManager.GetConfig()
						isWalkMode := false

						for _, folder := range cfg.Folders {
							if strings.HasPrefix(event.Name, folder.Path) && folder.ScanMode == config.ScanModeWalk {
								isWalkMode = true
								break
							}
						}

						if isWalkMode {
							i.watcher.Add(event.Name)
							go i.ScanFolder(config.FolderConfig{Path: event.Name, ScanMode: config.ScanModeWalk})
						}
					} else {
						i.processFile(event.Name, nil)
					}
				}
			} else if event.Has(fsnotify.Remove) || event.Has(fsnotify.Rename) {
				hash, err := i.database.RemoveImageAndGetHash(context.Background(), event.Name)
				if err != nil {
					log.Printf("Failed removing image %s from DB: %v", event.Name, err)
					continue
				}
				if err := i.thumbnailSvc.Delete(hash); err != nil {
					log.Printf("Failed removing thumbnail for %s: %v", event.Name, err)
				}
			}
		case err, ok := <-i.watcher.Errors:
			if !ok {
				return
			}
			log.Println("error:", err)
		}
	}
}

func (i *Indexer) thumbnailWorker() {
	defer i.wg.Done()

	for {
		select {
		case <-i.ctx.Done():
			return
		case job := <-i.thumbJobs:
			if job.path == "" || job.hash == "" {
				continue
			}

			i.thumbSem <- struct{}{}
			_, err := i.thumbnailSvc.Generate(job.path, job.hash)
			<-i.thumbSem
			if err != nil {
				log.Printf("Failed generating thumbnail for %s: %v", job.path, err)
				continue
			}

			if err := i.database.MarkThumbnailReadyByHash(context.Background(), job.hash); err != nil {
				log.Printf("Failed marking thumbnail ready for %s: %v", job.path, err)
				continue
			}

			i.emitThumbnailReadyEvent(job.path, job.hash)
		}
	}
}

func (i *Indexer) emitThumbnailReadyEvent(path, hash string) {
	if app := application.Get(); app != nil && app.Event != nil {
		app.Event.Emit("thumbnail:ready", thumbnailReadyEvent{
			Hash:       hash,
			Path:       path,
			FolderPath: filepath.Dir(path),
		})
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
