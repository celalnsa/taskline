package store

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"

	"taskline_server/api/model"
)

//go:embed schema/0001_init.sql
var schemaInit string

//go:embed schema/0002_drop_test_state.sql
var schemaDropTestState string

//go:embed schema/0003_pending_state.sql
var schemaPendingState string

// schemaMigrations defines the canonical migration set, keyed by
// monotonically increasing version. We track the last-applied version in
// SQLite's built-in `PRAGMA user_version` and only run migrations whose
// version is strictly greater than it. That makes each migration run
// exactly once per database, without relying on per-statement
// idempotency tricks like CREATE TABLE IF NOT EXISTS.
type migration struct {
	version int
	sql     string
}

var schemaMigrations = []migration{
	{version: 1, sql: schemaInit},
	{version: 2, sql: schemaDropTestState},
	{version: 3, sql: schemaPendingState},
}

// ErrNotFound is returned when a lookup misses.
var ErrNotFound = errors.New("not found")

// ErrConflict is returned for unique constraint violations and similar.
var ErrConflict = errors.New("conflict")

// Store is the SQLite-backed persistence layer.
type Store struct {
	db *sql.DB
}

// New opens (or creates) a SQLite database at path and applies migrations.
// Pass ":memory:" for an ephemeral test database.
func New(path string) (*Store, error) {
	dsn := path
	if path != ":memory:" {
		dsn = fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)", filepath.Clean(path))
	} else {
		dsn = "file::memory:?cache=shared&_pragma=foreign_keys(1)"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// modernc.org/sqlite doesn't share connection state across handles when
	// `cache=shared` isn't honored; bound the pool so foreign-keys + WAL stay
	// configured. One conn is fine for our load.
	db.SetMaxOpenConns(1)
	if err := applyMigrations(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

// applyMigrations advances the database from its current PRAGMA
// user_version up through the latest entry in schemaMigrations, running
// each step exactly once. Versions in schemaMigrations must be strictly
// increasing; this is verified at runtime so an out-of-order entry is
// caught at startup rather than silently skipped.
//
// Each migration runs inside its own transaction together with the
// matching `PRAGMA user_version` bump, so a failure mid-step rolls back
// cleanly instead of leaving the schema half-applied with a stale
// version stamp.
func applyMigrations(db *sql.DB) error {
	ctx := context.Background()
	var current int
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&current); err != nil {
		return fmt.Errorf("read user_version: %w", err)
	}
	lastVersion := -1
	for _, m := range schemaMigrations {
		if m.version <= lastVersion {
			return fmt.Errorf("schemaMigrations must be strictly increasing: v%d follows v%d", m.version, lastVersion)
		}
		lastVersion = m.version
		if m.version <= current {
			continue
		}
		if err := applyOneMigration(ctx, db, m); err != nil {
			return err
		}
		current = m.version
	}
	return nil
}

func applyOneMigration(ctx context.Context, db *sql.DB, m migration) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx for v%d: %w", m.version, err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, m.sql); err != nil {
		return fmt.Errorf("apply migration v%d: %w", m.version, err)
	}
	// PRAGMA user_version doesn't accept parameter binding; format the
	// version literal directly. m.version is a hard-coded int so there
	// is no injection risk.
	if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", m.version)); err != nil {
		return fmt.Errorf("stamp user_version=%d: %w", m.version, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration v%d: %w", m.version, err)
	}
	return nil
}

func (s *Store) Close() error { return s.db.Close() }

func now() int64 { return time.Now().UnixMilli() }

func newID() string { return uuid.NewString() }

// ─── Projects ───────────────────────────────────────────────────────────

// CreateProject inserts a new project. name must be unique.
func (s *Store) CreateProject(ctx context.Context, name, description string) (*model.Project, error) {
	p := &model.Project{
		ID:          newID(),
		Name:        name,
		Description: description,
		CreatedAt:   now(),
		UpdatedAt:   now(),
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO projects(id,name,description,created_at,updated_at) VALUES(?,?,?,?,?)`,
		p.ID, p.Name, p.Description, p.CreatedAt, p.UpdatedAt,
	)
	if err != nil {
		if isUniqueErr(err) {
			return nil, fmt.Errorf("%w: project name %q already exists", ErrConflict, name)
		}
		return nil, err
	}
	return p, nil
}

// GetProjectByID returns a project by its UUID.
func (s *Store) GetProjectByID(ctx context.Context, id string) (*model.Project, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id,name,description,created_at,updated_at FROM projects WHERE id = ?`, id)
	return scanProject(row)
}

