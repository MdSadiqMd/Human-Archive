package models

import "time"

type BoundingBox struct {
	ID       string  `json:"id"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Width    float64 `json:"width"`
	Height   float64 `json:"height"`
	Rotation float64 `json:"rotation"`
	Hand     string  `json:"hand"`
}

type Annotation struct {
	ID            string        `json:"id"`
	AssignmentID  string        `json:"assignment_id"`
	FrameID       string        `json:"frame_id"`
	AnnotatorID   string        `json:"annotator_id"`
	NoHands       bool          `json:"no_hands"`
	LeftHand      bool          `json:"left_hand"`
	RightHand     bool          `json:"right_hand"`
	BoundingBoxes []BoundingBox `json:"bounding_boxes"`
	Notes         string        `json:"notes"`
	CreatedAt     time.Time     `json:"created_at"`
	UpdatedAt     time.Time     `json:"updated_at"`
}

type AnnotationInput struct {
	NoHands       bool          `json:"no_hands"`
	BoundingBoxes []BoundingBox `json:"bounding_boxes"`
	Notes         string        `json:"notes"`
}
