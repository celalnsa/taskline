package store

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

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

//go:embed schema/0004_task_links.sql
var schemaTaskLinks string

//go:embed schema/0005_design_to_spec.sql
var schemaDesignToSpec string

//go:embed schema/0006_add_test_state.sql
var schemaAddTestState string

//go:embed schema/0007_task_docs.sql
var schemaTaskDocs string

//go:embed schema/0008_task_labels.sql
var schemaTaskLabels string

//go:embed schema/0009_docs_task_type.sql
var schemaDocsTaskType string

//go:embed schema/0010_task_claims.sql
var schemaTaskClaims string

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
	{version: 4, sql: schemaTaskLinks},
	{version: 5, sql: schemaDesignToSpec},
	{version: 6, sql: schemaAddTestState},
	{version: 7, sql: schemaTaskDocs},
	{version: 8, sql: schemaTaskLabels},
	{version: 9, sql: schemaDocsTaskType},
	{version: 10, sql: schemaTaskClaims},
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
	var dsn string
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

const (
	maxTaskLabels      = 20
	maxTaskLabelRunes  = 64
	emptyTaskLabelsRaw = "[]"
)

const (
	taskSelectColumns  = `id,project_id,title,description,type,state,priority,labels,owner,claimed_at,lease_expires_at,created_at,updated_at`
	taskSelectColumnsT = `t.id,t.project_id,t.title,t.description,t.type,t.state,t.priority,t.labels,t.owner,t.claimed_at,t.lease_expires_at,t.created_at,t.updated_at`
)

func optionalLabels(labels [][]string) []string {
	if len(labels) == 0 {
		return nil
	}
	return labels[0]
}

func normalizeLabels(labels []string) ([]string, error) {
	if len(labels) > maxTaskLabels {
		return nil, fmt.Errorf("too many labels: max %d", maxTaskLabels)
	}
	out := make([]string, 0, len(labels))
	seen := map[string]struct{}{}
	for _, label := range labels {
		label = strings.TrimSpace(label)
		if label == "" {
			return nil, errors.New("label cannot be blank")
		}
		if strings.ContainsAny(label, ",\t\n\r") {
			return nil, fmt.Errorf("label %q cannot contain commas, tabs, or newlines", label)
		}
		if utf8.RuneCountInString(label) > maxTaskLabelRunes {
			return nil, fmt.Errorf("label %q is too long: max %d characters", label, maxTaskLabelRunes)
		}
		key := strings.ToLower(label)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, label)
	}
	return out, nil
}

