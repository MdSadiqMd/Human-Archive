package frames

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"human-archive/backend/internal/models"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) ListVideos(w http.ResponseWriter, r *http.Request) {
	videos, err := h.svc.ListVideos()
	if err != nil {
		jsonErr(w, "failed to list videos: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if videos == nil {
		videos = []*models.Video{}
	}
	jsonOK(w, videos, http.StatusOK)
}

func (h *Handler) GetVideo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	video, err := h.svc.GetVideo(id)
	if err != nil {
		jsonErr(w, "failed to get video: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if video == nil {
		jsonErr(w, "video not found", http.StatusNotFound)
		return
	}
	jsonOK(w, video, http.StatusOK)
}

func (h *Handler) ListFrames(w http.ResponseWriter, r *http.Request) {
	videoID := chi.URLParam(r, "id")
	label := r.URL.Query().Get("label")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	perPage, _ := strconv.Atoi(r.URL.Query().Get("per_page"))

	result, err := h.svc.ListFrames(videoID, label, page, perPage)
	if err != nil {
		jsonErr(w, "failed to list frames: "+err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, result, http.StatusOK)
}

func (h *Handler) GetFrame(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	frame, err := h.svc.GetFrame(id)
	if err != nil {
		jsonErr(w, "failed to get frame: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if frame == nil {
		jsonErr(w, "frame not found", http.StatusNotFound)
		return
	}
	jsonOK(w, frame, http.StatusOK)
}

func jsonOK(w http.ResponseWriter, v any, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, msg string, status int) {
	jsonOK(w, map[string]string{"error": msg}, status)
}
