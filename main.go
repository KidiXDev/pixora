package main

import (
	"embed"
	_ "embed"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"pixora/internal/config"
	"pixora/internal/db"
	"pixora/internal/services"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const (
	defaultWindowWidth  = 1280
	defaultWindowHeight = 720
	windowStateNormal   = "normal"
	windowStateMin      = "minimised"
	windowStateMax      = "maximised"
	windowStateFull     = "fullscreen"
)

//go:embed all:frontend/dist
var assets embed.FS

func init() {
	// Register a custom event whose associated data type is string.
	// This is not required, but the binding generator will pick up registered events
	// and provide a strongly typed JS/TS API for them.
	application.RegisterEvent[string]("time")
}

func main() {
	hideConsoleWindow()

	database, err := db.New()
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer database.Close()

	cfgMgr, err := config.NewManager()
	if err != nil {
		log.Fatalf("Failed to initialize config manager: %v", err)
	}

	thumbSvc, err := services.NewThumbnailService()
	if err != nil {
		log.Fatalf("Failed to initialize thumbnail service: %v", err)
	}

	pluginManager, err := services.NewParserPluginManager(filepath.Join(".", "plugins"))
	if err != nil {
		log.Fatalf("Failed to initialize parser plugin manager: %v", err)
	}

	indexer, err := services.NewIndexer(cfgMgr, database, thumbSvc, pluginManager)
	if err != nil {
		log.Fatalf("Failed to initialize indexer: %v", err)
	}
	defer indexer.Close()

	comfySvc, err := services.NewComfyUIManager(cfgMgr)
	if err != nil {
		log.Fatalf("Failed to initialize ComfyUI manager: %v", err)
	}
	defer func() {
		if stopErr := comfySvc.Stop(); stopErr != nil {
			log.Printf("[pixora] Failed to stop ComfyUI process: %v", stopErr)
		}
	}()

	gallerySvc := services.NewGalleryService(database, cfgMgr, indexer, pluginManager)
	generationSvc := services.NewGenerationService(cfgMgr)

	if appDataDir, err := os.UserConfigDir(); err == nil {
		log.Printf("[pixora] Config dir  : %s", filepath.Join(appDataDir, "pixora"))
		log.Printf("[pixora] Database    : %s", filepath.Join(appDataDir, "pixora", "pixora.db"))
	}
	if cacheDir, err := os.UserCacheDir(); err == nil {
		log.Printf("[pixora] Thumb cache : %s", filepath.Join(cacheDir, "pixora", "thumbs"))
	}
	log.Printf("[pixora] Thumb cache (svc): %s", thumbSvc.CacheDir())

	var mainWindow *application.WebviewWindow

	app := application.New(application.Options{
		Name:        "pixora",
		Description: "pixora",
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.pixora.app",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				if mainWindow != nil {
					mainWindow.Restore()
					mainWindow.Focus()
				}
			},
		},
		Services: []application.Service{
			application.NewService(gallerySvc),
			application.NewService(comfySvc),
			application.NewService(generationSvc),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if strings.HasPrefix(r.URL.Path, "/preview/live/") {
						services.ServeGenerationLivePreview(generationSvc, w, r)
						return
					}
					if strings.HasPrefix(r.URL.Path, "/thumbs/") {
						http.StripPrefix("/thumbs/", http.FileServer(http.Dir(thumbSvc.CacheDir()))).ServeHTTP(w, r)
						return
					}
					if strings.HasPrefix(r.URL.Path, "/image/") {
						imagePath := r.URL.Query().Get("path")
						if imagePath != "" {
							http.ServeFile(w, r, imagePath)
							return
						}
					}
					next.ServeHTTP(w, r)
				})
			},
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	windowOptions := application.WebviewWindowOptions{
		Name:          "main",
		Title:         "Pixora - High Performance Image Browser For AI Gen",
		Frameless:     true,
		DisableResize: false,
		Width:         defaultWindowWidth,
		Height:        defaultWindowHeight,
		MinWidth:      defaultWindowWidth,
		MinHeight:     defaultWindowHeight,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(27, 38, 54),
		URL:              "/",
	}

	windowConfig := cfgMgr.GetConfig().Window
	applyPersistedWindowOptions(&windowOptions, windowConfig)

	mainWindow = app.Window.NewWithOptions(windowOptions)
	bindWindowPersistence(mainWindow, cfgMgr, windowConfig)
	gallerySvc.SetWindow(mainWindow)

	// Create a goroutine that emits an event containing the current time every second.
	// The frontend can listen to this event and update the UI accordingly.
	go func() {
		for {
			now := time.Now().Format(time.RFC1123)
			if app.Event != nil {
				app.Event.Emit("time", now)
			}
			time.Sleep(time.Second)
		}
	}()

	go indexer.ScanAll()

	err = app.Run()

	// If an error occurred while running the application, log it and exit.
	if err != nil {
		log.Fatal(err)
	}
}

func applyPersistedWindowOptions(options *application.WebviewWindowOptions, windowCfg config.WindowConfig) {
	startBounds, hasStartBounds := resolveInitialWindowBounds(windowCfg)
	if hasStartBounds {
		options.Width = maxInt(startBounds.Width, options.MinWidth)
		options.Height = maxInt(startBounds.Height, options.MinHeight)
		options.InitialPosition = application.WindowXY
		options.X = startBounds.X
		options.Y = startBounds.Y
	}

	options.StartState = windowStateToStartState(windowCfg.State)
}

