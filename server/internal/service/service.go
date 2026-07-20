package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"taskline_server/api/model"
	"taskline_server/internal/store"
)

// Service holds business logic on top of the store: name resolution,
// state-machine validation, runnable filtering.
type Service struct {
	st              *store.Store
	stateEntryRules map[model.TaskState][]StateEntryRule
}

type serviceOptions struct {
	pullRequestVerifier PullRequestVerifier
	extraStateRules     map[model.TaskState][]StateEntryRule
}

// Option customizes service integrations without coupling business logic to
// their concrete implementations.
type Option func(*serviceOptions)

// WithPullRequestVerifier supplies the external PR facts used by the built-in
// review and done state-entry rules.
func WithPullRequestVerifier(verifier PullRequestVerifier) Option {
	return func(opts *serviceOptions) {
		if verifier != nil {
			opts.pullRequestVerifier = verifier
		}
	}
}

// WithStateEntryRule appends a rule for a target state. It is the extension
// point for future workflow evidence requirements.
func WithStateEntryRule(state model.TaskState, rule StateEntryRule) Option {
	return func(opts *serviceOptions) {
		if rule == nil {
			return
		}
		if opts.extraStateRules == nil {
			opts.extraStateRules = make(map[model.TaskState][]StateEntryRule)
		}
		opts.extraStateRules[state] = append(opts.extraStateRules[state], rule)
	}
}

func New(st *store.Store, options ...Option) *Service {
	opts := serviceOptions{pullRequestVerifier: unavailablePullRequestVerifier{}}
	for _, option := range options {
		option(&opts)
	}
	rules := defaultStateEntryRules(opts.pullRequestVerifier)
	for state, extra := range opts.extraStateRules {
		rules[state] = append(rules[state], extra...)
	}
	return &Service{st: st, stateEntryRules: rules}
}

const DefaultLeaseDuration = 6 * time.Hour

const (
	agentTokenPrefix = "tl_agent_"
	maxAgentNameLen  = 64
)

type AgentRegistration struct {
	Agent *model.Agent
	Token string
}

// RegisterAgent creates or rotates a local agent identity token.
func (s *Service) RegisterAgent(ctx context.Context, name string) (*AgentRegistration, error) {
	name, err := normalizeAgentName(name)
	if err != nil {
		return nil, err
	}
	token, err := generateAgentToken()
	if err != nil {
		return nil, err
	}
	agent, err := s.st.RegisterAgent(ctx, name, hashAgentToken(token))
	if err != nil {
		return nil, err
	}
	return &AgentRegistration{Agent: agent, Token: token}, nil
}

// ResolveAgentToken resolves a bearer token to its registered agent.
func (s *Service) ResolveAgentToken(ctx context.Context, token string) (*model.Agent, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, errors.New("agent token required: run taskline register --name <agent>")
	}
	return s.st.GetAgentByTokenHash(ctx, hashAgentToken(token))
}

// Status returns server health and, when agent is non-nil, its live claims.
func (s *Service) Status(ctx context.Context, agent *model.Agent) (*model.ServerStatus, error) {
	nowMS := nowMillis()
	status := &model.ServerStatus{
		OK:          true,
		ServerTime:  nowMS,
		Agent:       agent,
		ActiveTasks: make([]model.ActiveClaim, 0),
	}
	if agent == nil {
		return status, nil
	}
	claims, err := s.st.ListActiveClaims(ctx, agent.Name, nowMS)
	if err != nil {
		return nil, err
	}
	for i := range claims {
		claims[i].ClaimedForMS = max(nowMS-claims[i].ClaimedAt, 0)
	}
	status.ActiveTasks = claims
	return status, nil
}

func normalizeAgentName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("agent name required")
	}
	if len([]rune(name)) > maxAgentNameLen {
		return "", fmt.Errorf("agent name too long: max %d characters", maxAgentNameLen)
	}
	if strings.ContainsAny(name, "\t\n\r") {
		return "", errors.New("agent name cannot contain tabs or newlines")
	}
	return name, nil
}

func generateAgentToken() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	return agentTokenPrefix + base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

func hashAgentToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

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
	task, err := s.st.CreateTask(ctx, p.ID, title, description, taskType, priority, initial, labels...)
	if err != nil {
		return nil, err
	}
	if err := s.recordTaskEvent(ctx, task.ID, "created", "Created task", map[string]any{
		"task": taskSnapshot(task),
	}, task.CreatedAt); err != nil {
		return nil, err
	}
	return task, nil
}

// GetTask fetches a task by id.
func (s *Service) GetTask(ctx context.Context, id string) (*model.Task, error) {
	return s.st.GetTask(ctx, id)
}