// GetProjectByName returns a project by its unique name.
func (s *Store) GetProjectByName(ctx context.Context, name string) (*model.Project, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id,name,description,created_at,updated_at FROM projects WHERE name = ?`, name)
	return scanProject(row)
}

// ListProjects returns all projects ordered by created_at ASC.
func (s *Store) ListProjects(ctx context.Context) ([]*model.Project, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id,name,description,created_at,updated_at FROM projects ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.Project
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ─── Tasks ──────────────────────────────────────────────────────────────

// CreateTask inserts a new task with the given initial state.
func (s *Store) CreateTask(ctx context.Context, projectID, title, description string, taskType model.TaskType, priority int, initialState model.TaskState) (*model.Task, error) {
	if !taskType.Valid() {
		return nil, fmt.Errorf("invalid task type %q", taskType)
	}
	if !initialState.Valid() {
		return nil, fmt.Errorf("invalid initial state %q", initialState)
	}
	t := &model.Task{
		ID:          newID(),
		ProjectID:   projectID,
		Title:       title,
		Description: description,
		Type:        taskType,
		State:       initialState,
		Priority:    priority,
		CreatedAt:   now(),
		UpdatedAt:   now(),
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO tasks(id,project_id,title,description,type,state,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
		t.ID, t.ProjectID, t.Title, t.Description, t.Type, t.State, t.Priority, t.CreatedAt, t.UpdatedAt,
	)
	if err != nil {
		if isFKErr(err) {
			return nil, fmt.Errorf("%w: project %s does not exist", ErrNotFound, projectID)
		}
		return nil, err
	}
	return t, nil
}

// GetTask returns a single task with its dependencies and images attached.
func (s *Store) GetTask(ctx context.Context, id string) (*model.Task, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id,project_id,title,description,type,state,priority,created_at,updated_at
		   FROM tasks WHERE id = ?`, id)
	t, err := scanTask(row)
	if err != nil {
		return nil, err
	}
	if err := s.attachDeps(ctx, t); err != nil {
		return nil, err
	}
	if err := s.attachImages(ctx, t); err != nil {
		return nil, err
	}
	return t, nil
}

// TaskFilter narrows ListTasks results.
type TaskFilter struct {
	ProjectID string            // required
	States    []model.TaskState // empty = all states
}