func resolveInitialWindowBounds(windowCfg config.WindowConfig) (config.WindowBounds, bool) {
	if windowCfg.HasNormalBounds && isValidWindowBounds(windowCfg.NormalBounds) {
		return windowCfg.NormalBounds, true
	}

	if windowCfg.HasBounds && isValidWindowBounds(windowCfg.Bounds) {
		return windowCfg.Bounds, true
	}

	return config.WindowBounds{}, false
}

func isValidWindowBounds(bounds config.WindowBounds) bool {
	return bounds.Width > 0 && bounds.Height > 0
}

func bindWindowPersistence(window *application.WebviewWindow, cfgMgr *config.Manager, initial config.WindowConfig) {
	var (
		mu                    sync.Mutex
		current               = initial
		stateBeforeFullscreen = windowStateNormal
		timer                 *time.Timer
	)

	if current.State == "" {
		current.State = windowStateNormal
	}
	if current.State == windowStateNormal || current.State == windowStateMax {
		stateBeforeFullscreen = current.State
	}

	saveNow := func() {
		mu.Lock()
		snapshot := current
		mu.Unlock()

		if err := cfgMgr.SetWindow(snapshot); err != nil {
			log.Printf("[pixora] Failed to persist window state: %v", err)
		}
	}

	queueSave := func() {
		mu.Lock()
		defer mu.Unlock()

		if timer == nil {
			timer = time.AfterFunc(200*time.Millisecond, saveNow)
			return
		}

		timer.Reset(200 * time.Millisecond)
	}

	updateState := func(state string) {
		mu.Lock()
		current.State = state
		if state == windowStateNormal || state == windowStateMax {
			stateBeforeFullscreen = state
		}
		mu.Unlock()
		queueSave()
	}

	getRestoreStateAfterFullscreen := func() string {
		mu.Lock()
		defer mu.Unlock()

		if stateBeforeFullscreen == windowStateMax {
			return windowStateMax
		}

		return windowStateNormal
	}

	updateBounds := func(updateNormal bool) {
		x, y := window.Position()
		width, height := window.Size()
		if width <= 0 || height <= 0 {
			return
		}

		mu.Lock()
		current.Bounds = config.WindowBounds{
			X:      x,
			Y:      y,
			Width:  width,
			Height: height,
		}
		current.HasBounds = true

		if updateNormal {
			current.NormalBounds = current.Bounds
			current.HasNormalBounds = true
		}
		mu.Unlock()

		queueSave()
	}

	currentWindowState := func() string {
		switch {
		case window.IsFullscreen():
			return windowStateFull
		case window.IsMaximised():
			return windowStateMax
		case window.IsMinimised():
			return windowStateMin
		default:
			return windowStateNormal
		}
	}

	window.OnWindowEvent(events.Common.WindowRuntimeReady, func(event *application.WindowEvent) {
		updateState(currentWindowState())
		if !window.IsFullscreen() && !window.IsMaximised() && !window.IsMinimised() {
			updateBounds(true)
			window.SetMinSize(defaultWindowWidth, defaultWindowHeight)
		}
	})

	window.OnWindowEvent(events.Common.WindowDidMove, func(event *application.WindowEvent) {
		if window.IsFullscreen() || window.IsMaximised() || window.IsMinimised() {
			return
		}

		updateState(windowStateNormal)
		updateBounds(true)
	})

	window.OnWindowEvent(events.Common.WindowDidResize, func(event *application.WindowEvent) {
		if window.IsFullscreen() || window.IsMaximised() || window.IsMinimised() {
			return
		}

		updateState(windowStateNormal)
		updateBounds(true)
	})

	window.OnWindowEvent(events.Common.WindowMaximise, func(event *application.WindowEvent) {
		updateState(windowStateMax)
	})

	window.OnWindowEvent(events.Common.WindowUnMaximise, func(event *application.WindowEvent) {
		updateState(windowStateNormal)
		updateBounds(true)
		window.SetMinSize(defaultWindowWidth, defaultWindowHeight)
	})

	window.OnWindowEvent(events.Common.WindowFullscreen, func(event *application.WindowEvent) {
		mu.Lock()
		if current.State == windowStateNormal || current.State == windowStateMax {
			stateBeforeFullscreen = current.State
		}
		mu.Unlock()
		updateState(windowStateFull)
	})

	window.OnWindowEvent(events.Common.WindowUnFullscreen, func(event *application.WindowEvent) {
		restoreState := getRestoreStateAfterFullscreen()
		updateState(restoreState)
		if restoreState == windowStateNormal {
			updateBounds(true)
			window.SetMinSize(defaultWindowWidth, defaultWindowHeight)
		}
	})

	window.OnWindowEvent(events.Common.WindowMinimise, func(event *application.WindowEvent) {
		updateState(windowStateMin)
	})

	window.OnWindowEvent(events.Common.WindowUnMinimise, func(event *application.WindowEvent) {
		state := currentWindowState()
		updateState(state)
		if state == windowStateNormal {
			updateBounds(true)
			window.SetMinSize(defaultWindowWidth, defaultWindowHeight)
		}
	})

	window.OnWindowEvent(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if window.IsFullscreen() {
			updateState(getRestoreStateAfterFullscreen())
		} else if !window.IsMaximised() && !window.IsMinimised() {
			updateBounds(true)
			updateState(windowStateNormal)
		} else {
			updateState(currentWindowState())
		}
		saveNow()
	})
}

func windowStateToStartState(state string) application.WindowState {
	switch strings.ToLower(state) {
	case windowStateMin:
		return application.WindowStateMinimised
	case windowStateMax:
		return application.WindowStateMaximised
	case windowStateFull:
		return application.WindowStateFullscreen
	default:
		return application.WindowStateNormal
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