func encodeLabels(labels []string) (string, error) {
	if labels == nil {
		return emptyTaskLabelsRaw, nil
	}
	raw, err := json.Marshal(labels)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func decodeLabels(raw string) ([]string, error) {
	if raw == "" {
		raw = emptyTaskLabelsRaw
	}
	var labels []string
	if err := json.Unmarshal([]byte(raw), &labels); err != nil {
		return nil, fmt.Errorf("decode task labels: %w", err)
	}
	return labels, nil
}

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
func (s *Store) CreateTask(ctx context.Context, projectID, title, description string, taskType model.TaskType, priority int, initialState model.TaskState, labels ...[]string) (*model.Task, error) {
	if !taskType.Valid() {
		return nil, fmt.Errorf("invalid task type %q", taskType)
	}
	if !initialState.Valid() {
		return nil, fmt.Errorf("invalid initial state %q", initialState)
	}
	normalizedLabels, err := normalizeLabels(optionalLabels(labels))
	if err != nil {
		return nil, err
	}
	labelsJSON, err := encodeLabels(normalizedLabels)
	if err != nil {
		return nil, err
	}
	t := &model.Task{
		ID:          newID(),
		ProjectID:   projectID,
		Title:       title,
		Description: description,
		Type:        taskType,
		State:       initialState,
		Priority:    priority,
		Labels:      normalizedLabels,
		CreatedAt:   now(),
		UpdatedAt:   now(),
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO tasks(id,project_id,title,description,type,state,priority,labels,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
		t.ID, t.ProjectID, t.Title, t.Description, t.Type, t.State, t.Priority, labelsJSON, t.CreatedAt, t.UpdatedAt,
	)
	if err != nil {
		if isFKErr(err) {
			return nil, fmt.Errorf("%w: project %s does not exist", ErrNotFound, projectID)
		}
		return nil, err
	}
	return t, nil
}

// GetTask returns a single task with its dependencies and attachments.
func (s *Store) GetTask(ctx context.Context, id string) (*model.Task, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+taskSelectColumns+`
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
	if err := s.attachDocs(ctx, t); err != nil {
		return nil, err
	}
	if err := s.attachLinks(ctx, t); err != nil {
		return nil, err
	}
	return t, nil
}

// TaskFilter narrows ListTasks results.
type TaskFilter struct {
	ProjectID string            // required
	States    []model.TaskState // empty = all states
	Owner     *string           // nil = any owner
	Unclaimed bool              // true = owner is empty
}

// ListTasks returns tasks for a project, optionally filtered by state.
// Sorted by priority DESC then created_at ASC. Each task has deps and attachments.
func (s *Store) ListTasks(ctx context.Context, f TaskFilter) ([]*model.Task, error) {
	if f.ProjectID == "" {
		return nil, errors.New("ListTasks: ProjectID required")
	}
	if f.Owner != nil && f.Unclaimed {
		return nil, errors.New("ListTasks: Owner and Unclaimed are mutually exclusive")
	}
	q := `SELECT ` + taskSelectColumns + `
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
	if f.Owner != nil {
		q += " AND owner = ?"
		args = append(args, *f.Owner)
	}
	if f.Unclaimed {
		q += " AND owner = ''"
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
	if err := s.attachTaskDetails(ctx, out); err != nil {
		return nil, err
	}
	return out, nil
}

// ListRunnableTasks returns tasks whose state is neither `done` nor
// `pending` and whose every declared dependency is in state `done`.
// Sorted priority DESC, created_at ASC.
func (s *Store) ListRunnableTasks(ctx context.Context, projectID string) ([]*model.Task, error) {
	q := `
		SELECT ` + taskSelectColumnsT + `
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
	if err := s.attachTaskDetails(ctx, out); err != nil {
		return nil, err
	}
	return out, nil
}

// ClaimOptions controls explicit and next-task claim operations.
type ClaimOptions struct {
	Owner          string
	Now            int64
	LeaseExpiresAt int64
}

// HeartbeatOptions controls no-op lease renewal.
type HeartbeatOptions struct {
	Owner          string
	Now            int64
	LeaseExpiresAt int64
}

// ReleaseOptions controls claim release.
type ReleaseOptions struct {
	Owner string
	Force bool
	Now   int64
}

// ClaimNextTask atomically claims the highest-priority runnable task available
// to opts.Owner. Existing read-only NextRunnableTask behavior is intentionally
// separate.
func (s *Store) ClaimNextTask(ctx context.Context, projectID string, opts ClaimOptions) (*model.Task, error) {
	if projectID == "" {
		return nil, errors.New("ClaimNextTask: ProjectID required")
	}
	opts = normalizeClaimOptions(opts)
	for attempts := 0; attempts < 3; attempts++ {
		id, err := s.claimNextTaskID(ctx, projectID, opts)
		if err != nil {
			if errors.Is(err, ErrConflict) {
				continue
			}
			return nil, err
		}
		if id == "" {
			return nil, nil
		}
		task, err := s.GetTask(ctx, id)
		if err != nil {
			return nil, err
		}
		return task, nil
	}
	return nil, fmt.Errorf("%w: could not claim runnable task", ErrConflict)
}

func (s *Store) claimNextTaskID(ctx context.Context, projectID string, opts ClaimOptions) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	var id string
	err = tx.QueryRowContext(ctx, `
		SELECT t.id
		  FROM tasks t
		 WHERE t.project_id = ?
		   AND t.state NOT IN ('done','pending')
		   AND NOT EXISTS (
		         SELECT 1 FROM task_deps d
		           JOIN tasks dt ON dt.id = d.depends_on_task_id
		          WHERE d.task_id = t.id AND dt.state <> 'done'
		   )
		   AND (t.owner = '' OR t.owner = ? OR t.lease_expires_at <= ?)
		 ORDER BY CASE WHEN t.owner = ? THEN 0 ELSE 1 END, t.priority DESC, t.created_at ASC
		 LIMIT 1`,
		projectID, opts.Owner, opts.Now, opts.Owner,
	).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}

	res, err := tx.ExecContext(ctx, `
		UPDATE tasks
		   SET owner = ?, claimed_at = ?, lease_expires_at = ?, updated_at = ?
		 WHERE id = ?
		   AND (owner = '' OR owner = ? OR lease_expires_at <= ?)`,
		opts.Owner, opts.Now, opts.LeaseExpiresAt, opts.Now,
		id, opts.Owner, opts.Now,
	)
	if err != nil {
		return "", err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return "", err
	}
	if n == 0 {
		return "", fmt.Errorf("%w: selected task was claimed concurrently", ErrConflict)
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return id, nil
}

// ClaimTask explicitly claims one runnable task for opts.Owner.
func (s *Store) ClaimTask(ctx context.Context, id string, opts ClaimOptions) (*model.Task, error) {
	opts = normalizeClaimOptions(opts)
	res, err := s.db.ExecContext(ctx, `
		UPDATE tasks
		   SET owner = ?, claimed_at = ?, lease_expires_at = ?, updated_at = ?
		 WHERE id = ?
		   AND state NOT IN ('done','pending')
		   AND NOT EXISTS (
		         SELECT 1 FROM task_deps d
		           JOIN tasks dt ON dt.id = d.depends_on_task_id
		          WHERE d.task_id = tasks.id AND dt.state <> 'done'
		   )
		   AND (owner = '' OR owner = ? OR lease_expires_at <= ?)`,
		opts.Owner, opts.Now, opts.LeaseExpiresAt, opts.Now,
		id, opts.Owner, opts.Now,
	)
	if err != nil {
		return nil, err
	}
	return s.updatedTaskOrClaimConflict(ctx, id, res, "task is not claimable")
}

// HeartbeatTask renews the lease for the current owner without changing task
// content.
func (s *Store) HeartbeatTask(ctx context.Context, id string, opts HeartbeatOptions) (*model.Task, error) {
	opts = normalizeHeartbeatOptions(opts)
	res, err := s.db.ExecContext(ctx,
		`UPDATE tasks SET lease_expires_at=?, updated_at=? WHERE id=? AND owner=?`,
		opts.LeaseExpiresAt, opts.Now, id, opts.Owner,
	)
	if err != nil {
		return nil, err
	}
	return s.updatedTaskOrClaimConflict(ctx, id, res, "task is not claimed by owner")
}

// ReleaseTask clears claim metadata. Without Force, opts.Owner must match.
func (s *Store) ReleaseTask(ctx context.Context, id string, opts ReleaseOptions) (*model.Task, error) {
	opts = normalizeReleaseOptions(opts)
	q := `UPDATE tasks SET owner='', claimed_at=0, lease_expires_at=0, updated_at=? WHERE id=?`
	args := []any{opts.Now, id}
	if !opts.Force {
		q += " AND owner=?"
		args = append(args, opts.Owner)
	}
	res, err := s.db.ExecContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	return s.updatedTaskOrClaimConflict(ctx, id, res, "task is not claimed by owner")
}

func (s *Store) updatedTaskOrClaimConflict(ctx context.Context, id string, res sql.Result, msg string) (*model.Task, error) {
	n, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n == 0 {
		if _, err := s.GetTask(ctx, id); err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("%w: %s", ErrConflict, msg)
	}
	return s.GetTask(ctx, id)
}

func normalizeClaimOptions(opts ClaimOptions) ClaimOptions {
	if opts.Now == 0 {
		opts.Now = now()
	}
	return opts
}

func normalizeHeartbeatOptions(opts HeartbeatOptions) HeartbeatOptions {
	if opts.Now == 0 {
		opts.Now = now()
	}
	return opts
}

func normalizeReleaseOptions(opts ReleaseOptions) ReleaseOptions {
	if opts.Now == 0 {
		opts.Now = now()
	}
	return opts
}

// TaskUpdate carries optional field updates. Nil pointers mean "unchanged".
type TaskUpdate struct {
	Title          *string
	Description    *string
	Type           *model.TaskType
	State          *model.TaskState
	Priority       *int
	Labels         *[]string
	IfState        *model.TaskState
	Owner          string
	Force          bool
	Now            int64
	LeaseExpiresAt int64
}

// UpdateTask applies the update. State transitions are validated by the caller
// (service layer) — the store just persists what it's given.
func (s *Store) UpdateTask(ctx context.Context, id string, u TaskUpdate) (*model.Task, error) {
	cur, err := s.GetTask(ctx, id)
	if err != nil {
		return nil, err
	}
	originalOwner := cur.Owner
	if u.Now == 0 {
		u.Now = now()
	}
	if u.IfState != nil && cur.State != *u.IfState {
		return nil, fmt.Errorf("%w: state conflict: expected %s, current state %s", ErrConflict, *u.IfState, cur.State)
	}
	if !u.Force && cur.Owner != "" {
		if u.Owner == "" {
			return nil, fmt.Errorf("%w: task is claimed by %s; pass owner or force", ErrConflict, cur.Owner)
		}
		if u.Owner != cur.Owner {
			return nil, fmt.Errorf("%w: task is claimed by %s", ErrConflict, cur.Owner)
		}
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
	if u.Labels != nil {
		labels, err := normalizeLabels(*u.Labels)
		if err != nil {
			return nil, err
		}
		cur.Labels = labels
	}
	if u.Owner != "" && cur.Owner == u.Owner && u.LeaseExpiresAt > 0 {
		cur.LeaseExpiresAt = u.LeaseExpiresAt
	}
	renewLease := u.Owner != "" && cur.Owner == u.Owner && u.LeaseExpiresAt > 0
	labelsJSON, err := encodeLabels(cur.Labels)
	if err != nil {
		return nil, err
	}
	cur.UpdatedAt = u.Now
	q := `UPDATE tasks SET title=?,description=?,type=?,state=?,priority=?,labels=?,updated_at=?`
	args := []any{cur.Title, cur.Description, cur.Type, cur.State, cur.Priority, labelsJSON, cur.UpdatedAt}
	if renewLease {
		q += `,lease_expires_at=?`
		args = append(args, cur.LeaseExpiresAt)
	}
	q += ` WHERE id=?`
	args = append(args, cur.ID)
	if u.IfState != nil {
		q += ` AND state=?`
		args = append(args, *u.IfState)
	}
	if !u.Force {
		q += ` AND owner=?`
		args = append(args, originalOwner)
	}
	res, err := s.db.ExecContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, s.updateTaskConflict(ctx, id, u, originalOwner)
	}
	return s.GetTask(ctx, id)
}

func (s *Store) updateTaskConflict(ctx context.Context, id string, u TaskUpdate, originalOwner string) error {
	latest, err := s.GetTask(ctx, id)
	if err != nil {
		return err
	}
	if u.IfState != nil && latest.State != *u.IfState {
		return fmt.Errorf("%w: state conflict: expected %s, current state %s", ErrConflict, *u.IfState, latest.State)
	}
	if !u.Force && latest.Owner != originalOwner {
		if latest.Owner != "" {
			return fmt.Errorf("%w: task is claimed by %s", ErrConflict, latest.Owner)
		}
		return fmt.Errorf("%w: task claim changed concurrently", ErrConflict)
	}
	return fmt.Errorf("%w: task changed concurrently", ErrConflict)
}

// DeleteTask removes a task (cascades to deps and attachment rows via FK).
func (s *Store) DeleteTask(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM tasks WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
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

// DeleteDependency removes a dependency edge.
func (s *Store) DeleteDependency(ctx context.Context, taskID, dependsOnID string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM task_deps WHERE task_id = ? AND depends_on_task_id = ?`,
		taskID, dependsOnID,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
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
				_ = rows.Close()
				return false, err
			}
			stack = append(stack, d)
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return false, err
		}
		if err := rows.Close(); err != nil {
			return false, err
		}
	}
	return false, nil
}

