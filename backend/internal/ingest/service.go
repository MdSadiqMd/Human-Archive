package ingest

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

type reportPayload struct {
	Video string `json:"video"`
	Stats struct {
		VideoPath     string         `json:"video_path"`
		TotalFrames   int            `json:"total_frames_seen"`
		SampledFrames int            `json:"sampled_frames"`
		FPS           float64        `json:"fps"`
		DurationS     float64        `json:"duration_s"`
		LabelCounts   map[string]int `json:"label_counts"`
	} `json:"stats"`
	Frames []reportFrame `json:"frames"`
}

type reportFrame struct {
	FrameIndex   int            `json:"frame_index"`
	TimestampS   float64        `json:"timestamp_s"`
	Label        string         `json:"label"`
	Scores       map[string]any `json:"scores"`
	HandEvidence float64        `json:"hand_evidence"`
	NumHands     int            `json:"num_hands"`
	Features     map[string]any `json:"features"`
}

func (s *Service) IngestDirectory(dir string, userID string) (int, int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, 0, fmt.Errorf("read dir %s: %w", dir, err)
	}

	var videosIngested int
	var framesIngested int

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		stem := entry.Name()
		reportPath := filepath.Join(dir, stem, "report.json")
		if _, err := os.Stat(reportPath); os.IsNotExist(err) {
			continue
		}

		ingested, frameCount, err := s.ingestOne(stem, reportPath, userID)
		if err != nil {
			return videosIngested, framesIngested, fmt.Errorf("ingest %s: %w", stem, err)
		}
		if ingested {
			videosIngested++
			framesIngested += frameCount
		}
	}

	return videosIngested, framesIngested, nil
}

func (s *Service) ingestOne(stem, reportPath, userID string) (bool, int, error) {
	var exists int
	s.db.QueryRow("SELECT COUNT(*) FROM videos WHERE stem = $1", stem).Scan(&exists)
	if exists > 0 {
		return false, 0, nil
	}

	raw, err := os.ReadFile(reportPath)
	if err != nil {
		return false, 0, fmt.Errorf("read report: %w", err)
	}

	var r reportPayload
	if err := json.Unmarshal(raw, &r); err != nil {
		return false, 0, fmt.Errorf("parse report: %w", err)
	}

	labelJSON, _ := json.Marshal(r.Stats.LabelCounts)
	now := time.Now().Unix()

	videoID := uuid.New().String()
	videoPath := r.Video
	base := strings.TrimSuffix(filepath.Base(videoPath), filepath.Ext(videoPath))

	_, err = s.db.Exec(`
		INSERT INTO videos (id, s3_key, stem, fps, duration_s, total_frames, sampled_frames, label_counts, status, ingested_at, ingested_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ingested', $9, $10)
		ON CONFLICT (stem) DO NOTHING`,
		videoID, r.Video, stem, r.Stats.FPS, r.Stats.DurationS,
		r.Stats.TotalFrames, r.Stats.SampledFrames, string(labelJSON),
		now, userID,
	)
	if err != nil {
		return false, 0, fmt.Errorf("insert video: %w", err)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return false, 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO frames (id, video_id, frame_index, timestamp_s, label, filename, num_hands, hand_evidence, sample_reason, scores, features)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (video_id, frame_index) DO NOTHING`)
	if err != nil {
		return false, 0, fmt.Errorf("prepare stmt: %w", err)
	}
	defer stmt.Close()

	var count int
	for _, f := range r.Frames {
		sampleReason, _ := f.Features["sample_reason"].(string)
		filename := fmt.Sprintf("%s_%07d_%s.jpg", base, f.FrameIndex, sampleReason)

		scoresJSON, _ := json.Marshal(f.Scores)
		featuresJSON, _ := json.Marshal(f.Features)

		frameID := uuid.New().String()
		_, err := stmt.Exec(
			frameID, videoID, f.FrameIndex, f.TimestampS, f.Label,
			filename, f.NumHands, f.HandEvidence, sampleReason,
			string(scoresJSON), string(featuresJSON),
		)
		if err != nil {
			return false, 0, fmt.Errorf("insert frame %d: %w", f.FrameIndex, err)
		}
		count++
	}

	if err := tx.Commit(); err != nil {
		return false, 0, fmt.Errorf("commit tx: %w", err)
	}

	return true, count, nil
}
