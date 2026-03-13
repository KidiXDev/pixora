package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"pixora/internal/config"
	"pixora/internal/db"
	"pixora/internal/parser"

	"github.com/fsnotify/fsnotify"
)

type Indexer struct {
	configManager *config.Manager
	database      *db.DB
	thumbnailSvc  *ThumbnailService
	watcher       *fsnotify.Watcher
	ctx           context.Context
	cancel        context.CancelFunc
	wg            sync.WaitGroup
}

func NewIndexer(cfgMgr *config.Manager, database *db.DB, thumbSvc *ThumbnailService) (*Indexer, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())

	indexer := &Indexer{
		configManager: cfgMgr,
		database:      database,
		thumbnailSvc:  thumbSvc,
		watcher:       watcher,
		ctx:           ctx,
		cancel:        cancel,
	}

	indexer.wg.Add(1)
	go indexer.watchLoop()

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
	err := filepath.WalkDir(folder.Path, func(path string, d fs.DirEntry, err error) error {
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

		i.processFile(path)
		return nil
	})

	if err != nil {
		log.Printf("Failed scanning folder %s: %v", folder.Path, err)
	}
}

func (i *Indexer) processFile(path string) {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".png" && ext != ".jpg" && ext != ".jpeg" {
		return
	}

	info, err := os.Stat(path)
	if err != nil {
		return
	}

	hash, err := i.calculateFastHash(path, info)
	if err != nil {
		return
	}

	var prompt, negPrompt, model, sampler, seed string
	var cfgScale float64
	var width, height int

	if ext == ".png" {
		meta, err := parser.ParsePNGMetadata(path)
		if err == nil && meta != nil {
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

	// Generate thumbnail (this is bound to be slower, so we do it asynchronously for very large scans, but fits fine here)
	_, err = i.thumbnailSvc.Generate(path, hash)
	if err != nil {
		// Log but don't fail parsing
		log.Printf("Failed generating thumbnail for %s: %v", path, err)
	}
}

// calculateFastHash computes a fast hash using leading 64KB and file size 
// to avoid stalling on large image headers
func (i *Indexer) calculateFastHash(path string, info os.FileInfo) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	buf := make([]byte, 64*1024)
	n, _ := io.ReadFull(f, buf)
	
	h := sha256.New()
	h.Write(buf[:n])
	
	size := fmt.Sprintf("%d", info.Size())
	h.Write([]byte(size))

	return hex.EncodeToString(h.Sum(nil)), nil
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
						i.processFile(event.Name)
					}
				}
			} else if event.Has(fsnotify.Remove) || event.Has(fsnotify.Rename) {
				i.database.RemoveImage(context.Background(), event.Name)
			}
		case err, ok := <-i.watcher.Errors:
			if !ok {
				return
			}
			log.Println("error:", err)
		}
	}
}
