package frames

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"human-archive/backend/internal/models"
)

type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

func (s *Service) ListVideos() ([]*models.Video, error) {
	rows, err := s.db.Query(`
		SELECT id, s3_key, stem, fps, duration_s, total_frames, sampled_frames, label_counts, status, ingested_at, ingested_by
		FROM videos ORDER BY ingested_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var videos []*models.Video
	for rows.Next() {
		v, err := scanVideo(rows)
		if err != nil {
			return nil, err
		}
		videos = append(videos, v)
	}
	return videos, rows.Err()
}

func (s *Service) GetVideo(id string) (*models.Video, error) {
	row := s.db.QueryRow(`
		SELECT id, s3_key, stem, fps, duration_s, total_frames, sampled_frames, label_counts, status, ingested_at, ingested_by
		FROM videos WHERE id = $1`, id)
	return scanVideo(row)
}

func (s *Service) ListFrames(videoID, label string, page, perPage int) (*models.PaginatedFrames, error) {
	if perPage <= 0 {
		perPage = 50
	}
	if page <= 0 {
		page = 1
	}

	countArgs := []any{videoID}
	countQuery := "SELECT COUNT(*) FROM frames WHERE video_id = $1"
	if label != "" && label != "all" {
		countQuery += fmt.Sprintf(" AND label = $%d", len(countArgs)+1)
		countArgs = append(countArgs, label)
	}

	var total int
	if err := s.db.QueryRow(countQuery, countArgs...).Scan(&total); err != nil {
		return nil, err
	}

	totalPages := int(math.Ceil(float64(total) / float64(perPage)))
	offset := (page - 1) * perPage

	queryArgs := []any{videoID}
	query := "SELECT id, video_id, frame_index, timestamp_s, label, filename, num_hands, hand_evidence, sample_reason, scores, features FROM frames WHERE video_id = $1"
	if label != "" && label != "all" {
		query += fmt.Sprintf(" AND label = $%d", len(queryArgs)+1)
		queryArgs = append(queryArgs, label)
	}
	query += " ORDER BY frame_index ASC"
	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(queryArgs)+1, len(queryArgs)+2)
	queryArgs = append(queryArgs, perPage, offset)

	rows, err := s.db.Query(query, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var frames []models.Frame
	for rows.Next() {
		var f models.Frame
		var scoresJSON, featuresJSON string
		if err := rows.Scan(&f.ID, &f.VideoID, &f.FrameIndex, &f.TimestampS,
			&f.Label, &f.Filename, &f.NumHands, &f.HandEvidence,
			&f.SampleReason, &scoresJSON, &featuresJSON); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(scoresJSON), &f.Scores)
		json.Unmarshal([]byte(featuresJSON), &f.Features)
		frames = append(frames, f)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if frames == nil {
		frames = []models.Frame{}
	}

	return &models.PaginatedFrames{
		Frames:     frames,
		Total:      total,
		Page:       page,
		PerPage:    perPage,
		TotalPages: totalPages,
	}, nil
}

func (s *Service) GetFrame(id string) (*models.Frame, error) {
	var f models.Frame
	var scoresJSON, featuresJSON string
	err := s.db.QueryRow(`
		SELECT id, video_id, frame_index, timestamp_s, label, filename, num_hands, hand_evidence, sample_reason, scores, features
		FROM frames WHERE id = $1`, id).Scan(
		&f.ID, &f.VideoID, &f.FrameIndex, &f.TimestampS,
		&f.Label, &f.Filename, &f.NumHands, &f.HandEvidence,
		&f.SampleReason, &scoresJSON, &featuresJSON)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	json.Unmarshal([]byte(scoresJSON), &f.Scores)
	json.Unmarshal([]byte(featuresJSON), &f.Features)
	return &f, nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanVideo(row scanner) (*models.Video, error) {
	var v models.Video
	var labelJSON string
	var ingestedUnix int64
	err := row.Scan(&v.ID, &v.S3Key, &v.Stem, &v.FPS, &v.DurationS,
		&v.TotalFrames, &v.SampledFrames, &labelJSON, &v.Status,
		&ingestedUnix, &v.IngestedBy)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	json.Unmarshal([]byte(labelJSON), &v.LabelCounts)
	v.IngestedAt = time.Unix(ingestedUnix, 0).UTC()
	return &v, nil
}
