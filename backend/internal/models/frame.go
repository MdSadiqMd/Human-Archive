package models

type Frame struct {
	ID           string         `json:"id"`
	VideoID      string         `json:"video_id"`
	FrameIndex   int            `json:"frame_index"`
	TimestampS   float64        `json:"timestamp_s"`
	Label        string         `json:"label"`
	Filename     string         `json:"filename"`
	NumHands     int            `json:"num_hands"`
	HandEvidence float64        `json:"hand_evidence"`
	SampleReason string         `json:"sample_reason"`
	Scores       map[string]any `json:"scores"`
	Features     map[string]any `json:"features"`
}

type FrameWithAssignment struct {
	Frame
	AssignmentID     *string `json:"assignment_id,omitempty"`
	AssignmentStatus *string `json:"assignment_status,omitempty"`
	AssigneeID       *string `json:"assignee_id,omitempty"`
}

type PaginatedFrames struct {
	Frames      []Frame `json:"frames"`
	Total       int     `json:"total"`
	Page        int     `json:"page"`
	PerPage     int     `json:"per_page"`
	TotalPages  int     `json:"total_pages"`
}
