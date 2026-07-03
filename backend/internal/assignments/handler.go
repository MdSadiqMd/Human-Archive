package assignments

import (
	"encoding/json"
	"net/http"

	"human-archive/backend/internal/middleware"

	"github.com/go-chi/chi/v5"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) AssignFrames(w http.ResponseWriter, r *http.Request) {
	var req struct {
		FrameIDs   []string `json:"frame_ids"`
		AssigneeID string   `json:"assignee_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.FrameIDs) == 0 || req.AssigneeID == "" {
		jsonErr(w, "frame_ids and assignee_id are required", http.StatusBadRequest)
		return
	}

	userID := middleware.UserIDFromContext(r.Context())
	count, err := h.svc.AssignFrames(req.FrameIDs, req.AssigneeID, userID)
	if err != nil {
		jsonErr(w, "assign failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{"assigned": count}, http.StatusOK)
}

func (h *Handler) AssignByFilter(w http.ResponseWriter, r *http.Request) {
	var req struct {
		VideoID    string `json:"video_id"`
		Label      string `json:"label"`
		AssigneeID string `json:"assignee_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.AssigneeID == "" {
		jsonErr(w, "assignee_id is required", http.StatusBadRequest)
		return
	}

	userID := middleware.UserIDFromContext(r.Context())
	count, err := h.svc.AssignByFilter(req.VideoID, req.Label, req.AssigneeID, userID)
	if err != nil {
		jsonErr(w, "assign failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{"assigned": count}, http.StatusOK)
}

func (h *Handler) ListAssignments(w http.ResponseWriter, r *http.Request) {
	videoID := r.URL.Query().Get("video_id")
	assignments, err := h.svc.ListAssignments(videoID)
	if err != nil {
		jsonErr(w, "list assignments failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if assignments == nil {
		assignments = []AssignmentWithDetails{}
	}
	jsonOK(w, assignments, http.StatusOK)
}

func (h *Handler) DeleteAssignment(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.svc.DeleteAssignment(id); err != nil {
		jsonErr(w, err.Error(), http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func jsonOK(w http.ResponseWriter, v any, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, msg string, status int) {
	jsonOK(w, map[string]string{"error": msg}, status)
}
