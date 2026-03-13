package main

import (
	"embed"
	_ "embed"
	"log"
	"net/http"
	"pixora/internal/config"
	"pixora/internal/db"
	"pixora/internal/services"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Wails uses Go's `embed` package to embed the frontend files into the binary.
// Any files in the frontend/dist folder will be embedded into the binary and
// made available to the frontend.
// See https://pkg.go.dev/embed for more information.

//go:embed all:frontend/dist
var assets embed.FS

func init() {
	// Register a custom event whose associated data type is string.
	// This is not required, but the binding generator will pick up registered events
	// and provide a strongly typed JS/TS API for them.
	application.RegisterEvent[string]("time")
}

// main function serves as the application's entry point. It initializes the application, creates a window,
// and starts a goroutine that emits a time-based event every second. It subsequently runs the application and
// logs any error that might occur.
func main() {

	// Initialize backend dependencies
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

	indexer, err := services.NewIndexer(cfgMgr, database, thumbSvc)
	if err != nil {
		log.Fatalf("Failed to initialize indexer: %v", err)
	}
	defer indexer.Close()


	gallerySvc := services.NewGalleryService(database, cfgMgr, indexer)

	// Create a new Wails application by providing the necessary options.
	// Variables 'Name' and 'Description' are for application metadata.
	// 'Assets' configures the asset server with the 'FS' variable pointing to the frontend files.
	// 'Bind' is a list of Go struct instances. The frontend has access to the methods of these instances.
	// 'Mac' options tailor the application when running an macOS.
	app := application.New(application.Options{
		Name:        "pixora",
		Description: "High Performance Image Browser For AI Gen",
		Services: []application.Service{
			application.NewService(gallerySvc),
			application.NewService(&services.GreetService{}), // can be removed eventually
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					// Serve thumbnails from the cache directory
					if strings.HasPrefix(r.URL.Path, "/thumbs/") {
						http.StripPrefix("/thumbs/", http.FileServer(http.Dir(thumbSvc.CacheDir()))).ServeHTTP(w, r)
						return
					}
					// Serve original images from disk securely via path query param
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

	// Create a new window with the necessary options.
	// 'Title' is the title of the window.
	// 'Mac' options tailor the window when running on macOS.
	// 'BackgroundColour' is the background colour of the window.
	// 'URL' is the URL that will be loaded into the webview.
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "Pixora - High Performance Image Browser For AI Gen",
		Frameless: true,
		Width:     1280,
		Height:    720,
		MinWidth:  1280,
		MinHeight: 720,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(27, 38, 54),
		URL:              "/",
	})

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

	// Initial scan in background once app is ready
	go indexer.ScanAll()

	// Run the application. This blocks until the application has been exited.
	err = app.Run()

	// If an error occurred while running the application, log it and exit.
	if err != nil {
		log.Fatal(err)
	}
}
