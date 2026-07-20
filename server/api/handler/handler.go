package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"

	"taskline_server/api/model"
	"taskline_server/internal/config"
	"taskline_server/internal/service"
	"taskline_server/internal/store"
	webfs "taskline_server/web"
)

// Handler wires HTTP routes to the service layer.
type Handler struct {
	svc         *service.Service
	attachments *taskAttachmentStorage
	uiFS        fs.FS // populated by Register when an embedded/external UI is found
}

func New(svc *service.Service, cfg *config.Config) *Handler {
	return &Handler{svc: svc, attachments: newTaskAttachmentStorage(cfg)}
}

// Register installs all routes on the Hertz server. Order matters: API
// routes are registered first so the static fallback only catches paths
// the UI owns.
func (h *Handler) Register(s *server.Hertz) {
	// Permissive CORS — this server is meant for single-user local use,
	// and the dev vite server runs on a different port.
	s.Use(corsMiddleware)

	s.GET("/healthz", h.health)

	v1 := s.Group("/api/v1")
	v1.GET("/status", h.status)
	v1.POST("/agents/register", h.registerAgent)

	v1.POST("/projects", h.createProject)
	v1.GET("/projects", h.listProjects)

	v1.POST("/projects/:project/tasks", h.createTask)
	v1.GET("/projects/:project/tasks", h.listTasks)
	v1.GET("/projects/:project/tasks/search", h.searchTasks)
	v1.GET("/projects/:project/tasks/runnable", h.listRunnableTasks)
	v1.GET("/projects/:project/tasks/next", h.nextRunnableTask)

	v1.GET("/tasks/:id", h.getTask)
	v1.PATCH("/tasks/:id", h.updateTask)
	v1.DELETE("/tasks/:id", h.deleteTask)
	v1.POST("/tasks/:id/claim", h.claimTask)
	v1.POST("/tasks/:id/release", h.releaseTask)
	v1.POST("/tasks/:id/heartbeat", h.heartbeatTask)
	v1.POST("/tasks/:id/deps", h.addDependency)
	v1.DELETE("/tasks/:id/deps/:dependsOn", h.deleteDependency)
	v1.POST("/tasks/:id/images", h.uploadImage)
	v1.POST("/tasks/:id/docs", h.createDoc)
	v1.POST("/tasks/:id/links", h.addLink)
	v1.GET("/images/:id", h.getImage)
	v1.GET("/docs/:id", h.getDoc)
	v1.GET("/docs/:id/content", h.getDocContent)
	v1.PATCH("/docs/:id", h.updateDoc)
	v1.DELETE("/images/:id", h.deleteImage)
	v1.DELETE("/docs/:id", h.deleteDoc)
	v1.DELETE("/links/:id", h.deleteLink)

	// Mount the bundled UI last so /api/* and /healthz keep their handlers.
	if uiFS, ok := webfs.FS(); ok {
		h.uiFS = uiFS
		s.NoRoute(h.serveUI)
	}
}

// corsMiddleware allows the dev vite server (and any local origin) to
// hit the API. Production deploys typically serve UI + API from the same
// origin so the headers are a no-op there.
func corsMiddleware(_ context.Context, c *app.RequestContext) {
	c.Response.Header.Set("Access-Control-Allow-Origin", "*")
	c.Response.Header.Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
	c.Response.Header.Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
	if string(c.Method()) == http.MethodOptions {
		c.SetStatusCode(http.StatusNoContent)
		c.Abort()
		return
	}
	c.Next(context.Background())
}

// serveUI is the SPA fallback: try to serve the requested asset from the
// embedded filesystem; on miss, return index.html so the client-side
// router can take over.
func (h *Handler) serveUI(_ context.Context, c *app.RequestContext) {
	if h.uiFS == nil {
		c.SetStatusCode(http.StatusNotFound)
		return
	}
	requested := strings.TrimPrefix(string(c.Path()), "/")
	if requested == "" {
		requested = "index.html"
	}
	if data, err := fs.ReadFile(h.uiFS, requested); err == nil {
		ct := mime.TypeByExtension(path.Ext(requested))
		if ct == "" {
			ct = "application/octet-stream"
		}
		c.SetStatusCode(http.StatusOK)
		c.Response.Header.Set("Content-Type", ct)
		c.Write(data)
		return
	}
	// SPA fallback — every unknown path returns index.html so deep links
	// work for client-routed views.
	if data, err := fs.ReadFile(h.uiFS, "index.html"); err == nil {
		c.SetStatusCode(http.StatusOK)
		c.Response.Header.Set("Content-Type", "text/html; charset=utf-8")
		c.Write(data)
		return
	}
	c.SetStatusCode(http.StatusNotFound)
}

