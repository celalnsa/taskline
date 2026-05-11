package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/google/uuid"

	"taskline_server/api/model"
	"taskline_server/internal/config"
	"taskline_server/internal/service"
	"taskline_server/internal/store"
	webfs "taskline_server/web"
)

// Handler wires HTTP routes to the service layer.
type Handler struct {
	svc  *service.Service
	cfg  *config.Config
	uiFS fs.FS // populated by Register when an embedded/external UI is found
}

func New(svc *service.Service, cfg *config.Config) *Handler {
	return &Handler{svc: svc, cfg: cfg}
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
	v1.POST("/projects", h.createProject)
	v1.GET("/projects", h.listProjects)

	v1.POST("/projects/:project/tasks", h.createTask)
	v1.GET("/projects/:project/tasks", h.listTasks)
	v1.GET("/projects/:project/tasks/runnable", h.listRunnableTasks)
	v1.GET("/projects/:project/tasks/next", h.nextRunnableTask)

	v1.GET("/tasks/:id", h.getTask)
	v1.PATCH("/tasks/:id", h.updateTask)
	v1.DELETE("/tasks/:id", h.deleteTask)
	v1.POST("/tasks/:id/deps", h.addDependency)
	v1.POST("/tasks/:id/images", h.uploadImage)
	v1.POST("/tasks/:id/links", h.addLink)
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
	Title       string `json:"title"`
	Description string `json:"description"`
	Type        string `json:"type"`
	Priority    int    `json:"priority"`
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
	t, err := h.svc.CreateTask(ctx, project, req.Title, req.Description, model.TaskType(req.Type), req.Priority, autoStart)
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
	ts, err := h.svc.ListTasks(ctx, project, states)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, map[string]any{"tasks": ts})
}

func (h *Handler) listRunnableTasks(ctx context.Context, c *app.RequestContext) {
	project := c.Param("project")
	ts, err := h.svc.ListRunnableTasks(ctx, project)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, map[string]any{"tasks": ts})
}

func (h *Handler) nextRunnableTask(ctx context.Context, c *app.RequestContext) {
	project := c.Param("project")
	t, err := h.svc.NextRunnableTask(ctx, project)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	if t == nil {
		writeJSON(c, http.StatusOK, map[string]any{"task": nil})
		return
	}
	writeJSON(c, http.StatusOK, map[string]any{"task": t})
}

func (h *Handler) getTask(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	t, err := h.svc.GetTask(ctx, id)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	writeJSON(c, http.StatusOK, t)
}

type updateTaskReq struct {
	Title       *string `json:"title,omitempty"`
	Description *string `json:"description,omitempty"`
	Type        *string `json:"type,omitempty"`
	State       *string `json:"state,omitempty"`
	Priority    *int    `json:"priority,omitempty"`
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
	t, err := h.svc.UpdateTask(ctx, id, u)
	if err != nil {
		writeServiceError(c, err)
		return
	}
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
	saved, err := h.saveUpload(id, fh)
	if err != nil {
		writeError(c, http.StatusInternalServerError, err)
		return
	}
	if err := h.svc.AddImage(ctx, saved); err != nil {
		// Roll back the file on DB failure.
		_ = os.Remove(saved.StoragePath)
		writeServiceError(c, err)
		return
	}
	writeJSON(c, http.StatusCreated, saved)
}

// ─── helpers ────────────────────────────────────────────────────────────

func (h *Handler) health(_ context.Context, c *app.RequestContext) {
	writeJSON(c, http.StatusOK, map[string]any{"ok": true})
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

// writeServiceError maps service-layer errors to HTTP statuses.
func writeServiceError(c *app.RequestContext, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(c, http.StatusNotFound, err)
	case errors.Is(err, store.ErrConflict):
		writeError(c, http.StatusConflict, err)
	default:
		writeError(c, http.StatusBadRequest, err)
	}
}

func (h *Handler) saveUpload(taskID string, fh *multipart.FileHeader) (*model.Image, error) {
	src, err := fh.Open()
	if err != nil {
		return nil, err
	}
	defer src.Close()

	taskDir := filepath.Join(h.cfg.ImagesDir, taskID)
	if err := os.MkdirAll(taskDir, 0o700); err != nil {
		return nil, err
	}
	imgID := uuid.NewString()
	ext := filepath.Ext(fh.Filename)
	storagePath := filepath.Join(taskDir, imgID+ext)
	dst, err := os.Create(storagePath)
	if err != nil {
		return nil, err
	}
	written, err := io.Copy(dst, src)
	cerr := dst.Close()
	if err != nil {
		_ = os.Remove(storagePath)
		return nil, err
	}
	if cerr != nil {
		_ = os.Remove(storagePath)
		return nil, cerr
	}

	mime := "application/octet-stream"
	if v := fh.Header.Get("Content-Type"); v != "" {
		mime = v
	}
	return &model.Image{
		ID:          imgID,
		TaskID:      taskID,
		Filename:    fh.Filename,
		MimeType:    mime,
		SizeBytes:   written,
		StoragePath: storagePath,
	}, nil
}