// ListTasks returns tasks under a project, optionally filtered by state.
func (s *Service) ListTasks(ctx context.Context, projectIDOrName string, states []model.TaskState) ([]*model.Task, error) {
	return s.ListTasksFiltered(ctx, projectIDOrName, TaskListOptions{States: states})
}

type TaskListOptions struct {
	States    []model.TaskState
	Owner     *string
	Unclaimed bool
	Labels    []string
}

// ListTasksFiltered returns tasks under a project, optionally filtered by state
// and claim metadata.
func (s *Service) ListTasksFiltered(ctx context.Context, projectIDOrName string, opts TaskListOptions) ([]*model.Task, error) {
	p, err := s.ResolveProject(ctx, projectIDOrName)
	if err != nil {
		return nil, err
	}
	for _, st := range opts.States {
		if !st.Valid() {
			return nil, fmt.Errorf("invalid state %q", st)
		}
	}
	if opts.Owner != nil {
		owner := strings.TrimSpace(*opts.Owner)
		opts.Owner = &owner
	}
	return s.st.ListTasks(ctx, store.TaskFilter{ProjectID: p.ID, States: opts.States, Owner: opts.Owner, Unclaimed: opts.Unclaimed, Labels: opts.Labels})
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

type RunnableOptions struct {
	Owner  string
	Labels []string
}

// NextRunnableTask returns the highest-priority task whose deps are all done
// and whose claim is available to the requested owner.
// Returns (nil, nil) if no task is runnable.
func (s *Service) NextRunnableTask(ctx context.Context, projectIDOrName string, opts ...RunnableOptions) (*model.Task, error) {
	tasks, err := s.ListRunnableTasks(ctx, projectIDOrName, opts...)
	if err != nil {
		return nil, err
	}
	if len(tasks) == 0 {
		return nil, nil
	}
	return tasks[0], nil
}

type ClaimOptions struct {
	Owner  string
	Lease  time.Duration
	Labels []string
}

type ReleaseOptions struct {
	Owner string
	Force bool
}

// ClaimNextTask atomically reserves the next runnable task for an owner.
func (s *Service) ClaimNextTask(ctx context.Context, projectIDOrName string, opts ClaimOptions) (*model.Task, error) {
	owner, lease, err := normalizeClaimInput(opts.Owner, opts.Lease)
	if err != nil {
		return nil, err
	}
	p, err := s.ResolveProject(ctx, projectIDOrName)
	if err != nil {
		return nil, err
	}
	nowMs := nowMillis()
	task, err := s.st.ClaimNextTask(ctx, p.ID, store.ClaimOptions{Owner: owner, Now: nowMs, LeaseExpiresAt: nowMs + durationMillis(lease), Labels: opts.Labels})
	if err != nil || task == nil {
		return task, err
	}
	if err := s.recordTaskEvent(ctx, task.ID, "claimed", "Claimed task", map[string]any{
		"owner": task.Owner, "claimed_at": task.ClaimedAt,
		"lease_expires_at": task.LeaseExpiresAt,
	}, task.UpdatedAt); err != nil {
		return nil, err
	}
	return task, nil
}

// ClaimTask explicitly reserves one task for an owner.
func (s *Service) ClaimTask(ctx context.Context, id string, opts ClaimOptions) (*model.Task, error) {
	owner, lease, err := normalizeClaimInput(opts.Owner, opts.Lease)
	if err != nil {
		return nil, err
	}
	nowMs := nowMillis()
	task, err := s.st.ClaimTask(ctx, id, store.ClaimOptions{Owner: owner, Now: nowMs, LeaseExpiresAt: nowMs + durationMillis(lease)})
	if err != nil {
		return nil, err
	}
	if err := s.recordTaskEvent(ctx, task.ID, "claimed", "Claimed task", map[string]any{
		"owner": task.Owner, "claimed_at": task.ClaimedAt,
		"lease_expires_at": task.LeaseExpiresAt,
	}, task.UpdatedAt); err != nil {
		return nil, err
	}
	return task, nil
}

// HeartbeatTask renews a task lease for the current owner.
func (s *Service) HeartbeatTask(ctx context.Context, id string, opts ClaimOptions) (*model.Task, error) {
	owner, lease, err := normalizeClaimInput(opts.Owner, opts.Lease)
	if err != nil {
		return nil, err
	}
	nowMs := nowMillis()
	task, err := s.st.HeartbeatTask(ctx, id, store.HeartbeatOptions{Owner: owner, Now: nowMs, LeaseExpiresAt: nowMs + durationMillis(lease)})
	if err != nil {
		return nil, err
	}
	if err := s.recordTaskEvent(ctx, task.ID, "claim_renewed", "Renewed claim lease", map[string]any{
		"owner": task.Owner, "lease_expires_at": task.LeaseExpiresAt,
	}, task.UpdatedAt); err != nil {
		return nil, err
	}
	return task, nil
}

// ReleaseTask clears a claim. Without Force, owner must match.
func (s *Service) ReleaseTask(ctx context.Context, id string, opts ReleaseOptions) (*model.Task, error) {
	owner := strings.TrimSpace(opts.Owner)
	if owner == "" && !opts.Force {
		return nil, errors.New("agent identity required: run taskline register --name <agent>")
	}
	before, err := s.st.GetTask(ctx, id)
	if err != nil {
		return nil, err
	}
	task, err := s.st.ReleaseTask(ctx, id, store.ReleaseOptions{Owner: owner, Force: opts.Force, Now: nowMillis()})
	if err != nil {
		return nil, err
	}
	if err := s.recordTaskEvent(ctx, task.ID, "released", "Released task claim", map[string]any{
		"owner": before.Owner, "claimed_at": before.ClaimedAt,
		"force": opts.Force,
	}, task.UpdatedAt); err != nil {
		return nil, err
	}
	return task, nil
}

// ListRunnableTasks returns all currently-runnable tasks claimable by owner.
func (s *Service) ListRunnableTasks(ctx context.Context, projectIDOrName string, opts ...RunnableOptions) ([]*model.Task, error) {
	p, err := s.ResolveProject(ctx, projectIDOrName)
	if err != nil {
		return nil, err
	}
	var opt RunnableOptions
	if len(opts) > 0 {
		opt = opts[0]
	}
	return s.st.ListRunnableTasks(ctx, p.ID, store.RunnableFilter{
		Owner:  opt.Owner,
		Now:    nowMillis(),
		Labels: opt.Labels,
	})
}

// UpdateTask applies partial updates with state-machine validation.
func (s *Service) UpdateTask(ctx context.Context, id string, u store.TaskUpdate) (*model.Task, error) {
	if u.IfState != nil && !u.IfState.Valid() {
		return nil, fmt.Errorf("invalid if-state %q", *u.IfState)
	}
	u.Owner = strings.TrimSpace(u.Owner)
	before, err := s.st.GetTask(ctx, id)
	if err != nil {
		return nil, err
	}
	if u.State != nil {
		if err := before.State.CanTransitionTo(*u.State); err != nil {
			return nil, fmt.Errorf("invalid transition %s -> %s: %w", before.State, *u.State, err)
		}
		if u.IfState != nil && before.State != *u.IfState {
			return nil, fmt.Errorf("%w: state conflict: expected %s, current state %s", store.ErrConflict, *u.IfState, before.State)
		}
		if !u.Force && before.Owner != "" {
			if u.Owner == "" {
				return nil, fmt.Errorf("%w: task is claimed by %s; pass owner or force", store.ErrConflict, before.Owner)
			}
			if u.Owner != before.Owner {
				return nil, fmt.Errorf("%w: task is claimed by %s", store.ErrConflict, before.Owner)
			}
		}
		if before.State != *u.State {
			if err := s.validateStateEntry(ctx, before, *u.State); err != nil {
				return nil, err
			}
		}
	}
	if u.Owner != "" {
		nowMs := nowMillis()
		u.Now = nowMs
		u.LeaseExpiresAt = nowMs + durationMillis(DefaultLeaseDuration)
	}
	task, err := s.st.UpdateTask(ctx, id, u)
	if err != nil {
		return nil, err
	}
	changes := taskFieldChanges(before, task)
	if err := s.recordTaskEvent(ctx, task.ID, "updated", updatedTaskSummary(changes), map[string]any{
		"changes": changes,
	}, task.UpdatedAt); err != nil {
		return nil, err
	}
	return task, nil
}

func normalizeClaimInput(owner string, lease time.Duration) (string, time.Duration, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return "", 0, errors.New("agent identity required: run taskline register --name <agent>")
	}
	if lease == 0 {
		lease = DefaultLeaseDuration
	}
	if lease < time.Millisecond {
		return "", 0, errors.New("lease must be positive")
	}
	return owner, lease, nil
}