// ─── Agent handlers ─────────────────────────────────────────────────────

type registerAgentReq struct {
	Name string `json:"name"`
}

func (h *Handler) registerAgent(ctx context.Context, c *app.RequestContext) {
	agent, ok := h.optionalAgent(ctx, c)
	if !ok {
		return
	}
	if agent != nil {
		writeError(c, http.StatusConflict, fmt.Errorf(
			"already registered as %s; run taskline status to inspect the current identity; remove .config/taskline/agent.json before intentional re-registration",
			agent.Name,
		))
		return
	}
	var req registerAgentReq
	if err := decodeJSON(c, &req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	reg, err := h.svc.RegisterAgent(ctx, req.Name)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	writeJSON(c, http.StatusCreated, map[string]any{
		"agent": reg.Agent,
		"token": reg.Token,
	})
}

func (h *Handler) status(ctx context.Context, c *app.RequestContext) {
	agent, ok := h.optionalAgent(ctx, c)
	if !ok {
		return
	}
	status, err := h.svc.Status(ctx, agent)
	if err != nil {
		writeError(c, http.StatusInternalServerError, err)
		return
	}
	writeJSON(c, http.StatusOK, status)
}

// ─── Project handlers ───────────────────────────────────────────────────

type createProjectReq struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (h *Handler) createProject(ctx context.Context, c *app.RequestContext) {
	var req createProjectReq
	if err := decodeJSON(c, &req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	p, err := h.svc.CreateProject(ctx, req.Name, req.Description)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	writeJSON(c, http.StatusCreated, p)
}

func (h *Handler) listProjects(ctx context.Context, c *app.RequestContext) {
	ps, err := h.svc.ListProjects(ctx)
	if err != nil {
		writeError(c, http.StatusInternalServerError, err)
		return
	}
	writeJSON(c, http.StatusOK, map[string]any{"projects": ps})
}

// ─── Task handlers ──────────────────────────────────────────────────────

type createTaskReq struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Type        string   `json:"type"`
	Priority    int      `json:"priority"`
	Labels      []string `json:"labels,omitempty"`
	// AutoStart picks the initial state: true → "start", omitted/false →
	// "pending". Pointer so callers that don't send the field get the
	// documented default (pending), instead of silent auto-start.
	AutoStart *bool `json:"auto_start,omitempty"`
}

func (h *Handler) createTask(ctx context.Context, c *app.RequestContext) {
	project := c.Param("project")
	var req createTaskReq
	if err := decodeJSON(c, &req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	if req.Type == "" {
		req.Type = string(model.TaskTypeFeature)
	}
	autoStart := req.AutoStart != nil && *req.AutoStart
	t, err := h.svc.CreateTask(ctx, project, req.Title, req.Description, model.TaskType(req.Type), req.Priority, autoStart, req.Labels)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	writeJSON(c, http.StatusCreated, t)
}

func (h *Handler) listTasks(ctx context.Context, c *app.RequestContext) {
	project := c.Param("project")
	var states []model.TaskState
	if raw := string(c.Query("state")); raw != "" {
		for _, s := range strings.Split(raw, ",") {
			s = strings.TrimSpace(s)
			if s != "" {
				states = append(states, model.TaskState(s))
			}
		}
	}
	opts := service.TaskListOptions{States: states, Labels: queryLabels(c)}
	if raw := strings.TrimSpace(string(c.Query("owner"))); raw != "" {
		opts.Owner = &raw
	}
	if raw := strings.TrimSpace(string(c.Query("unclaimed"))); raw != "" {
		unclaimed, err := parseBoolQuery(raw)
		if err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		opts.Unclaimed = unclaimed
	}
	ts, err := h.svc.ListTasksFiltered(ctx, project, opts)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	h.attachments.AttachTaskImageURLs(ts...)
	h.attachments.AttachTaskDocURLs(ts...)
	writeJSON(c, http.StatusOK, map[string]any{"tasks": ts})
}

func (h *Handler) searchTasks(ctx context.Context, c *app.RequestContext) {
	project := c.Param("project")
	query := strings.TrimSpace(string(c.Query("q")))
	if query == "" {
		writeError(c, http.StatusBadRequest, errors.New("search query required"))
		return
	}
	limit := 0
	if raw := strings.TrimSpace(string(c.Query("limit"))); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			writeError(c, http.StatusBadRequest, errors.New("limit must be a positive integer"))
			return
		}
		limit = parsed
	}
	ts, err := h.svc.SearchTasks(ctx, project, query, limit)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	h.attachments.AttachTaskImageURLs(ts...)
	h.attachments.AttachTaskDocURLs(ts...)
	writeJSON(c, http.StatusOK, map[string]any{"tasks": ts})
}

