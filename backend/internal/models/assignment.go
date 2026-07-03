package models

import "time"

type Assignment struct {
	ID           string     `json:"id"`
	FrameID      string     `json:"frame_id"`
	AssigneeID   string     `json:"assignee_id"`
	AssignedBy   string     `json:"assigned_by"`
	Status       string     `json:"status"`
	AssignedAt   time.Time  `json:"assigned_at"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
}
