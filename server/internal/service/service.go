package service

import (
	"context"
	"errors"
	"fmt"

	"taskline_server/api/model"
	"taskline_server/internal/store"
)

// Service holds business logic on top of the store: name resolution,
// state-machine validation, runnable filtering.
type Service struct {
	st *store.Store
}

func New(st *store.Store) *Service { return &Service{st: st} }

// CreateProject inserts a new project. name is required and unique.
func (s *Service) CreateProject(ctx context.Context, name, description string) (*model.Project, error) {
	if name == "" {
		return nil, errors.New("project name required")
	}
	return s.st.CreateProject(ctx, name, description)
}

// ListProjects returns all projects.
func (s *Service) ListProjects(ctx context.Context) ([]*model.Project, error) {
	return s.st.ListProjects(ctx)
}

// ResolveProject takes either a project UUID or a project name and returns the project.
func (s *Service) ResolveProject(ctx context.Context, idOrName string) (*model.Project, error) {
	if idOrName == "" {
		return nil, errors.New("project id or name required")
	}
	if p, err := s.st.GetProjectByID(ctx, idOrName); err == nil {
		return p, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	return s.st.GetProjectByName(ctx, idOrName)
}

// CreateTask creates a task under the resolved project. autoStart picks
// the initial state: true → 'start' (immediately runnable), false →
// 'pending' (a parking lot the agent loop will skip).
func (s *Service) CreateTask(ctx context.Context, projectIDOrName, title, description string, taskType model.TaskType, priority int, autoStart bool) (*model.Task, error) {
	if title == "" {
		return nil, errors.New("task title required")
	}
	if !taskType.Valid() {
		return nil, fmt.Errorf("invalid task type %q (must be feature or bug)", taskType)
	}
	p, err := s.ResolveProject(ctx, projectIDOrName)
	if err != nil {
		return nil, err
	}
	initial := model.StatePending
	if autoStart {
		initial = model.StateStart
	}
	return s.st.CreateTask(ctx, p.ID, title, description, taskType, priority, initial)
}

// GetTask fetches a task by id.
func (s *Service) GetTask(ctx context.Context, id string) (*model.Task, error) {
	return s.st.GetTask(ctx, id)
}

// ListTasks returns tasks under a project, optionally filtered by state.
func (s *Service) ListTasks(ctx context.Context, projectIDOrName string, states []model.TaskState) ([]*model.Task, error) {
	p, err := s.ResolveProject(ctx, projectIDOrName)
	if err != nil {
		return nil, err
	}
	for _, st := range states {
		if !st.Valid() {
			return nil, fmt.Errorf("invalid state %q", st)
		}
	}
	return s.st.ListTasks(ctx, store.TaskFilter{ProjectID: p.ID, States: states})
}

// NextRunnableTask returns the highest-priority task whose deps are all done.
// Returns (nil, nil) if no task is runnable.
func (s *Service) NextRunnableTask(ctx context.Context, projectIDOrName string) (*model.Task, error) {
	tasks, err := s.ListRunnableTasks(ctx, projectIDOrName)
	if err != nil {
		return nil, err
	}
	if len(tasks) == 0 {
		return nil, nil
	}
	return tasks[0], nil
}

// ListRunnableTasks returns all currently-runnable tasks.
func (s *Service) ListRunnableTasks(ctx context.Context, projectIDOrName string) ([]*model.Task, error) {
	p, err := s.ResolveProject(ctx, projectIDOrName)
	if err != nil {
		return nil, err
	}
	return s.st.ListRunnableTasks(ctx, p.ID)
}

// UpdateTask applies partial updates with state-machine validation.
func (s *Service) UpdateTask(ctx context.Context, id string, u store.TaskUpdate) (*model.Task, error) {
	if u.State != nil {
		cur, err := s.st.GetTask(ctx, id)
		if err != nil {
			return nil, err
		}
		if err := cur.State.CanTransitionTo(*u.State); err != nil {
			return nil, fmt.Errorf("invalid transition %s -> %s: %w", cur.State, *u.State, err)
		}
	}
	return s.st.UpdateTask(ctx, id, u)
}

// DeleteTask removes a task and its dependencies / images via FK cascade.
func (s *Service) DeleteTask(ctx context.Context, id string) error {
	return s.st.DeleteTask(ctx, id)
}

// AddDependency makes taskID wait for dependsOnID.
// Both must exist and the resulting graph must remain acyclic.
func (s *Service) AddDependency(ctx context.Context, taskID, dependsOnID string) error {
	if _, err := s.st.GetTask(ctx, taskID); err != nil {
		return fmt.Errorf("task %s: %w", taskID, err)
	}
	if _, err := s.st.GetTask(ctx, dependsOnID); err != nil {
		return fmt.Errorf("dependency %s: %w", dependsOnID, err)
	}
	return s.st.AddDependency(ctx, taskID, dependsOnID)
}

// AddImage attaches a stored image to a task.
func (s *Service) AddImage(ctx context.Context, img *model.Image) error {
	return s.st.AddImage(ctx, img)
}
