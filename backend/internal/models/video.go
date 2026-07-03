package models

import "time"

type Video struct {
	ID            string            `json:"id"`
	S3Key         string            `json:"s3_key"`
	Stem          string            `json:"stem"`
	FPS           float64           `json:"fps"`
	DurationS     float64           `json:"duration_s"`
	TotalFrames   int               `json:"total_frames"`
	SampledFrames int               `json:"sampled_frames"`
	LabelCounts   map[string]int    `json:"label_counts"`
	Status        string            `json:"status"`
	IngestedAt    time.Time         `json:"ingested_at"`
	IngestedBy    string            `json:"ingested_by"`
}
