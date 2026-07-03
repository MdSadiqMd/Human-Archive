package annotations

import (
	"encoding/json"
	"fmt"
	"net/http"

	"human-archive/backend/internal/middleware"
	"human-archive/backend/internal/models"

	"github.com/go-chi/chi/v5"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) ListQueue(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserIDFromContext(r.Context())
	items, err := h.svc.ListQueue(userID)
	if err != nil {
		jsonErr(w, "failed to list queue: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if items == nil {
		items = []QueueItem{}
	}

	progress, err := h.svc.GetProgress(userID)
	if err != nil {
		jsonErr(w, "failed to get progress: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]any{
		"items":    items,
		"progress": progress,
	}, http.StatusOK)
}

func (h *Handler) GetQueueItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	item, err := h.svc.GetQueueItem(id)
	if err != nil {
		jsonErr(w, "failed to get queue item: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if item == nil {
		jsonErr(w, "queue item not found", http.StatusNotFound)
		return
	}
	jsonOK(w, item, http.StatusOK)
}

func (h *Handler) Submit(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := middleware.UserIDFromContext(r.Context())

	var input models.AnnotationInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		jsonErr(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.svc.Submit(id, userID, input); err != nil {
		jsonErr(w, err.Error(), http.StatusBadRequest)
		return
	}

	jsonOK(w, map[string]string{"status": "completed"}, http.StatusOK)
}

func (h *Handler) Skip(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := middleware.UserIDFromContext(r.Context())

	if err := h.svc.Skip(id, userID); err != nil {
		jsonErr(w, err.Error(), http.StatusBadRequest)
		return
	}

	jsonOK(w, map[string]string{"status": "skipped"}, http.StatusOK)
}

func (h *Handler) ExportByVideo(w http.ResponseWriter, r *http.Request) {
	videoID := r.URL.Query().Get("video_id")
	if videoID == "" {
		jsonErr(w, "video_id is required", http.StatusBadRequest)
		return
	}

	rows, err := h.svc.ExportByVideo(videoID)
	if err != nil {
		jsonErr(w, "export failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if rows == nil {
		rows = []ExportRow{}
	}

	jsonOK(w, rows, http.StatusOK)
}

func (h *Handler) ListReviewAnnotators(w http.ResponseWriter, r *http.Request) {
	annotators, err := h.svc.ListAnnotators()
	if err != nil {
		jsonErr(w, "failed to list annotators: "+err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, annotators, http.StatusOK)
}

func (h *Handler) ListReviews(w http.ResponseWriter, r *http.Request) {
	page := 1
	perPage := 20
	if p := r.URL.Query().Get("page"); p != "" {
		fmt.Sscanf(p, "%d", &page)
	}
	if pp := r.URL.Query().Get("per_page"); pp != "" {
		fmt.Sscanf(pp, "%d", &perPage)
	}
	status := r.URL.Query().Get("status")
	videoID := r.URL.Query().Get("video_id")
	annotatorID := r.URL.Query().Get("annotator_id")

	result, err := h.svc.ListReviews(page, perPage, status, videoID, annotatorID)
	if err != nil {
		jsonErr(w, "failed to list reviews: "+err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, result, http.StatusOK)
}

func (h *Handler) AdminUpdateAnnotation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := middleware.UserIDFromContext(r.Context())

	var input struct {
		NoHands       bool                 `json:"no_hands"`
		BoundingBoxes []models.BoundingBox `json:"bounding_boxes"`
		Notes         string               `json:"notes"`
		ReviewNotes   string               `json:"review_notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		jsonErr(w, "invalid request body", http.StatusBadRequest)
		return
	}

	annotationInput := models.AnnotationInput{
		NoHands:       input.NoHands,
		BoundingBoxes: input.BoundingBoxes,
		Notes:         input.Notes,
	}

	if err := h.svc.AdminUpdateAnnotation(id, userID, annotationInput, input.ReviewNotes); err != nil {
		jsonErr(w, err.Error(), http.StatusBadRequest)
		return
	}

	jsonOK(w, map[string]string{"status": "corrected"}, http.StatusOK)
}

func (h *Handler) AdminApproveAnnotation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := middleware.UserIDFromContext(r.Context())

	var input struct {
		ReviewNotes string `json:"review_notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		jsonErr(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.svc.AdminApproveAnnotation(id, userID, input.ReviewNotes); err != nil {
		jsonErr(w, err.Error(), http.StatusBadRequest)
		return
	}

	jsonOK(w, map[string]string{"status": "approved"}, http.StatusOK)
}

func (h *Handler) AdminRejectAnnotation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := middleware.UserIDFromContext(r.Context())

	var input struct {
		ReviewNotes string `json:"review_notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		jsonErr(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.svc.AdminRejectAnnotation(id, userID, input.ReviewNotes); err != nil {
		jsonErr(w, err.Error(), http.StatusBadRequest)
		return
	}

	jsonOK(w, map[string]string{"status": "rejected"}, http.StatusOK)
}

func (h *Handler) GetAnnotationByFrame(w http.ResponseWriter, r *http.Request) {
	frameID := chi.URLParam(r, "frameId")
	if frameID == "" {
		jsonErr(w, "frameId is required", http.StatusBadRequest)
		return
	}

	annotation, err := h.svc.GetAnnotationByFrame(frameID)
	if err != nil {
		jsonErr(w, "failed to get annotation: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, annotation, http.StatusOK)
}

func jsonOK(w http.ResponseWriter, v any, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, msg string, status int) {
	jsonOK(w, map[string]string{"error": msg}, status)
}