// ─── Links ──────────────────────────────────────────────────────────────

// AddLink attaches a URL to a task. id and created_at are generated if zero.
// Returns ErrNotFound if the task does not exist.
func (s *Store) AddLink(ctx context.Context, link *model.Link) error {
	if link.ID == "" {
		link.ID = newID()
	}
	if link.CreatedAt == 0 {
		link.CreatedAt = now()
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO task_links(id,task_id,url,label,created_at) VALUES(?,?,?,?,?)`,
		link.ID, link.TaskID, link.URL, link.Label, link.CreatedAt,
	)
	if err != nil {
		if isFKErr(err) {
			return fmt.Errorf("%w: task %s does not exist", ErrNotFound, link.TaskID)
		}
		return err
	}
	return nil
}

// GetLink returns a link by id.
func (s *Store) GetLink(ctx context.Context, id string) (*model.Link, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id,task_id,url,label,created_at FROM task_links WHERE id = ?`, id)
	var l model.Link
	if err := row.Scan(&l.ID, &l.TaskID, &l.URL, &l.Label, &l.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &l, nil
}

// DeleteLink removes a single link by id. Returns ErrNotFound if absent.
func (s *Store) DeleteLink(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM task_links WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ─── Docs ───────────────────────────────────────────────────────────────

// DocUpdate carries optional document metadata updates. File content lives on
// disk and is written by the handler; the store only bumps the metadata clock.
type DocUpdate struct {
	Title *string
}

// AddDoc records a stored markdown document for a task.
func (s *Store) AddDoc(ctx context.Context, doc *model.Doc) error {
	if doc.ID == "" {
		doc.ID = newID()
	}
	if doc.CreatedAt == 0 {
		doc.CreatedAt = now()
	}
	if doc.UpdatedAt == 0 {
		doc.UpdatedAt = doc.CreatedAt
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO task_docs(id,task_id,title,storage_path,created_at,updated_at)
		      VALUES(?,?,?,?,?,?)`,
		doc.ID, doc.TaskID, doc.Title, doc.StoragePath, doc.CreatedAt, doc.UpdatedAt,
	)
	if err != nil {
		if isFKErr(err) {
			return fmt.Errorf("%w: task %s does not exist", ErrNotFound, doc.TaskID)
		}
		return err
	}
	return nil
}

// GetDoc returns a stored document by id.
func (s *Store) GetDoc(ctx context.Context, id string) (*model.Doc, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id,task_id,title,storage_path,created_at,updated_at
		   FROM task_docs WHERE id = ?`, id)
	return scanDoc(row)
}

// UpdateDoc updates document metadata and bumps updated_at.
func (s *Store) UpdateDoc(ctx context.Context, id string, u DocUpdate) (*model.Doc, error) {
	cur, err := s.GetDoc(ctx, id)
	if err != nil {
		return nil, err
	}
	if u.Title != nil {
		cur.Title = *u.Title
	}
	cur.UpdatedAt = now()
	_, err = s.db.ExecContext(ctx,
		`UPDATE task_docs SET title=?, updated_at=? WHERE id=?`,
		cur.Title, cur.UpdatedAt, cur.ID,
	)
	if err != nil {
		return nil, err
	}
	return cur, nil
}

// DeleteDoc removes a single document row and returns the removed metadata.
func (s *Store) DeleteDoc(ctx context.Context, id string) (*model.Doc, error) {
	doc, err := s.GetDoc(ctx, id)
	if err != nil {
		return nil, err
	}
	res, err := s.db.ExecContext(ctx, `DELETE FROM task_docs WHERE id = ?`, id)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, ErrNotFound
	}
	return doc, nil
}

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

// GetImage returns a stored image attachment by id.
func (s *Store) GetImage(ctx context.Context, id string) (*model.Image, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id,task_id,filename,mime_type,size_bytes,storage_path,uploaded_at
		   FROM task_images WHERE id = ?`, id)
	return scanImage(row)
}

// DeleteImage removes a single image by id and returns the removed row.
func (s *Store) DeleteImage(ctx context.Context, id string) (*model.Image, error) {
	img, err := s.GetImage(ctx, id)
	if err != nil {
		return nil, err
	}
	res, err := s.db.ExecContext(ctx, `DELETE FROM task_images WHERE id = ?`, id)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, ErrNotFound
	}
	return img, nil
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
	var labelsRaw string
	if err := r.Scan(
		&t.ID,
		&t.ProjectID,
		&t.Title,
		&t.Description,
		&t.Type,
		&t.State,
		&t.Priority,
		&labelsRaw,
		&t.Owner,
		&t.ClaimedAt,
		&t.LeaseExpiresAt,
		&t.CreatedAt,
		&t.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	labels, err := decodeLabels(labelsRaw)
	if err != nil {
		return nil, err
	}
	t.Labels = labels
	return &t, nil
}

func scanImage(r rowScanner) (*model.Image, error) {
	var img model.Image
	if err := r.Scan(&img.ID, &img.TaskID, &img.Filename, &img.MimeType, &img.SizeBytes, &img.StoragePath, &img.UploadedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &img, nil
}

func scanDoc(r rowScanner) (*model.Doc, error) {
	var doc model.Doc
	if err := r.Scan(&doc.ID, &doc.TaskID, &doc.Title, &doc.StoragePath, &doc.CreatedAt, &doc.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &doc, nil
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

func (s *Store) attachLinks(ctx context.Context, t *model.Task) error {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id,task_id,url,label,created_at
		   FROM task_links WHERE task_id = ? ORDER BY created_at ASC`, t.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var l model.Link
		if err := rows.Scan(&l.ID, &l.TaskID, &l.URL, &l.Label, &l.CreatedAt); err != nil {
			return err
		}
		t.Links = append(t.Links, l)
	}
	return rows.Err()
}

