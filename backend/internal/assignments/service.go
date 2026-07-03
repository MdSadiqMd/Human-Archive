package assignments

import (
	"database/sql"
	"fmt"
	"time"

	"human-archive/backend/internal/models"

	"github.com/google/uuid"
)

type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

func (s *Service) AssignFrames(frameIDs []string, assigneeID, assignedBy string) (int, error) {
	now := time.Now().Unix()
	var count int

	tx, err := s.db.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO assignments (id, frame_id, assignee_id, assigned_by, status, assigned_at)
		VALUES ($1, $2, $3, $4, 'pending', $5)
		ON CONFLICT (frame_id, assignee_id) DO NOTHING`)
	if err != nil {
		return 0, fmt.Errorf("prepare stmt: %w", err)
	}
	defer stmt.Close()

	for _, fid := range frameIDs {
		id := uuid.New().String()
		res, err := stmt.Exec(id, fid, assigneeID, assignedBy, now)
		if err != nil {
			return 0, fmt.Errorf("insert assignment: %w", err)
		}
		n, _ := res.RowsAffected()
		count += int(n)
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit tx: %w", err)
	}
	return count, nil
}

func (s *Service) AssignByFilter(videoID, label, assigneeID, assignedBy string) (int, error) {
	args := []any{}
	query := "SELECT id FROM frames WHERE 1=1"
	argIdx := 1

	if videoID != "" {
		query += fmt.Sprintf(" AND video_id = $%d", argIdx)
		args = append(args, videoID)
		argIdx++
	}
	if label != "" && label != "all" {
		query += fmt.Sprintf(" AND label = $%d", argIdx)
		args = append(args, label)
		argIdx++
	}

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	var frameIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return 0, err
		}
		frameIDs = append(frameIDs, id)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	return s.AssignFrames(frameIDs, assigneeID, assignedBy)
}

type AssignmentWithDetails struct {
	models.Assignment
	FrameIndex int    `json:"frame_index"`
	Label      string `json:"label"`
	Filename   string `json:"filename"`
	VideoStem  string `json:"video_stem"`
}

func (s *Service) ListAssignments(videoID string) ([]AssignmentWithDetails, error) {
	query := `
		SELECT a.id, a.frame_id, a.assignee_id, a.assigned_by, a.status, a.assigned_at, a.completed_at,
		       f.frame_index, f.label, f.filename, v.stem
		FROM assignments a
		JOIN frames f ON f.id = a.frame_id
		JOIN videos v ON v.id = f.video_id`
	args := []any{}
	if videoID != "" {
		query += " WHERE f.video_id = $1"
		args = append(args, videoID)
	}
	query += " ORDER BY a.assigned_at DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []AssignmentWithDetails
	for rows.Next() {
		var item AssignmentWithDetails
		var assignedUnix, completedUnix sql.NullInt64
		if err := rows.Scan(&item.ID, &item.FrameID, &item.AssigneeID, &item.AssignedBy,
			&item.Status, &assignedUnix, &completedUnix,
			&item.FrameIndex, &item.Label, &item.Filename, &item.VideoStem); err != nil {
			return nil, err
		}
		item.AssignedAt = time.Unix(assignedUnix.Int64, 0).UTC()
		if completedUnix.Valid {
			t := time.Unix(completedUnix.Int64, 0).UTC()
			item.CompletedAt = &t
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Service) DeleteAssignment(id string) error {
	res, err := s.db.Exec(`DELETE FROM assignments WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("assignment not found")
	}
	return nil
}
