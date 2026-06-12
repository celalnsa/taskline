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
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
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
	v1.GET("/projects/:project/tasks/search", h.searchTasks)
	v1.GET("/projects/:project/tasks/runnable", h.listRunnableTasks)
	v1.GET("/projects/:project/tasks/next", h.nextRunnableTask)

	v1.GET("/tasks/:id", h.getTask)
	v1.PATCH("/tasks/:id", h.updateTask)
	v1.DELETE("/tasks/:id", h.deleteTask)
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
	ts, err := h.svc.ListTasks(ctx, project, states)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	h.attachTaskImageURLs(ts...)
	h.attachTaskDocURLs(ts...)
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
	h.attachTaskImageURLs(ts...)
	h.attachTaskDocURLs(ts...)
	writeJSON(c, http.StatusOK, map[string]any{"tasks": ts})
}

func (h *Handler) listRunnableTasks(ctx context.Context, c *app.RequestContext) {
	project := c.Param("project")
	ts, err := h.svc.ListRunnableTasks(ctx, project)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	h.attachTaskImageURLs(ts...)
	h.attachTaskDocURLs(ts...)
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
	h.attachTaskImageURLs(t)
	h.attachTaskDocURLs(t)
	writeJSON(c, http.StatusOK, map[string]any{"task": t})
}

func (h *Handler) getTask(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	t, err := h.svc.GetTask(ctx, id)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	h.attachTaskImageURLs(t)
	h.attachTaskDocURLs(t)
	writeJSON(c, http.StatusOK, t)
}

type updateTaskReq struct {
	Title       *string   `json:"title,omitempty"`
	Description *string   `json:"description,omitempty"`
	Type        *string   `json:"type,omitempty"`
	State       *string   `json:"state,omitempty"`
	Priority    *int      `json:"priority,omitempty"`
	Labels      *[]string `json:"labels,omitempty"`
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
	if req.Labels != nil {
		u.Labels = req.Labels
	}
	t, err := h.svc.UpdateTask(ctx, id, u)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	h.attachTaskImageURLs(t)
	h.attachTaskDocURLs(t)
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
	doc, err := h.saveDoc(taskID, req.Title, req.Content)
	if err != nil {
		writeError(c, http.StatusInternalServerError, err)
		return
	}
	if err := h.svc.AddDoc(ctx, doc); err != nil {
		_ = os.Remove(doc.StoragePath)
		writeServiceError(c, err)
		return
	}
	doc.Content = req.Content
	h.attachDocURL(doc)
	writeJSON(c, http.StatusCreated, doc)
}

func (h *Handler) getDoc(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	doc, err := h.svc.GetDoc(ctx, id)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	content, err := h.readDocContent(doc)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	doc.Content = string(content)
	h.attachDocURL(doc)
	writeJSON(c, http.StatusOK, doc)
}

func (h *Handler) getDocContent(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	doc, err := h.svc.GetDoc(ctx, id)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	content, err := h.readDocContent(doc)
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
		tempPath, err = h.writeDocContentTemp(doc, *req.Content)
		if err != nil {
			writeError(c, http.StatusInternalServerError, err)
			return
		}
	}
	updated, err := h.svc.UpdateDoc(ctx, id, u)
	if err != nil {
		if tempPath != "" {
			_ = os.Remove(tempPath)
		}
		writeServiceError(c, err)
		return
	}
	if req.Content != nil {
		if err := os.Rename(tempPath, doc.StoragePath); err != nil {
			_ = os.Remove(tempPath)
			writeError(c, http.StatusInternalServerError, err)
			return
		}
		updated.Content = *req.Content
	} else if content, err := h.readDocContent(updated); err != nil {
		writeServiceError(c, err)
		return
	} else {
		updated.Content = string(content)
	}
	h.attachDocURL(updated)
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
		_ = os.Remove(doc.StoragePath)
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
	h.attachImageURL(saved)
	writeJSON(c, http.StatusCreated, saved)
}

func (h *Handler) getImage(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	img, err := h.svc.GetImage(ctx, id)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	if _, err := os.Stat(img.StoragePath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeServiceError(c, fmt.Errorf("%w: image file missing", store.ErrNotFound))
			return
		}
		writeError(c, http.StatusInternalServerError, err)
		return
	}
	contentType := img.MimeType
	if contentType == "" {
		contentType = mime.TypeByExtension(filepath.Ext(img.Filename))
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.SetStatusCode(http.StatusOK)
	c.Response.Header.Set("Content-Type", contentType)
	c.Response.Header.Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{
		"filename": img.Filename,
	}))
	c.File(img.StoragePath)
}

func (h *Handler) deleteImage(ctx context.Context, c *app.RequestContext) {
	id := c.Param("id")
	img, err := h.svc.DeleteImage(ctx, id)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	if img.StoragePath != "" {
		_ = os.Remove(img.StoragePath)
	}
	writeJSON(c, http.StatusOK, map[string]any{"deleted": true, "id": id})
}

// ─── helpers ────────────────────────────────────────────────────────────

func (h *Handler) health(_ context.Context, c *app.RequestContext) {
	writeJSON(c, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) attachTaskImageURLs(tasks ...*model.Task) {
	for _, task := range tasks {
		if task == nil {
			continue
		}
		for i := range task.Images {
			h.attachImageURL(&task.Images[i])
		}
	}
}

func (h *Handler) attachTaskDocURLs(tasks ...*model.Task) {
	for _, task := range tasks {
		if task == nil {
			continue
		}
		for i := range task.Docs {
			h.attachDocURL(&task.Docs[i])
		}
	}
}

func (h *Handler) attachImageURL(img *model.Image) {
	if img == nil || img.ID == "" {
		return
	}
	img.URL = "/api/v1/images/" + url.PathEscape(img.ID)
}

func (h *Handler) attachDocURL(doc *model.Doc) {
	if doc == nil || doc.ID == "" {
		return
	}
	doc.URL = "/api/v1/docs/" + url.PathEscape(doc.ID) + "/content"
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
	defer func() { _ = src.Close() }()

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

func (h *Handler) saveDoc(taskID, title, content string) (*model.Doc, error) {
	docID := uuid.NewString()
	taskDir := filepath.Join(h.cfg.DocsDir, taskID)
	if err := os.MkdirAll(taskDir, 0o700); err != nil {
		return nil, err
	}
	storagePath := filepath.Join(taskDir, docID+".md")
	if err := os.WriteFile(storagePath, []byte(content), 0o600); err != nil {
		return nil, err
	}
	return &model.Doc{
		ID:          docID,
		TaskID:      taskID,
		Title:       title,
		StoragePath: storagePath,
	}, nil
}

func (h *Handler) readDocContent(doc *model.Doc) ([]byte, error) {
	content, err := os.ReadFile(doc.StoragePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%w: doc file missing", store.ErrNotFound)
		}
		return nil, err
	}
	return content, nil
}

func (h *Handler) writeDocContentTemp(doc *model.Doc, content string) (string, error) {
	dir := filepath.Dir(doc.StoragePath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	temp, err := os.CreateTemp(dir, filepath.Base(doc.StoragePath)+".*.tmp")
	if err != nil {
		return "", err
	}
	tempPath := temp.Name()
	if _, err := temp.WriteString(content); err != nil {
		_ = temp.Close()
		_ = os.Remove(tempPath)
		return "", err
	}
	if err := temp.Close(); err != nil {
		_ = os.Remove(tempPath)
		return "", err
	}
	if err := os.Chmod(tempPath, 0o600); err != nil {
		_ = os.Remove(tempPath)
		return "", err
	}
	return tempPath, nil
}