// ListTasks returns tasks for a project, optionally filtered by state.
// Sorted by priority DESC then created_at ASC. Each task has deps + images attached.
func (s *Store) ListTasks(ctx context.Context, f TaskFilter) ([]*model.Task, error) {
	if f.ProjectID == "" {
		return nil, errors.New("ListTasks: ProjectID required")
	}
	q := `SELECT id,project_id,title,description,type,state,priority,created_at,updated_at
	        FROM tasks WHERE project_id = ?`
	args := []any{f.ProjectID}
	if len(f.States) > 0 {
		q += " AND state IN ("
		for i, st := range f.States {
			if i > 0 {
				q += ","
			}
			q += "?"
			args = append(args, st)
		}
		q += ")"
	}
	q += " ORDER BY priority DESC, created_at ASC"

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.Task
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, t := range out {
		if err := s.attachDeps(ctx, t); err != nil {
			return nil, err
		}
		if err := s.attachImages(ctx, t); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// ListRunnableTasks returns tasks whose state is neither `done` nor
// `pending` and whose every declared dependency is in state `done`.
// Sorted priority DESC, created_at ASC.
func (s *Store) ListRunnableTasks(ctx context.Context, projectID string) ([]*model.Task, error) {
	q := `
		SELECT t.id,t.project_id,t.title,t.description,t.type,t.state,t.priority,t.created_at,t.updated_at
		  FROM tasks t
		 WHERE t.project_id = ?
		   AND t.state NOT IN ('done','pending')
		   AND NOT EXISTS (
		         SELECT 1 FROM task_deps d
		           JOIN tasks dt ON dt.id = d.depends_on_task_id
		          WHERE d.task_id = t.id AND dt.state <> 'done'
		   )
		 ORDER BY t.priority DESC, t.created_at ASC`
	rows, err := s.db.QueryContext(ctx, q, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.Task
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, t := range out {
		if err := s.attachDeps(ctx, t); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// TaskUpdate carries optional field updates. Nil pointers mean "unchanged".
type TaskUpdate struct {
	Title       *string
	Description *string
	Type        *model.TaskType
	State       *model.TaskState
	Priority    *int
}

// UpdateTask applies the update. State transitions are validated by the caller
// (service layer) — the store just persists what it's given.
func (s *Store) UpdateTask(ctx context.Context, id string, u TaskUpdate) (*model.Task, error) {
	cur, err := s.GetTask(ctx, id)
	if err != nil {
		return nil, err
	}
	if u.Title != nil {
		cur.Title = *u.Title
	}
	if u.Description != nil {
		cur.Description = *u.Description
	}
	if u.Type != nil {
		if !u.Type.Valid() {
			return nil, fmt.Errorf("invalid task type %q", *u.Type)
		}
		cur.Type = *u.Type
	}
	if u.State != nil {
		if !u.State.Valid() {
			return nil, fmt.Errorf("invalid task state %q", *u.State)
		}
		cur.State = *u.State
	}
	if u.Priority != nil {
		cur.Priority = *u.Priority
	}
	cur.UpdatedAt = now()
	_, err = s.db.ExecContext(ctx,
		`UPDATE tasks SET title=?,description=?,type=?,state=?,priority=?,updated_at=? WHERE id=?`,
		cur.Title, cur.Description, cur.Type, cur.State, cur.Priority, cur.UpdatedAt, cur.ID,
	)
	if err != nil {
		return nil, err
	}
	return cur, nil
}

// DeleteTask removes a task (cascades to deps and images via FK).
func (s *Store) DeleteTask(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM tasks WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// AddDependency records that taskID waits for dependsOnID to reach `done`.
// Returns ErrConflict if it would introduce a cycle in the dep DAG.
func (s *Store) AddDependency(ctx context.Context, taskID, dependsOnID string) error {
	if taskID == dependsOnID {
		return fmt.Errorf("%w: task cannot depend on itself", ErrConflict)
	}
	// Cycle check: would adding (taskID -> dependsOnID) make dependsOnID
	// transitively depend on taskID? Walk from dependsOnID upward.
	cycle, err := s.dependsOn(ctx, dependsOnID, taskID)
	if err != nil {
		return err
	}
	if cycle {
		return fmt.Errorf("%w: dependency would create a cycle", ErrConflict)
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO task_deps(task_id,depends_on_task_id,created_at) VALUES(?,?,?)`,
		taskID, dependsOnID, now(),
	)
	if err != nil {
		if isUniqueErr(err) {
			// Already exists — idempotent success.
			return nil
		}
		if isFKErr(err) {
			return fmt.Errorf("%w: one of the tasks does not exist", ErrNotFound)
		}
		return err
	}
	return nil
}

// dependsOn reports whether `start` (transitively) depends on `target`.
func (s *Store) dependsOn(ctx context.Context, start, target string) (bool, error) {
	visited := map[string]bool{}
	stack := []string{start}
	for len(stack) > 0 {
		cur := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if cur == target {
			return true, nil
		}
		if visited[cur] {
			continue
		}
		visited[cur] = true
		rows, err := s.db.QueryContext(ctx,
			`SELECT depends_on_task_id FROM task_deps WHERE task_id = ?`, cur)
		if err != nil {
			return false, err
		}
		for rows.Next() {
			var d string
			if err := rows.Scan(&d); err != nil {
				rows.Close()
				return false, err
			}
			stack = append(stack, d)
		}
		rows.Close()
	}
	return false, nil
}

// ─── Images ─────────────────────────────────────────────────────────────

// AddImage records a stored image attachment for a task.
func (s *Store) AddImage(ctx context.Context, img *model.Image) error {
	if img.ID == "" {
		img.ID = newID()
	}
	if img.UploadedAt == 0 {
		img.UploadedAt = now()
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO task_images(id,task_id,filename,mime_type,size_bytes,storage_path,uploaded_at)
		      VALUES(?,?,?,?,?,?,?)`,
		img.ID, img.TaskID, img.Filename, img.MimeType, img.SizeBytes, img.StoragePath, img.UploadedAt,
	)
	if err != nil {
		if isFKErr(err) {
			return fmt.Errorf("%w: task %s does not exist", ErrNotFound, img.TaskID)
		}
		return err
	}
	return nil
}

// ─── helpers ────────────────────────────────────────────────────────────

type rowScanner interface {
	Scan(dest ...any) error
}

func scanProject(r rowScanner) (*model.Project, error) {
	var p model.Project
	if err := r.Scan(&p.ID, &p.Name, &p.Description, &p.CreatedAt, &p.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

func scanTask(r rowScanner) (*model.Task, error) {
	var t model.Task
	if err := r.Scan(&t.ID, &t.ProjectID, &t.Title, &t.Description, &t.Type, &t.State, &t.Priority, &t.CreatedAt, &t.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &t, nil
}

func (s *Store) attachDeps(ctx context.Context, t *model.Task) error {
	rows, err := s.db.QueryContext(ctx,
		`SELECT depends_on_task_id FROM task_deps WHERE task_id = ? ORDER BY created_at ASC`, t.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			return err
		}
		t.DependsOn = append(t.DependsOn, d)
	}
	return rows.Err()
}

func (s *Store) attachImages(ctx context.Context, t *model.Task) error {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id,task_id,filename,mime_type,size_bytes,storage_path,uploaded_at
		   FROM task_images WHERE task_id = ? ORDER BY uploaded_at ASC`, t.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var img model.Image
		if err := rows.Scan(&img.ID, &img.TaskID, &img.Filename, &img.MimeType, &img.SizeBytes, &img.StoragePath, &img.UploadedAt); err != nil {
			return err
		}
		t.Images = append(t.Images, img)
	}
	return rows.Err()
}

func isUniqueErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return contains(msg, "UNIQUE constraint failed") || contains(msg, "constraint failed: UNIQUE")
}

func isFKErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return contains(msg, "FOREIGN KEY constraint failed") || contains(msg, "constraint failed: FOREIGN KEY")
}

func contains(s, sub string) bool {
	if len(sub) == 0 {
		return true
	}
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
