package ingest

import (
	"encoding/json"
	"net/http"

	"human-archive/backend/internal/middleware"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Ingest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Directory string `json:"directory"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Directory == "" {
		jsonErr(w, "directory is required", http.StatusBadRequest)
		return
	}

	userID := middleware.UserIDFromContext(r.Context())
	videos, frames, err := h.svc.IngestDirectory(req.Directory, userID)
	if err != nil {
		jsonErr(w, "ingest failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]any{
		"message": "ingest complete",
		"videos":  videos,
		"frames":  frames,
	}, http.StatusOK)
}

func jsonOK(w http.ResponseWriter, v any, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, msg string, status int) {
	jsonOK(w, map[string]string{"error": msg}, status)
}
