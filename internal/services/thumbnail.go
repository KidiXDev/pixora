package services

import (
	"errors"
	"image"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"sync"

	xdraw "golang.org/x/image/draw"
)

type ThumbnailService struct {
	cacheDir string
	flightMu sync.Mutex
	inFlight map[string]*thumbGeneration
}

type thumbGeneration struct {
	wg  sync.WaitGroup
	err error
}

func NewThumbnailService() (*ThumbnailService, error) {
	dataDir, err := os.UserCacheDir()
	if err != nil {
		return nil, err
	}

	cacheDir := filepath.Join(dataDir, "pixora", "thumbs")
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return nil, err
	}

	return &ThumbnailService{cacheDir: cacheDir, inFlight: make(map[string]*thumbGeneration)}, nil
}

func (s *ThumbnailService) Generate(originalPath string, hash string) (string, error) {
	if originalPath == "" || hash == "" {
		return "", errors.New("originalPath and hash are required")
	}

	thumbPath := filepath.Join(s.cacheDir, hash+".jpg")

	// Check if already exists
	if _, err := os.Stat(thumbPath); err == nil {
		return thumbPath, nil
	}

	gen := s.beginGeneration(hash)
	if gen != nil {
		gen.wg.Wait()
		if gen.err != nil {
			return "", gen.err
		}
		return thumbPath, nil
	}

	err := s.generateAndStore(originalPath, thumbPath)
	s.endGeneration(hash, err)
	if err != nil {
		return "", err
	}

	return thumbPath, nil
}

func (s *ThumbnailService) beginGeneration(hash string) *thumbGeneration {
	s.flightMu.Lock()
	defer s.flightMu.Unlock()

	if gen, ok := s.inFlight[hash]; ok {
		return gen
	}

	gen := &thumbGeneration{}
	gen.wg.Add(1)
	s.inFlight[hash] = gen
	return nil
}

func (s *ThumbnailService) endGeneration(hash string, err error) {
	s.flightMu.Lock()
	gen := s.inFlight[hash]
	delete(s.inFlight, hash)
	s.flightMu.Unlock()

	if gen != nil {
		gen.err = err
		gen.wg.Done()
	}
}

func (s *ThumbnailService) generateAndStore(originalPath string, thumbPath string) error {
	src, err := os.Open(originalPath)
	if err != nil {
		return err
	}
	defer src.Close()

	img, _, err := image.Decode(src)
	if err != nil {
		return err
	}

	thumb := resizeToFit(img, 400, 400)

	tmpFile, err := os.CreateTemp(s.cacheDir, "thumb-*.jpg")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()

	defer func() {
		tmpFile.Close()
		_ = os.Remove(tmpPath)
	}()

	if err := jpeg.Encode(tmpFile, thumb, &jpeg.Options{Quality: 82}); err != nil {
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}

	if err := os.Rename(tmpPath, thumbPath); err != nil {
		return err
	}

	return nil
}

func resizeToFit(img image.Image, maxWidth, maxHeight int) image.Image {
	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	if width <= maxWidth && height <= maxHeight {
		return img
	}

	scaleW := float64(maxWidth) / float64(width)
	scaleH := float64(maxHeight) / float64(height)
	scale := minFloat(scaleW, scaleH)

	newWidth := maxIntThumb(1, int(float64(width)*scale))
	newHeight := maxIntThumb(1, int(float64(height)*scale))

	dst := image.NewRGBA(image.Rect(0, 0, newWidth, newHeight))
	xdraw.ApproxBiLinear.Scale(dst, dst.Bounds(), img, bounds, draw.Over, nil)

	return dst
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func maxIntThumb(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func (s *ThumbnailService) CacheDir() string {
	return s.cacheDir
}

func (s *ThumbnailService) Delete(hash string) error {
	if hash == "" {
		return nil
	}

	err := os.Remove(filepath.Join(s.cacheDir, hash+".jpg"))
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	return nil
}

func (s *ThumbnailService) DeleteMany(hashes []string) error {
	for _, hash := range hashes {
		if err := s.Delete(hash); err != nil {
			return err
		}
	}

	return nil
}

func (s *ThumbnailService) Exists(hash string) bool {
	if hash == "" {
		return false
	}
	_, err := os.Stat(filepath.Join(s.cacheDir, hash+".jpg"))
	return err == nil
}

// ClearCache removes and recreates the thumbnail cache directory.
func (s *ThumbnailService) ClearCache() error {
	s.flightMu.Lock()
	s.inFlight = make(map[string]*thumbGeneration)
	s.flightMu.Unlock()

	if err := os.RemoveAll(s.cacheDir); err != nil {
		return err
	}

	return os.MkdirAll(s.cacheDir, 0755)
}
