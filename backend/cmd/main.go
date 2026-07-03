package main

import (
	"context"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"human-archive/backend/internal/admin"
	"human-archive/backend/internal/annotations"
	"human-archive/backend/internal/assignments"
	"human-archive/backend/internal/auth"
	"human-archive/backend/internal/config"
	"human-archive/backend/internal/db"
	"human-archive/backend/internal/frames"
	"human-archive/backend/internal/ingest"
	"human-archive/backend/internal/middleware"
	"human-archive/backend/internal/s3client"
)

func main() {
	cfg := config.Load()

	database, err := db.New(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db open: %v", err)
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		log.Fatalf("db migrate: %v", err)
	}

	if cfg.AdminPassword != "" {
		if err := auth.SeedAdmin(database, cfg.AdminEmail, cfg.AdminPassword); err != nil {
			log.Fatalf("seed admin: %v", err)
		}
	} else {
		var count int
		database.QueryRow("SELECT COUNT(*) FROM users WHERE role = 'admin'").Scan(&count)
		if count == 0 {
			log.Fatal("no admin exists and ADMIN_PASSWORD is not set")
		}
	}

	authSvc := auth.NewService(database, cfg.JWTSecret)
	adminSvc := admin.NewService(database)
	ingestSvc := ingest.NewService(database)
	framesSvc := frames.NewService(database)
	assignmentsSvc := assignments.NewService(database)
	annotationsSvc := annotations.NewService(database)

	authH := auth.NewHandler(authSvc)
	adminH := admin.NewHandler(adminSvc)
	ingestH := ingest.NewHandler(ingestSvc)
	framesH := frames.NewHandler(framesSvc)
	assignmentsH := assignments.NewHandler(assignmentsSvc)
	annotationsH := annotations.NewHandler(annotationsSvc)

	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Accept", "Authorization", "Content-Type"},
		MaxAge:         300,
	}))

	r.Route("/auth", func(r chi.Router) {
		r.Post("/register", authH.Register)
		r.Post("/login", authH.Login)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireAuth(cfg))
			r.Get("/me", authH.Me)
			r.Post("/logout", authH.Logout)
		})
	})

	r.Route("/admin", func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg))
		r.Use(middleware.RequireAdmin)

		// Users
		r.Get("/users", adminH.ListUsers)
		r.Get("/users/pending", adminH.ListPending)
		r.Post("/users/{id}/approve", adminH.ApproveUser)
		r.Post("/users/{id}/reject", adminH.RejectUser)
		r.Delete("/users/{id}", adminH.DeleteUser)

		// Ingest
		r.Post("/ingest", ingestH.Ingest)

		// Videos
		r.Get("/videos", framesH.ListVideos)
		r.Get("/videos/{id}", framesH.GetVideo)
		r.Get("/videos/{id}/frames", framesH.ListFrames)

		// Frames
		r.Get("/frames/{id}", framesH.GetFrame)
		r.Get("/frames/{frameId}/annotation", annotationsH.GetAnnotationByFrame)

		// Assignments
		r.Post("/assignments", assignmentsH.AssignFrames)
		r.Post("/assignments/by-filter", assignmentsH.AssignByFilter)
		r.Get("/assignments", assignmentsH.ListAssignments)
		r.Delete("/assignments/{id}", assignmentsH.DeleteAssignment)

		// Reviews
		r.Get("/reviews", annotationsH.ListReviews)
		r.Get("/reviews/annotators", annotationsH.ListReviewAnnotators)

		// Admin annotation correction
		r.Put("/annotations/{id}", annotationsH.AdminUpdateAnnotation)
		r.Post("/annotations/{id}/approve", annotationsH.AdminApproveAnnotation)
		r.Post("/annotations/{id}/reject", annotationsH.AdminRejectAnnotation)

		// Export
		r.Get("/export", annotationsH.ExportByVideo)
	})

	// Annotator queue
	r.Route("/queue", func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg))
		r.Get("/", annotationsH.ListQueue)
		r.Get("/{id}", annotationsH.GetQueueItem)
		r.Post("/{id}/submit", annotationsH.Submit)
		r.Post("/{id}/skip", annotationsH.Skip)
	})

	// Frame files — authenticated; served from S3 (if configured) or local filesystem
	absFrames, _ := filepath.Abs(cfg.FramesDir)
	fileServer := http.StripPrefix("/frames/", http.FileServer(http.Dir(absFrames)))

	var s3c *s3.Client
	if cfg.S3Bucket != "" {
		var err error
		s3c, err = s3client.New(context.Background(), cfg.S3Region)
		if err != nil {
			log.Printf("s3 client init failed, falling back to local frames: %v", err)
		} else {
			log.Printf("serving frames from s3://%s", cfg.S3Bucket)
		}
	}

	r.Route("/frames", func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg))
		r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
			if s3c != nil {
				key := strings.TrimPrefix(r.URL.Path, "/frames/")
				result, err := s3c.GetObject(context.Background(), &s3.GetObjectInput{
					Bucket: aws.String(cfg.S3Bucket),
					Key:    aws.String(key),
				})
				if err == nil {
					defer result.Body.Close()
					w.Header().Set("Content-Type", "image/jpeg")
					io.Copy(w, result.Body)
					return
				}
				log.Printf("s3 fetch failed for %s: %v, trying local", key, err)
			}
			fileServer.ServeHTTP(w, r)
		})
	})

	log.Printf("listening on :%s", cfg.Port)
	log.Fatal(http.ListenAndServe(":"+cfg.Port, r))
}
