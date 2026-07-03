package annotations

import (
	"database/sql"
	"encoding/json"
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

type QueueItem struct {
	AssignmentID string  `json:"assignment_id"`
	FrameID      string  `json:"frame_id"`
	FrameIndex   int     `json:"frame_index"`
	Label        string  `json:"label"`
	Filename     string  `json:"filename"`
	VideoStem    string  `json:"video_stem"`
	TimestampS   float64 `json:"timestamp_s"`
	NumHands     int     `json:"num_hands"`
	HandEvidence float64 `json:"hand_evidence"`
}

type QueueProgress struct {
	Pending   int `json:"pending"`
	Completed int `json:"completed"`
	Skipped   int `json:"skipped"`
	Total     int `json:"total"`
}

func (s *Service) ListQueue(annotatorID string) ([]QueueItem, error) {
	rows, err := s.db.Query(`
		SELECT a.id, a.frame_id, f.frame_index, f.label, f.filename, v.stem, f.timestamp_s, f.num_hands, f.hand_evidence
		FROM assignments a
		JOIN frames f ON f.id = a.frame_id
		JOIN videos v ON v.id = f.video_id
		WHERE a.assignee_id = $1 AND a.status = 'pending'
		ORDER BY a.assigned_at ASC`, annotatorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []QueueItem
	for rows.Next() {
		var item QueueItem
		if err := rows.Scan(&item.AssignmentID, &item.FrameID, &item.FrameIndex,
			&item.Label, &item.Filename, &item.VideoStem, &item.TimestampS,
			&item.NumHands, &item.HandEvidence); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) GetProgress(annotatorID string) (*QueueProgress, error) {
	var p QueueProgress
	err := s.db.QueryRow(`
		SELECT
			COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END), 0),
			COUNT(*)
		FROM assignments WHERE assignee_id = $1`, annotatorID).Scan(
		&p.Pending, &p.Completed, &p.Skipped, &p.Total)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Service) GetQueueItem(assignmentID string) (*QueueItem, error) {
	var item QueueItem
	err := s.db.QueryRow(`
		SELECT a.id, a.frame_id, f.frame_index, f.label, f.filename, v.stem, f.timestamp_s, f.num_hands, f.hand_evidence
		FROM assignments a
		JOIN frames f ON f.id = a.frame_id
		JOIN videos v ON v.id = f.video_id
		WHERE a.id = $1`, assignmentID).Scan(
		&item.AssignmentID, &item.FrameID, &item.FrameIndex,
		&item.Label, &item.Filename, &item.VideoStem, &item.TimestampS,
		&item.NumHands, &item.HandEvidence)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (s *Service) Submit(assignmentID, annotatorID string, input models.AnnotationInput) error {
	var dbAssigneeID string
	err := s.db.QueryRow(`SELECT assignee_id FROM assignments WHERE id = $1 AND status = 'pending'`, assignmentID).Scan(&dbAssigneeID)
	if err == sql.ErrNoRows {
		return fmt.Errorf("assignment not found or not pending")
	}
	if err != nil {
		return fmt.Errorf("query assignment: %w", err)
	}
	if dbAssigneeID != annotatorID {
		return fmt.Errorf("not your assignment")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	var frameID string
	err = tx.QueryRow(`SELECT frame_id FROM assignments WHERE id = $1 FOR UPDATE`, assignmentID).Scan(&frameID)
	if err != nil {
		return fmt.Errorf("lock assignment: %w", err)
	}

	now := time.Now().Unix()
	annotationID := uuid.New().String()

	leftHand := false
	rightHand := false
	for _, box := range input.BoundingBoxes {
		if box.Hand == "left" {
			leftHand = true
		} else if box.Hand == "right" {
			rightHand = true
		}
	}

	boxesJSON, err := json.Marshal(input.BoundingBoxes)
	if err != nil {
		return fmt.Errorf("marshal bounding boxes: %w", err)
	}

	_, err = tx.Exec(`
		INSERT INTO annotations (id, assignment_id, frame_id, annotator_id, no_hands, left_hand, right_hand, bounding_boxes, notes, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		annotationID, assignmentID, frameID, annotatorID,
		input.NoHands, leftHand, rightHand, boxesJSON, input.Notes, now, now)
	if err != nil {
		return fmt.Errorf("insert annotation: %w", err)
	}

	_, err = tx.Exec(`UPDATE assignments SET status = 'completed', completed_at = $1 WHERE id = $2`, now, assignmentID)
	if err != nil {
		return fmt.Errorf("update assignment: %w", err)
	}

	return tx.Commit()
}

func (s *Service) Skip(assignmentID, annotatorID string) error {
	res, err := s.db.Exec(`
		UPDATE assignments SET status = 'skipped', completed_at = $1
		WHERE id = $2 AND assignee_id = $3 AND status = 'pending'`,
		time.Now().Unix(), assignmentID, annotatorID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("assignment not found or not yours to skip")
	}
	return nil
}

type ExportRow struct {
	FrameIndex     int                  `json:"frame_index"`
	TimestampS     float64              `json:"timestamp_s"`
	Label          string               `json:"label"`
	NoHands        bool                 `json:"no_hands"`
	LeftHand       bool                 `json:"left_hand"`
	RightHand      bool                 `json:"right_hand"`
	BoundingBoxes  []models.BoundingBox `json:"bounding_boxes"`
	Notes          string               `json:"notes"`
	AnnotatorID    string               `json:"annotator_id"`
	AnnotatorEmail string               `json:"annotator_email"`
}

func (s *Service) ExportByVideo(videoID string) ([]ExportRow, error) {
	rows, err := s.db.Query(`
		SELECT f.frame_index, f.timestamp_s, f.label,
		       an.no_hands, an.left_hand, an.right_hand, an.bounding_boxes, an.notes,
		       an.annotator_id, u.email
		FROM annotations an
		JOIN frames f ON f.id = an.frame_id
		JOIN users u ON u.id = an.annotator_id
		WHERE f.video_id = $1
		ORDER BY f.frame_index ASC`, videoID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []ExportRow
	for rows.Next() {
		var row ExportRow
		var boxesJSON []byte
		if err := rows.Scan(&row.FrameIndex, &row.TimestampS, &row.Label,
			&row.NoHands, &row.LeftHand, &row.RightHand, &boxesJSON, &row.Notes,
			&row.AnnotatorID, &row.AnnotatorEmail); err != nil {
			return nil, err
		}
		if len(boxesJSON) > 0 {
			json.Unmarshal(boxesJSON, &row.BoundingBoxes)
		}
		if row.BoundingBoxes == nil {
			row.BoundingBoxes = []models.BoundingBox{}
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

type AnnotationWithMeta struct {
	ID                    string               `json:"id"`
	FrameID               string               `json:"frame_id"`
	NoHands               bool                 `json:"no_hands"`
	BoundingBoxes         []models.BoundingBox `json:"bounding_boxes"`
	CorrectedBoundingBoxes []models.BoundingBox `json:"corrected_bounding_boxes"`
	CorrectedNoHands      bool                 `json:"corrected_no_hands"`
	Notes                 string               `json:"notes"`
	AnnotatorID           string               `json:"annotator_id"`
	AnnotatorEmail        string               `json:"annotator_email"`
	CreatedAt             int64                `json:"created_at"`
	ReviewStatus          string               `json:"review_status"`
	ReviewedBy            string               `json:"reviewed_by"`
	ReviewedByEmail       string               `json:"reviewed_by_email"`
	ReviewedAt            int64                `json:"reviewed_at"`
	ReviewNotes           string               `json:"review_notes"`
}

func (s *Service) GetAnnotationByFrame(frameID string) (*AnnotationWithMeta, error) {
	var result AnnotationWithMeta
	var boxesJSON []byte
	var correctedBoxesJSON []byte
	var createdAt int64
	var reviewedBy sql.NullString
	var reviewedByEmail sql.NullString
	var reviewedAt sql.NullInt64
	var reviewNotes sql.NullString
	err := s.db.QueryRow(`
		SELECT an.id, an.frame_id, an.no_hands, an.bounding_boxes, an.corrected_bounding_boxes, an.corrected_no_hands, an.notes,
		       an.annotator_id, u.email, an.created_at,
		       an.review_status, an.reviewed_by, ru.email, an.reviewed_at, an.review_notes
		FROM annotations an
		JOIN users u ON u.id = an.annotator_id
		LEFT JOIN users ru ON ru.id = an.reviewed_by
		WHERE an.frame_id = $1
		LIMIT 1`, frameID).Scan(
		&result.ID, &result.FrameID, &result.NoHands, &boxesJSON, &correctedBoxesJSON, &result.CorrectedNoHands, &result.Notes,
		&result.AnnotatorID, &result.AnnotatorEmail, &createdAt,
		&result.ReviewStatus, &reviewedBy, &reviewedByEmail, &reviewedAt, &reviewNotes)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	result.CreatedAt = createdAt
	if reviewedBy.Valid {
		result.ReviewedBy = reviewedBy.String
	}
	if reviewedByEmail.Valid {
		result.ReviewedByEmail = reviewedByEmail.String
	}
	if reviewedAt.Valid {
		result.ReviewedAt = reviewedAt.Int64
	}
	if reviewNotes.Valid {
		result.ReviewNotes = reviewNotes.String
	}
	if len(boxesJSON) > 0 {
		json.Unmarshal(boxesJSON, &result.BoundingBoxes)
	}
	if result.BoundingBoxes == nil {
		result.BoundingBoxes = []models.BoundingBox{}
	}
	if len(correctedBoxesJSON) > 0 {
		json.Unmarshal(correctedBoxesJSON, &result.CorrectedBoundingBoxes)
	}
	if result.CorrectedBoundingBoxes == nil {
		result.CorrectedBoundingBoxes = []models.BoundingBox{}
	}
	return &result, nil
}

type ReviewItem struct {
	AnnotationID          string               `json:"annotation_id"`
	FrameID               string               `json:"frame_id"`
	FrameIndex            int                  `json:"frame_index"`
	Label                 string               `json:"label"`
	Filename              string               `json:"filename"`
	VideoStem             string               `json:"video_stem"`
	VideoID               string               `json:"video_id"`
	NoHands               bool                 `json:"no_hands"`
	BoundingBoxes         []models.BoundingBox `json:"bounding_boxes"`
	CorrectedBoundingBoxes []models.BoundingBox `json:"corrected_bounding_boxes"`
	CorrectedNoHands      bool                 `json:"corrected_no_hands"`
	AnnotatorID           string               `json:"annotator_id"`
	AnnotatorEmail        string               `json:"annotator_email"`
	CreatedAt             int64                `json:"created_at"`
	ReviewStatus          string               `json:"review_status"`
	ReviewedByEmail       string               `json:"reviewed_by_email"`
}

type PaginatedReviews struct {
	Items      []ReviewItem `json:"items"`
	Total      int          `json:"total"`
	Page       int          `json:"page"`
	PerPage    int          `json:"per_page"`
	TotalPages int          `json:"total_pages"`
}

type AnnotatorReviewStats struct {
	AnnotatorID    string `json:"annotator_id"`
	AnnotatorEmail string `json:"annotator_email"`
	TotalCompleted int    `json:"total_completed"`
	PendingReview  int    `json:"pending_review"`
}

func (s *Service) ListAnnotators() ([]AnnotatorReviewStats, error) {
	rows, err := s.db.Query(`
		SELECT an.annotator_id, u.email, COUNT(*) AS total,
		       COALESCE(SUM(CASE WHEN an.review_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending
		FROM annotations an
		JOIN users u ON u.id = an.annotator_id
		GROUP BY an.annotator_id, u.email
		ORDER BY u.email ASC`)
	if err != nil {
		return nil, fmt.Errorf("list annotators: %w", err)
	}
	defer rows.Close()

	var result []AnnotatorReviewStats
	for rows.Next() {
		var st AnnotatorReviewStats
		if err := rows.Scan(&st.AnnotatorID, &st.AnnotatorEmail, &st.TotalCompleted, &st.PendingReview); err != nil {
			return nil, fmt.Errorf("scan annotator: %w", err)
		}
		result = append(result, st)
	}
	if result == nil {
		result = []AnnotatorReviewStats{}
	}
	return result, rows.Err()
}

func (s *Service) ListReviews(page, perPage int, status, videoID, annotatorID string) (*PaginatedReviews, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}

	where := "WHERE a.status = 'completed'"
	args := []any{}
	i := 1

	if status != "" {
		where += fmt.Sprintf(" AND an.review_status = $%d", i)
		args = append(args, status)
		i++
	}
	if videoID != "" {
		where += fmt.Sprintf(" AND f.video_id = $%d", i)
		args = append(args, videoID)
		i++
	}
	if annotatorID != "" {
		where += fmt.Sprintf(" AND an.annotator_id = $%d", i)
		args = append(args, annotatorID)
		i++
	}

	var total int
	countQuery := fmt.Sprintf(`
		SELECT COUNT(*)
		FROM annotations an
		JOIN assignments a ON a.id = an.assignment_id
		JOIN frames f ON f.id = an.frame_id
		JOIN videos v ON v.id = f.video_id
		%s`, where)
	if err := s.db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count reviews: %w", err)
	}

	offset := (page - 1) * perPage
	query := fmt.Sprintf(`
		SELECT an.id, an.frame_id, f.frame_index, f.label, f.filename, v.stem, v.id,
		       an.no_hands, an.bounding_boxes, an.corrected_bounding_boxes, an.corrected_no_hands,
		       an.annotator_id, u.email, an.created_at, an.review_status, ru.email
		FROM annotations an
		JOIN assignments a ON a.id = an.assignment_id
		JOIN frames f ON f.id = an.frame_id
		JOIN videos v ON v.id = f.video_id
		JOIN users u ON u.id = an.annotator_id
		LEFT JOIN users ru ON ru.id = an.reviewed_by
		%s
		ORDER BY f.frame_index ASC
		LIMIT $%d OFFSET $%d`, where, i, i+1)
	args = append(args, perPage, offset)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list reviews: %w", err)
	}
	defer rows.Close()

	var items []ReviewItem
	for rows.Next() {
		var item ReviewItem
		var boxesJSON []byte
		var correctedBoxesJSON []byte
		var reviewedByEmail sql.NullString
		if err := rows.Scan(&item.AnnotationID, &item.FrameID, &item.FrameIndex,
			&item.Label, &item.Filename, &item.VideoStem, &item.VideoID,
			&item.NoHands, &boxesJSON, &correctedBoxesJSON, &item.CorrectedNoHands,
			&item.AnnotatorID, &item.AnnotatorEmail,
			&item.CreatedAt, &item.ReviewStatus, &reviewedByEmail); err != nil {
			return nil, fmt.Errorf("scan review: %w", err)
		}
		if reviewedByEmail.Valid {
			item.ReviewedByEmail = reviewedByEmail.String
		}
		if len(boxesJSON) > 0 {
			json.Unmarshal(boxesJSON, &item.BoundingBoxes)
		}
		if item.BoundingBoxes == nil {
			item.BoundingBoxes = []models.BoundingBox{}
		}
		if len(correctedBoxesJSON) > 0 {
			json.Unmarshal(correctedBoxesJSON, &item.CorrectedBoundingBoxes)
		}
		if item.CorrectedBoundingBoxes == nil {
			item.CorrectedBoundingBoxes = []models.BoundingBox{}
		}
		items = append(items, item)
	}
	if items == nil {
		items = []ReviewItem{}
	}

	totalPages := (total + perPage - 1) / perPage
	if totalPages < 1 {
		totalPages = 1
	}

	return &PaginatedReviews{
		Items:      items,
		Total:      total,
		Page:       page,
		PerPage:    perPage,
		TotalPages: totalPages,
	}, rows.Err()
}

func (s *Service) AdminUpdateAnnotation(annotationID, adminID string, input models.AnnotationInput, reviewNotes string) error {
	now := time.Now().Unix()

	boxesJSON, err := json.Marshal(input.BoundingBoxes)
	if err != nil {
		return fmt.Errorf("marshal boxes: %w", err)
	}

	result, err := s.db.Exec(`
		UPDATE annotations SET
			corrected_bounding_boxes = $1, corrected_no_hands = $2,
			review_status = 'corrected', reviewed_by = $3, reviewed_at = $4, review_notes = $5,
			updated_at = $4
		WHERE id = $6`, boxesJSON, input.NoHands,
		adminID, now, reviewNotes, annotationID)
	if err != nil {
		return fmt.Errorf("update annotation: %w", err)
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return fmt.Errorf("annotation not found")
	}

	return nil
}

func (s *Service) AdminApproveAnnotation(annotationID, adminID, reviewNotes string) error {
	now := time.Now().Unix()
	result, err := s.db.Exec(`
		UPDATE annotations SET review_status = 'approved', reviewed_by = $1, reviewed_at = $2, review_notes = $3, updated_at = $2
		WHERE id = $4`, adminID, now, reviewNotes, annotationID)
	if err != nil {
		return fmt.Errorf("approve annotation: %w", err)
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return fmt.Errorf("annotation not found")
	}
	return nil
}

func (s *Service) AdminRejectAnnotation(annotationID, adminID, reviewNotes string) error {
	now := time.Now().Unix()
	result, err := s.db.Exec(`
		UPDATE annotations SET review_status = 'rejected', reviewed_by = $1, reviewed_at = $2, review_notes = $3, updated_at = $2
		WHERE id = $4`, adminID, now, reviewNotes, annotationID)
	if err != nil {
		return fmt.Errorf("reject annotation: %w", err)
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return fmt.Errorf("annotation not found")
	}
	return nil
}