func nowMillis() int64 { return time.Now().UnixMilli() }

func durationMillis(d time.Duration) int64 { return int64(d / time.Millisecond) }

// DeleteTask removes a task and its dependency / attachment rows via FK cascade.
func (s *Service) DeleteTask(ctx context.Context, id string) error {
	task, err := s.st.GetTask(ctx, id)
	if err != nil {
		return err
	}
	if err := s.st.DeleteTask(ctx, id); err != nil {
		return err
	}
	return s.recordTaskEvent(ctx, id, "deleted", "Deleted task", map[string]any{
		"task": taskSnapshot(task),
	}, nowMillis())
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
	if err := s.st.AddDependency(ctx, taskID, dependsOnID); err != nil {
		return err
	}
	return s.recordTaskEvent(ctx, taskID, "dependency_added", "Added task dependency", map[string]any{
		"depends_on": dependsOnID,
	}, nowMillis())
}

// DeleteDependency removes a single dependency edge from taskID.
func (s *Service) DeleteDependency(ctx context.Context, taskID, dependsOnID string) error {
	if err := s.st.DeleteDependency(ctx, taskID, dependsOnID); err != nil {
		return err
	}
	return s.recordTaskEvent(ctx, taskID, "dependency_removed", "Removed task dependency", map[string]any{
		"depends_on": dependsOnID,
	}, nowMillis())
}

