package model

import "errors"

// TaskType is the kind of work a task represents.
type TaskType string

const (
	TaskTypeFeature TaskType = "feature"
	TaskTypeBug     TaskType = "bug"
)

func (t TaskType) Valid() bool {
	switch t {
	case TaskTypeFeature, TaskTypeBug:
		return true
	}
	return false
}

// TaskState is the current position in the workflow.
type TaskState string

const (
	// StatePending is a parking lot — created but explicitly not yet
	// runnable. ListRunnableTasks skips it.
	StatePending TaskState = "pending"
	StateStart   TaskState = "start"
	StateSpec    TaskState = "spec"
	StateDev     TaskState = "dev"
	StateTest    TaskState = "test"
	StateReview  TaskState = "review"
	StateDone    TaskState = "done"
)

// stateOrder reflects the canonical workflow position. Transitions are
// validated for state membership only — movement in either direction is
// allowed, since work sometimes legitimately needs to drop back (e.g. a
// review surfaces a bug that must return to dev). 'pending' lives off to
// the side of the main pipeline; any state may drop into it.
var stateOrder = map[TaskState]int{
	StatePending: -1,
	StateStart:   0,
	StateSpec:    1,
	StateDev:     2,
	StateTest:    3,
	StateReview:  4,
	StateDone:    5,
}

func (s TaskState) Valid() bool {
	_, ok := stateOrder[s]
	return ok
}

// CanTransitionTo returns nil if moving from s to next is allowed.
// Backward moves are permitted; only invalid state names are rejected.
func (s TaskState) CanTransitionTo(next TaskState) error {
	if !s.Valid() {
		return errors.New("invalid current state")
	}
	if !next.Valid() {
		return errors.New("invalid next state")
	}
	return nil
}

// IsTerminal reports whether the task is in its final state.
func (s TaskState) IsTerminal() bool { return s == StateDone }

// Project is a workspace that owns tasks.
type Project struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   int64  `json:"created_at"`
	UpdatedAt   int64  `json:"updated_at"`
}

// Task is the unit of work tracked under a project.
type Task struct {
	ID          string    `json:"id"`
	ProjectID   string    `json:"project_id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Type        TaskType  `json:"type"`
	State       TaskState `json:"state"`
	Priority    int       `json:"priority"`
	DependsOn   []string  `json:"depends_on,omitempty"`
	Images      []Image   `json:"images,omitempty"`
	Links       []Link    `json:"links,omitempty"`
	CreatedAt   int64     `json:"created_at"`
	UpdatedAt   int64     `json:"updated_at"`
}

// Link is a URL attached to a task — typically a spec doc, PR, technical
// note, or other artifact the agent wants to keep alongside the task.
type Link struct {
	ID        string `json:"id"`
	TaskID    string `json:"task_id"`
	URL       string `json:"url"`
	Label     string `json:"label"`
	CreatedAt int64  `json:"created_at"`
}

// Image is a binary attachment uploaded against a task.
type Image struct {
	ID          string `json:"id"`
	TaskID      string `json:"task_id"`
	Filename    string `json:"filename"`
	MimeType    string `json:"mime_type"`
	SizeBytes   int64  `json:"size_bytes"`
	URL         string `json:"url,omitempty"`
	StoragePath string `json:"-"`
	UploadedAt  int64  `json:"uploaded_at"`
}