func (h *Handler) listRunnableTasks(ctx context.Context, c *app.RequestContext) {
	project := c.Param("project")
	agent, ok := h.optionalAgent(ctx, c)
	if !ok {
		return
	}
	owner := ""
	if agent != nil {
		owner = agent.Name
	}
	ts, err := h.svc.ListRunnableTasks(ctx, project, service.RunnableOptions{
		Owner:  owner,
		Labels: queryLabels(c),
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	h.attachments.AttachTaskImageURLs(ts...)
	h.attachments.AttachTaskDocURLs(ts...)
	writeJSON(c, http.StatusOK, map[string]any{"tasks": ts})
}

func (h *Handler) nextRunnableTask(ctx context.Context, c *app.RequestContext) {
	project := c.Param("project")
	labels := queryLabels(c)
	agent, ok := h.optionalAgent(ctx, c)
	if !ok {
		return
	}
	claim, err := parseBoolQueryDefaultFalse(strings.TrimSpace(string(c.Query("claim"))))
	if err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	var t *model.Task
	if claim {
		if agent == nil {
			writeError(c, http.StatusUnauthorized, errors.New("agent token required: run taskline register --name <agent>"))
			return
		}
		lease, parseErr := parseLease(strings.TrimSpace(string(c.Query("lease"))))
		if parseErr != nil {
			writeError(c, http.StatusBadRequest, parseErr)
			return
		}
		t, err = h.svc.ClaimNextTask(ctx, project, service.ClaimOptions{
			Owner:  agent.Name,
			Lease:  lease,
			Labels: labels,
		})
	} else {
		owner := ""
		if agent != nil {
			owner = agent.Name
		}
		t, err = h.svc.NextRunnableTask(ctx, project, service.RunnableOptions{
			Owner:  owner,
			Labels: labels,
		})
	}
	if err != nil {
		writeServiceError(c, err)
		return
	}
	if t == nil {
		writeJSON(c, http.StatusOK, map[string]any{"task": nil})
		return
	}
	h.attachments.AttachTaskImageURLs(t)
	h.attachments.AttachTaskDocURLs(t)
	writeJSON(c, http.StatusOK, map[string]any{"task": t})
}

func (h *Handler) getTask(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	t, err := h.svc.GetTask(ctx, id)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	h.attachments.AttachTaskImageURLs(t)
	h.attachments.AttachTaskDocURLs(t)
	writeJSON(c, http.StatusOK, t)
}

type updateTaskReq struct {
	Title             *string      `json:"title,omitempty"`
	Description       *string      `json:"description,omitempty"`
	DescriptionAppend *string      `json:"description_append,omitempty"`
	Type              *string      `json:"type,omitempty"`
	State             *string      `json:"state,omitempty"`
	Priority          *int         `json:"priority,omitempty"`
	Labels            *[]string    `json:"labels,omitempty"`
	LabelOps          *labelOpsReq `json:"label_ops,omitempty"`
	IfState           *string      `json:"if_state,omitempty"`
	Force             bool         `json:"force,omitempty"`
}

type labelOpsReq struct {
	Add    []string `json:"add,omitempty"`
	Remove []string `json:"remove,omitempty"`
}

func (r *labelOpsReq) hasOps() bool {
	return r != nil && (len(r.Add) > 0 || len(r.Remove) > 0)
}

func (h *Handler) updateTask(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	var req updateTaskReq
	if err := decodeJSON(c, &req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	u := store.TaskUpdate{}
	if req.Title != nil {
		u.Title = req.Title
	}
	if req.Description != nil {
		u.Description = req.Description
	}
	if req.Description != nil && req.DescriptionAppend != nil {
		writeError(c, http.StatusBadRequest, errors.New("description and description_append cannot be used together"))
		return
	}
	if req.DescriptionAppend != nil {
		u.DescriptionAppend = req.DescriptionAppend
	}
	if req.Type != nil {
		tt := model.TaskType(*req.Type)
		u.Type = &tt
	}
	if req.State != nil {
		st := model.TaskState(*req.State)
		u.State = &st
	}
	if req.Priority != nil {
		u.Priority = req.Priority
	}
	if req.Labels != nil {
		if req.LabelOps.hasOps() {
			writeError(c, http.StatusBadRequest, errors.New("labels and label_ops cannot be used together"))
			return
		}
		u.Labels = req.Labels
	}
	if req.LabelOps.hasOps() {
		u.AddLabels = req.LabelOps.Add
		u.RemoveLabels = req.LabelOps.Remove
	}
	if req.IfState != nil {
		st := model.TaskState(*req.IfState)
		u.IfState = &st
	}
	if agent, ok := h.optionalAgent(ctx, c); !ok {
		return
	} else if agent != nil {
		u.Owner = agent.Name
	}
	u.Force = req.Force
	t, err := h.svc.UpdateTask(ctx, id, u)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	h.attachments.AttachTaskImageURLs(t)
	h.attachments.AttachTaskDocURLs(t)
	writeJSON(c, http.StatusOK, t)
}

type claimTaskReq struct {
	Lease string `json:"lease,omitempty"`
}

type releaseTaskReq struct {
	Force bool `json:"force,omitempty"`
}

func (h *Handler) claimTask(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	agent, ok := h.requireAgent(ctx, c)
	if !ok {
		return
	}
	var req claimTaskReq
	if err := decodeJSON(c, &req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	lease, err := parseLease(req.Lease)
	if err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	t, err := h.svc.ClaimTask(ctx, id, service.ClaimOptions{Owner: agent.Name, Lease: lease})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	h.attachments.AttachTaskImageURLs(t)
	h.attachments.AttachTaskDocURLs(t)
	writeJSON(c, http.StatusOK, t)
}

func (h *Handler) heartbeatTask(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	agent, ok := h.requireAgent(ctx, c)
	if !ok {
		return
	}
	var req claimTaskReq
	if err := decodeJSON(c, &req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	lease, err := parseLease(req.Lease)
	if err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	t, err := h.svc.HeartbeatTask(ctx, id, service.ClaimOptions{Owner: agent.Name, Lease: lease})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	h.attachments.AttachTaskImageURLs(t)
	h.attachments.AttachTaskDocURLs(t)
	writeJSON(c, http.StatusOK, t)
}

func (h *Handler) releaseTask(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	var req releaseTaskReq
	if err := decodeJSON(c, &req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	owner := ""
	if !req.Force {
		agent, ok := h.requireAgent(ctx, c)
		if !ok {
			return
		}
		owner = agent.Name
	}
	t, err := h.svc.ReleaseTask(ctx, id, service.ReleaseOptions{Owner: owner, Force: req.Force})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	h.attachments.AttachTaskImageURLs(t)
	h.attachments.AttachTaskDocURLs(t)
	writeJSON(c, http.StatusOK, t)
}

func (h *Handler) deleteTask(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	if err := h.svc.DeleteTask(ctx, id); err != nil {
		writeServiceError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, map[string]any{"deleted": true, "id": id})
}

type addDepReq struct {
	DependsOn string `json:"depends_on"`
}

func (h *Handler) addDependency(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	var req addDepReq
	if err := decodeJSON(c, &req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	if req.DependsOn == "" {
		writeError(c, http.StatusBadRequest, errors.New("depends_on required"))
		return
	}
	if err := h.svc.AddDependency(ctx, id, req.DependsOn); err != nil {
		writeServiceError(c, err)
		return
	}
	writeJSON(c, http.StatusCreated, map[string]any{"task_id": id, "depends_on": req.DependsOn})
}

func (h *Handler) deleteDependency(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	dependsOn := c.Param("dependsOn")
	if err := h.svc.DeleteDependency(ctx, id, dependsOn); err != nil {
		writeServiceError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, map[string]any{
		"deleted":    true,
		"task_id":    id,
		"depends_on": dependsOn,
	})
}

type addLinkReq struct {
	URL   string `json:"url"`
	Label string `json:"label"`
}

func (h *Handler) addLink(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	var req addLinkReq
	if err := decodeJSON(c, &req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	link, err := h.svc.AddLink(ctx, id, req.URL, req.Label)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	writeJSON(c, http.StatusCreated, link)
}

func (h *Handler) deleteLink(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	if err := h.svc.DeleteLink(ctx, id); err != nil {
		writeServiceError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, map[string]any{"deleted": true, "id": id})
}

type createDocReq struct {
	Title   string `json:"title"`
	Content string `json:"content"`
}

func (h *Handler) createDoc(ctx context.Context, c *app.RequestContext) {
	taskID := c.Param("id")
	if _, err := h.svc.GetTask(ctx, taskID); err != nil {
		writeServiceError(c, err)
		return
	}
	var req createDocReq
	if err := decodeJSON(c, &req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		writeError(c, http.StatusBadRequest, errors.New("doc title required"))
		return
	}
	doc, err := h.attachments.SaveDoc(taskID, req.Title, req.Content)
	if err != nil {
		writeError(c, http.StatusInternalServerError, err)
		return
	}
	if err := h.svc.AddDoc(ctx, doc); err != nil {
		_ = h.attachments.DeleteFile(doc.StoragePath)
		writeServiceError(c, err)
		return
	}
	doc.Content = req.Content
	h.attachments.AttachDocURL(doc)
	writeJSON(c, http.StatusCreated, doc)
}

func (h *Handler) getDoc(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	doc, err := h.svc.GetDoc(ctx, id)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	content, err := h.attachments.ReadDocContent(doc)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	doc.Content = string(content)
	h.attachments.AttachDocURL(doc)
	writeJSON(c, http.StatusOK, doc)
}

func (h *Handler) getDocContent(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	doc, err := h.svc.GetDoc(ctx, id)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	content, err := h.attachments.ReadDocContent(doc)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.SetStatusCode(http.StatusOK)
	c.Response.Header.Set("Content-Type", "text/markdown; charset=utf-8")
	c.Response.Header.Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{
		"filename": doc.ID + ".md",
	}))
	c.Write(content)
}

type updateDocReq struct {
	Title   *string `json:"title,omitempty"`
	Content *string `json:"content,omitempty"`
}

func (h *Handler) updateDoc(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	doc, err := h.svc.GetDoc(ctx, id)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	var req updateDocReq
	if err := decodeJSON(c, &req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}
	u := store.DocUpdate{}
	if req.Title != nil {
		title := strings.TrimSpace(*req.Title)
		if title == "" {
			writeError(c, http.StatusBadRequest, errors.New("doc title required"))
			return
		}
		u.Title = &title
	}
	var tempPath string
	if req.Content != nil {
		tempPath, err = h.attachments.WriteDocContentTemp(doc, *req.Content)
		if err != nil {
			writeError(c, http.StatusInternalServerError, err)
			return
		}
	}
	updated, err := h.svc.UpdateDoc(ctx, id, u)
	if err != nil {
		if tempPath != "" {
			_ = h.attachments.DeleteFile(tempPath)
		}
		writeServiceError(c, err)
		return
	}
	if req.Content != nil {
		if err := h.attachments.CommitDocContent(doc, tempPath); err != nil {
			writeError(c, http.StatusInternalServerError, err)
			return
		}
		updated.Content = *req.Content
	} else if content, err := h.attachments.ReadDocContent(updated); err != nil {
		writeServiceError(c, err)
		return
	} else {
		updated.Content = string(content)
	}
	h.attachments.AttachDocURL(updated)
	writeJSON(c, http.StatusOK, updated)
}

func (h *Handler) deleteDoc(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	doc, err := h.svc.DeleteDoc(ctx, id)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	if doc.StoragePath != "" {
		_ = h.attachments.DeleteFile(doc.StoragePath)
	}
	writeJSON(c, http.StatusOK, map[string]any{"deleted": true, "id": id})
}

func (h *Handler) uploadImage(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	// Verify task exists before writing the file.
	if _, err := h.svc.GetTask(ctx, id); err != nil {
		writeServiceError(c, err)
		return
	}
	fh, err := c.FormFile("file")
	if err != nil {
		writeError(c, http.StatusBadRequest, fmt.Errorf("multipart field 'file' required: %w", err))
		return
	}
	saved, err := h.attachments.SaveImage(id, fh)
	if err != nil {
		writeError(c, http.StatusInternalServerError, err)
		return
	}
	if err := h.svc.AddImage(ctx, saved); err != nil {
		// Roll back the file on DB failure.
		_ = h.attachments.DeleteFile(saved.StoragePath)
		writeServiceError(c, err)
		return
	}
	h.attachments.AttachImageURL(saved)
	writeJSON(c, http.StatusCreated, saved)
}

func (h *Handler) getImage(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	img, err := h.svc.GetImage(ctx, id)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	content, err := h.attachments.ReadImageContent(img)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.SetStatusCode(http.StatusOK)
	c.Response.Header.Set("Content-Type", content.ContentType)
	c.Response.Header.Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{
		"filename": content.Filename,
	}))
	c.File(content.Path)
}

func (h *Handler) deleteImage(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	img, err := h.svc.DeleteImage(ctx, id)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	if img.StoragePath != "" {
		_ = h.attachments.DeleteFile(img.StoragePath)
	}
	writeJSON(c, http.StatusOK, map[string]any{"deleted": true, "id": id})
}

// ─── helpers ────────────────────────────────────────────────────────────

func (h *Handler) health(_ context.Context, c *app.RequestContext) {
	writeJSON(c, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) optionalAgent(ctx context.Context, c *app.RequestContext) (*model.Agent, bool) {
	raw := strings.TrimSpace(string(c.Request.Header.Peek("Authorization")))
	if raw == "" {
		return nil, true
	}
	token, err := parseBearerToken(raw)
	if err != nil {
		writeError(c, http.StatusUnauthorized, err)
		return nil, false
	}
	agent, err := h.svc.ResolveAgentToken(ctx, token)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(c, http.StatusUnauthorized, errors.New("invalid agent token"))
			return nil, false
		}
		writeServiceError(c, err)
		return nil, false
	}
	return agent, true
}

func (h *Handler) requireAgent(ctx context.Context, c *app.RequestContext) (*model.Agent, bool) {
	agent, ok := h.optionalAgent(ctx, c)
	if !ok {
		return nil, false
	}
	if agent == nil {
		writeError(c, http.StatusUnauthorized, errors.New("agent token required: run taskline register --name <agent>"))
		return nil, false
	}
	return agent, true
}

func parseBearerToken(raw string) (string, error) {
	parts := strings.Fields(raw)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return "", errors.New("invalid authorization header: expected Bearer token")
	}
	return parts[1], nil
}

func decodeJSON(c *app.RequestContext, dst any) error {
	body := c.Request.Body()
	if len(body) == 0 {
		return nil
	}
	return json.Unmarshal(body, dst)
}

func writeJSON(c *app.RequestContext, status int, body any) {
	c.SetStatusCode(status)
	c.Response.Header.Set("Content-Type", "application/json")
	enc, err := json.Marshal(body)
	if err != nil {
		c.SetStatusCode(http.StatusInternalServerError)
		c.WriteString(`{"error":"json marshal failed"}`)
		return
	}
	c.Write(enc)
}

func writeError(c *app.RequestContext, status int, err error) {
	writeJSON(c, status, map[string]any{"error": err.Error()})
}

func parseBoolQueryDefaultFalse(raw string) (bool, error) {
	if raw == "" {
		return false, nil
	}
	return parseBoolQuery(raw)
}

func queryLabels(c *app.RequestContext) []string {
	raw := c.QueryArgs().PeekAll("label")
	labels := make([]string, 0, len(raw))
	for _, label := range raw {
		labels = append(labels, string(label))
	}
	return labels
}

func parseBoolQuery(raw string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true, nil
	case "0", "false", "no", "off":
		return false, nil
	default:
		return false, fmt.Errorf("invalid boolean query value %q", raw)
	}
}

func parseLease(raw string) (time.Duration, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("invalid lease duration %q", raw)
	}
	if d < time.Millisecond {
		return 0, errors.New("lease must be positive")
	}
	return d, nil
}

// writeServiceError maps service-layer errors to HTTP statuses.
func writeServiceError(c *app.RequestContext, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(c, http.StatusNotFound, err)
	case errors.Is(err, store.ErrConflict):
		writeError(c, http.StatusConflict, err)
	case errors.Is(err, service.ErrStateEntryBlocked):
		writeError(c, http.StatusConflict, err)
	case errors.Is(err, service.ErrStateEntryVerificationUnavailable):
		writeError(c, http.StatusServiceUnavailable, err)
	default:
		writeError(c, http.StatusBadRequest, err)
	}
}
