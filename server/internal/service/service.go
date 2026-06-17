package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"

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
func (s *Service) CreateTask(ctx context.Context, projectIDOrName, title, description string, taskType model.TaskType, priority int, autoStart bool, labels ...[]string) (*model.Task, error) {
	if title == "" {
		return nil, errors.New("task title required")
	}
	if !taskType.Valid() {
		return nil, fmt.Errorf("invalid task type %q (must be feature, bug, or docs)", taskType)
	}
	p, err := s.ResolveProject(ctx, projectIDOrName)
	if err != nil {
		return nil, err
	}
	initial := model.StatePending
	if autoStart {
		initial = model.StateStart
	}
	return s.st.CreateTask(ctx, p.ID, title, description, taskType, priority, initial, labels...)
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

const (
	defaultSearchLimit = 20
	maxSearchLimit     = 100
)

// SearchTasks returns project-scoped tasks through the lexical ranking policy.
func (s *Service) SearchTasks(ctx context.Context, projectIDOrName, query string, limit int) ([]*model.Task, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, errors.New("search query required")
	}
	if limit <= 0 {
		limit = defaultSearchLimit
	}
	if limit > maxSearchLimit {
		limit = maxSearchLimit
	}
	p, err := s.ResolveProject(ctx, projectIDOrName)
	if err != nil {
		return nil, err
	}
	tasks, err := s.st.ListTasks(ctx, store.TaskFilter{ProjectID: p.ID})
	if err != nil {
		return nil, err
	}
	return newTaskSearchRanker().Rank(tasks, query, limit), nil
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

// DeleteTask removes a task and its dependency / attachment rows via FK cascade.
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

// DeleteDependency removes a single dependency edge from taskID.
func (s *Service) DeleteDependency(ctx context.Context, taskID, dependsOnID string) error {
	return s.st.DeleteDependency(ctx, taskID, dependsOnID)
}

// AddImage attaches a stored image to a task.
func (s *Service) AddImage(ctx context.Context, img *model.Image) error {
	return s.st.AddImage(ctx, img)
}

// GetImage fetches an image attachment by id.
func (s *Service) GetImage(ctx context.Context, id string) (*model.Image, error) {
	return s.st.GetImage(ctx, id)
}

// DeleteImage removes an image attachment by id.
func (s *Service) DeleteImage(ctx context.Context, id string) (*model.Image, error) {
	return s.st.DeleteImage(ctx, id)
}

// AddDoc attaches a markdown document to a task. The handler owns file IO; the
// service validates metadata before the store records the file reference.
func (s *Service) AddDoc(ctx context.Context, doc *model.Doc) error {
	if doc == nil {
		return errors.New("doc required")
	}
	doc.Title = strings.TrimSpace(doc.Title)
	if doc.Title == "" {
		return errors.New("doc title required")
	}
	if doc.StoragePath == "" {
		return errors.New("doc storage path required")
	}
	return s.st.AddDoc(ctx, doc)
}

// GetDoc fetches a markdown document by id.
func (s *Service) GetDoc(ctx context.Context, id string) (*model.Doc, error) {
	return s.st.GetDoc(ctx, id)
}

// UpdateDoc updates document metadata. Content updates are written by the
// handler before calling this method to bump the document timestamp.
func (s *Service) UpdateDoc(ctx context.Context, id string, u store.DocUpdate) (*model.Doc, error) {
	if u.Title != nil {
		title := strings.TrimSpace(*u.Title)
		if title == "" {
			return nil, errors.New("doc title required")
		}
		u.Title = &title
	}
	return s.st.UpdateDoc(ctx, id, u)
}

// DeleteDoc removes document metadata by id.
func (s *Service) DeleteDoc(ctx context.Context, id string) (*model.Doc, error) {
	return s.st.DeleteDoc(ctx, id)
}

// AddLink attaches a URL to a task. rawURL is required and must use the
// http or https scheme — the web renders these via <a href=…> and a
// `javascript:` (or `data:`, `file:`, …) URI would otherwise be an XSS
// vector. label is optional. Task existence is enforced by the store
// via the task_links → tasks FK; no extra GetTask round-trip here.
func (s *Service) AddLink(ctx context.Context, taskID, rawURL, label string) (*model.Link, error) {
	if rawURL == "" {
		return nil, errors.New("link url required")
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid link url: %w", err)
	}
	switch u.Scheme {
	case "http", "https":
	default:
		return nil, fmt.Errorf("link url must use http or https scheme (got %q)", u.Scheme)
	}
	if u.Host == "" {
		return nil, errors.New("link url must include a host")
	}
	link := &model.Link{TaskID: taskID, URL: rawURL, Label: label}
	if err := s.st.AddLink(ctx, link); err != nil {
		return nil, err
	}
	return link, nil
}

// DeleteLink removes a link by its id.
func (s *Service) DeleteLink(ctx context.Context, id string) error {
	return s.st.DeleteLink(ctx, id)
}
