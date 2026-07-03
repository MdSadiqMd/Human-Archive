package db

import (
	"database/sql"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func New(dsn string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	return db, db.Ping()
}

func Migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id            TEXT   PRIMARY KEY,
			email         TEXT   UNIQUE NOT NULL,
			password_hash TEXT   NOT NULL,
			role          TEXT   NOT NULL DEFAULT 'annotator',
			status        TEXT   NOT NULL DEFAULT 'pending',
			created_at    BIGINT NOT NULL,
			updated_at    BIGINT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email);
		CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
		CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);

		CREATE TABLE IF NOT EXISTS videos (
			id             TEXT   PRIMARY KEY,
			s3_key         TEXT   NOT NULL,
			stem           TEXT   UNIQUE NOT NULL,
			fps            REAL   NOT NULL,
			duration_s     REAL   NOT NULL,
			total_frames   INT    NOT NULL,
			sampled_frames INT    NOT NULL,
			label_counts   JSONB  NOT NULL DEFAULT '{}',
			status         TEXT   NOT NULL DEFAULT 'ingested',
			ingested_at    BIGINT NOT NULL,
			ingested_by    TEXT   NOT NULL REFERENCES users(id)
		);
		CREATE INDEX IF NOT EXISTS idx_videos_stem   ON videos(stem);
		CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);

		CREATE TABLE IF NOT EXISTS frames (
			id            TEXT   PRIMARY KEY,
			video_id      TEXT   NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
			frame_index   INT    NOT NULL,
			timestamp_s   REAL   NOT NULL,
			label         TEXT   NOT NULL,
			filename      TEXT   NOT NULL,
			num_hands     INT    NOT NULL DEFAULT 0,
			hand_evidence REAL   NOT NULL DEFAULT 0,
			sample_reason TEXT   NOT NULL,
			scores        JSONB  NOT NULL DEFAULT '{}',
			features      JSONB  NOT NULL DEFAULT '{}',
			UNIQUE(video_id, frame_index)
		);
		CREATE INDEX IF NOT EXISTS idx_frames_video ON frames(video_id);
		CREATE INDEX IF NOT EXISTS idx_frames_label ON frames(label);

		CREATE TABLE IF NOT EXISTS assignments (
			id           TEXT   PRIMARY KEY,
			frame_id     TEXT   NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
			assignee_id  TEXT   NOT NULL REFERENCES users(id),
			assigned_by  TEXT   NOT NULL REFERENCES users(id),
			status       TEXT   NOT NULL DEFAULT 'pending',
			assigned_at  BIGINT NOT NULL,
			completed_at BIGINT,
			UNIQUE(frame_id, assignee_id)
		);
		CREATE INDEX IF NOT EXISTS idx_assignments_assignee ON assignments(assignee_id);
		CREATE INDEX IF NOT EXISTS idx_assignments_status   ON assignments(status);
		CREATE INDEX IF NOT EXISTS idx_assignments_frame    ON assignments(frame_id);

		CREATE TABLE IF NOT EXISTS annotations (
			id            TEXT    PRIMARY KEY,
			assignment_id TEXT    UNIQUE NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
			frame_id      TEXT    NOT NULL REFERENCES frames(id),
			annotator_id  TEXT    NOT NULL REFERENCES users(id),
			no_hands      BOOLEAN NOT NULL DEFAULT false,
			left_hand     BOOLEAN NOT NULL DEFAULT false,
			right_hand    BOOLEAN NOT NULL DEFAULT false,
			bounding_boxes JSONB  NOT NULL DEFAULT '[]',
			notes         TEXT    NOT NULL DEFAULT '',
			created_at    BIGINT  NOT NULL,
			updated_at    BIGINT  NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_annotations_frame     ON annotations(frame_id);
		CREATE INDEX IF NOT EXISTS idx_annotations_annotator ON annotations(annotator_id);

		ALTER TABLE annotations ADD COLUMN IF NOT EXISTS bounding_boxes JSONB NOT NULL DEFAULT '[]';
		ALTER TABLE annotations ADD COLUMN IF NOT EXISTS review_status  TEXT NOT NULL DEFAULT 'pending';
		ALTER TABLE annotations ADD COLUMN IF NOT EXISTS reviewed_by    TEXT REFERENCES users(id);
		ALTER TABLE annotations ADD COLUMN IF NOT EXISTS reviewed_at    BIGINT;
		ALTER TABLE annotations ADD COLUMN IF NOT EXISTS review_notes   TEXT NOT NULL DEFAULT '';
		ALTER TABLE annotations ADD COLUMN IF NOT EXISTS corrected_bounding_boxes JSONB NOT NULL DEFAULT '[]';
		ALTER TABLE annotations ADD COLUMN IF NOT EXISTS corrected_no_hands BOOLEAN NOT NULL DEFAULT false;
	`)
	return err
}