// AddImage attaches a stored image to a task.
func (s *Service) AddImage(ctx context.Context, img *model.Image) error {
	if err := s.st.AddImage(ctx, img); err != nil {
		return err
	}
	return s.recordTaskEvent(ctx, img.TaskID, "image_added", "Added image "+img.Filename, map[string]any{
		"image": map[string]any{"id": img.ID, "filename": img.Filename, "mime_type": img.MimeType, "size_bytes": img.SizeBytes},
	}, img.UploadedAt)
}

// GetImage fetches an image attachment by id.
func (s *Service) GetImage(ctx context.Context, id string) (*model.Image, error) {
	return s.st.GetImage(ctx, id)
}

// DeleteImage removes an image attachment by id.
func (s *Service) DeleteImage(ctx context.Context, id string) (*model.Image, error) {
	img, err := s.st.DeleteImage(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := s.recordTaskEvent(ctx, img.TaskID, "image_removed", "Removed image "+img.Filename, map[string]any{
		"image": map[string]any{"id": img.ID, "filename": img.Filename},
	}, nowMillis()); err != nil {
		return nil, err
	}
	return img, nil
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
	if err := s.st.AddDoc(ctx, doc); err != nil {
		return err
	}
	return s.recordTaskEvent(ctx, doc.TaskID, "document_added", "Added document "+doc.Title, map[string]any{
		"document": map[string]any{"id": doc.ID, "title": doc.Title},
	}, doc.CreatedAt)
}

// GetDoc fetches a markdown document by id.
func (s *Service) GetDoc(ctx context.Context, id string) (*model.Doc, error) {
	return s.st.GetDoc(ctx, id)
}

// UpdateDoc updates document metadata. Content updates are written by the
// handler before calling this method to bump the document timestamp.
func (s *Service) UpdateDoc(ctx context.Context, id string, u store.DocUpdate, contentChanged bool) (*model.Doc, error) {
	before, err := s.st.GetDoc(ctx, id)
	if err != nil {
		return nil, err
	}
	if u.Title != nil {
		title := strings.TrimSpace(*u.Title)
		if title == "" {
			return nil, errors.New("doc title required")
		}
		u.Title = &title
	}
	doc, err := s.st.UpdateDoc(ctx, id, u)
	if err != nil {
		return nil, err
	}
	changes := make(map[string]any)
	if before.Title != doc.Title {
		changes["title"] = map[string]any{"before": before.Title, "after": doc.Title}
	}
	if contentChanged {
		changes["content"] = map[string]any{"changed": true}
	}
	if err := s.recordTaskEvent(ctx, doc.TaskID, "document_updated", "Updated document "+doc.Title, map[string]any{
		"document": map[string]any{"id": doc.ID, "title": doc.Title},
		"changes":  changes,
	}, doc.UpdatedAt); err != nil {
		return nil, err
	}
	return doc, nil
}

// DeleteDoc removes document metadata by id.
func (s *Service) DeleteDoc(ctx context.Context, id string) (*model.Doc, error) {
	doc, err := s.st.DeleteDoc(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := s.recordTaskEvent(ctx, doc.TaskID, "document_removed", "Removed document "+doc.Title, map[string]any{
		"document": map[string]any{"id": doc.ID, "title": doc.Title},
	}, nowMillis()); err != nil {
		return nil, err
	}
	return doc, nil
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
	if err := s.recordTaskEvent(ctx, taskID, "link_added", "Added link "+link.URL, map[string]any{
		"link": map[string]any{"id": link.ID, "url": link.URL, "label": link.Label},
	}, link.CreatedAt); err != nil {
		return nil, err
	}
	return link, nil
}

// DeleteLink removes a link by its id.
func (s *Service) DeleteLink(ctx context.Context, id string) error {
	link, err := s.st.GetLink(ctx, id)
	if err != nil {
		return err
	}
	if err := s.st.DeleteLink(ctx, id); err != nil {
		return err
	}
	return s.recordTaskEvent(ctx, link.TaskID, "link_removed", "Removed link "+link.URL, map[string]any{
		"link": map[string]any{"id": link.ID, "url": link.URL, "label": link.Label},
	}, nowMillis())
}