func (s *Store) attachDocs(ctx context.Context, t *model.Task) error {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id,task_id,title,storage_path,created_at,updated_at
		   FROM task_docs WHERE task_id = ? ORDER BY created_at ASC`, t.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		doc, err := scanDoc(rows)
		if err != nil {
			return err
		}
		t.Docs = append(t.Docs, *doc)
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
		img, err := scanImage(rows)
		if err != nil {
			return err
		}
		t.Images = append(t.Images, *img)
	}
	return rows.Err()
}

const taskDetailsBatchSize = 500

func (s *Store) attachTaskDetails(ctx context.Context, tasks []*model.Task) error {
	if len(tasks) == 0 {
		return nil
	}
	if err := s.attachDepsForTasks(ctx, tasks); err != nil {
		return err
	}
	if err := s.attachImagesForTasks(ctx, tasks); err != nil {
		return err
	}
	if err := s.attachDocsForTasks(ctx, tasks); err != nil {
		return err
	}
	return s.attachLinksForTasks(ctx, tasks)
}

func (s *Store) attachDepsForTasks(ctx context.Context, tasks []*model.Task) error {
	return forTaskDetailsBatch(tasks, func(placeholders string, args []any, byID map[string]*model.Task) error {
		rows, err := s.db.QueryContext(ctx,
			fmt.Sprintf(`SELECT task_id,depends_on_task_id
			   FROM task_deps
			  WHERE task_id IN (%s)
			  ORDER BY task_id ASC, created_at ASC`, placeholders),
			args...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var taskID, dependsOn string
			if err := rows.Scan(&taskID, &dependsOn); err != nil {
				return err
			}
			if t := byID[taskID]; t != nil {
				t.DependsOn = append(t.DependsOn, dependsOn)
			}
		}
		return rows.Err()
	})
}

func (s *Store) attachLinksForTasks(ctx context.Context, tasks []*model.Task) error {
	return forTaskDetailsBatch(tasks, func(placeholders string, args []any, byID map[string]*model.Task) error {
		rows, err := s.db.QueryContext(ctx,
			fmt.Sprintf(`SELECT id,task_id,url,label,created_at
			   FROM task_links
			  WHERE task_id IN (%s)
			  ORDER BY task_id ASC, created_at ASC`, placeholders),
			args...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var l model.Link
			if err := rows.Scan(&l.ID, &l.TaskID, &l.URL, &l.Label, &l.CreatedAt); err != nil {
				return err
			}
			if t := byID[l.TaskID]; t != nil {
				t.Links = append(t.Links, l)
			}
		}
		return rows.Err()
	})
}

func (s *Store) attachDocsForTasks(ctx context.Context, tasks []*model.Task) error {
	return forTaskDetailsBatch(tasks, func(placeholders string, args []any, byID map[string]*model.Task) error {
		rows, err := s.db.QueryContext(ctx,
			fmt.Sprintf(`SELECT id,task_id,title,storage_path,created_at,updated_at
			   FROM task_docs
			  WHERE task_id IN (%s)
			  ORDER BY task_id ASC, created_at ASC`, placeholders),
			args...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			doc, err := scanDoc(rows)
			if err != nil {
				return err
			}
			if t := byID[doc.TaskID]; t != nil {
				t.Docs = append(t.Docs, *doc)
			}
		}
		return rows.Err()
	})
}

func (s *Store) attachImagesForTasks(ctx context.Context, tasks []*model.Task) error {
	return forTaskDetailsBatch(tasks, func(placeholders string, args []any, byID map[string]*model.Task) error {
		rows, err := s.db.QueryContext(ctx,
			fmt.Sprintf(`SELECT id,task_id,filename,mime_type,size_bytes,storage_path,uploaded_at
			   FROM task_images
			  WHERE task_id IN (%s)
			  ORDER BY task_id ASC, uploaded_at ASC`, placeholders),
			args...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			img, err := scanImage(rows)
			if err != nil {
				return err
			}
			if t := byID[img.TaskID]; t != nil {
				t.Images = append(t.Images, *img)
			}
		}
		return rows.Err()
	})
}

func forTaskDetailsBatch(tasks []*model.Task, fn func(placeholders string, args []any, byID map[string]*model.Task) error) error {
	for start := 0; start < len(tasks); start += taskDetailsBatchSize {
		end := start + taskDetailsBatchSize
		if end > len(tasks) {
			end = len(tasks)
		}
		placeholders, args, byID := taskBatchQueryArgs(tasks[start:end])
		if err := fn(placeholders, args, byID); err != nil {
			return err
		}
	}
	return nil
}

func taskBatchQueryArgs(tasks []*model.Task) (string, []any, map[string]*model.Task) {
	args := make([]any, 0, len(tasks))
	byID := make(map[string]*model.Task, len(tasks))
	var placeholders strings.Builder
	for i, task := range tasks {
		if i > 0 {
			placeholders.WriteByte(',')
		}
		placeholders.WriteByte('?')
		args = append(args, task.ID)
		byID[task.ID] = task
	}
	return placeholders.String(), args, byID
}

func isUniqueErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "UNIQUE constraint failed") || strings.Contains(msg, "constraint failed: UNIQUE")
}

func isFKErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "FOREIGN KEY constraint failed") || strings.Contains(msg, "constraint failed: FOREIGN KEY")
}
