package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Client is a thin HTTP wrapper for taskline-server.
type Client struct {
	BaseURL string
	HTTP    *http.Client
}

// New constructs a Client targeting baseURL.
func New(baseURL string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTP:    &http.Client{Timeout: 30 * time.Second},
	}
}

// Project mirrors the server-side project shape.
type Project struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   int64  `json:"created_at"`
	UpdatedAt   int64  `json:"updated_at"`
}

// Task mirrors the server-side task shape.
type Task struct {
	ID          string   `json:"id"`
	ProjectID   string   `json:"project_id"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Type        string   `json:"type"`
	State       string   `json:"state"`
	Priority    int      `json:"priority"`
	DependsOn   []string `json:"depends_on,omitempty"`
	Images      []Image  `json:"images,omitempty"`
	CreatedAt   int64    `json:"created_at"`
	UpdatedAt   int64    `json:"updated_at"`
}

// Image is an attachment record.
type Image struct {
	ID         string `json:"id"`
	TaskID     string `json:"task_id"`
	Filename   string `json:"filename"`
	MimeType   string `json:"mime_type"`
	SizeBytes  int64  `json:"size_bytes"`
	UploadedAt int64  `json:"uploaded_at"`
}

// ─── Project endpoints ──────────────────────────────────────────────────

type CreateProjectInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (c *Client) CreateProject(in CreateProjectInput) (*Project, error) {
	var out Project
	if err := c.do("POST", "/api/v1/projects", in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type listProjectsResp struct {
	Projects []Project `json:"projects"`
}

func (c *Client) ListProjects() ([]Project, error) {
	var out listProjectsResp
	if err := c.do("GET", "/api/v1/projects", nil, &out); err != nil {
		return nil, err
	}
	return out.Projects, nil
}

// ─── Task endpoints ─────────────────────────────────────────────────────

type CreateTaskInput struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Type        string `json:"type"`
	Priority    int    `json:"priority"`
	// AutoStart, when true, creates the task directly in 'start' rather
	// than 'pending'. Omitted = pending (the server default).
	AutoStart *bool `json:"auto_start,omitempty"`
}

func (c *Client) CreateTask(projectIDOrName string, in CreateTaskInput) (*Task, error) {
	var out Task
	path := fmt.Sprintf("/api/v1/projects/%s/tasks", url.PathEscape(projectIDOrName))
	if err := c.do("POST", path, in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type listTasksResp struct {
	Tasks []Task `json:"tasks"`
}

func (c *Client) ListTasks(projectIDOrName string, states []string) ([]Task, error) {
	path := fmt.Sprintf("/api/v1/projects/%s/tasks", url.PathEscape(projectIDOrName))
	if len(states) > 0 {
		q := url.Values{}
		q.Set("state", strings.Join(states, ","))
		path += "?" + q.Encode()
	}
	var out listTasksResp
	if err := c.do("GET", path, nil, &out); err != nil {
		return nil, err
	}
	return out.Tasks, nil
}

func (c *Client) ListRunnableTasks(projectIDOrName string) ([]Task, error) {
	path := fmt.Sprintf("/api/v1/projects/%s/tasks/runnable", url.PathEscape(projectIDOrName))
	var out listTasksResp
	if err := c.do("GET", path, nil, &out); err != nil {
		return nil, err
	}
	return out.Tasks, nil
}

type nextTaskResp struct {
	Task *Task `json:"task"`
}

// NextRunnableTask returns the highest-priority runnable task or nil if none.
func (c *Client) NextRunnableTask(projectIDOrName string) (*Task, error) {
	path := fmt.Sprintf("/api/v1/projects/%s/tasks/next", url.PathEscape(projectIDOrName))
	var out nextTaskResp
	if err := c.do("GET", path, nil, &out); err != nil {
		return nil, err
	}
	return out.Task, nil
}

func (c *Client) GetTask(id string) (*Task, error) {
	var out Task
	path := fmt.Sprintf("/api/v1/tasks/%s", url.PathEscape(id))
	if err := c.do("GET", path, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type UpdateTaskInput struct {
	Title       *string `json:"title,omitempty"`
	Description *string `json:"description,omitempty"`
	Type        *string `json:"type,omitempty"`
	State       *string `json:"state,omitempty"`
	Priority    *int    `json:"priority,omitempty"`
}

func (c *Client) UpdateTask(id string, in UpdateTaskInput) (*Task, error) {
	var out Task
	path := fmt.Sprintf("/api/v1/tasks/%s", url.PathEscape(id))
	if err := c.do("PATCH", path, in, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteTask(id string) error {
	path := fmt.Sprintf("/api/v1/tasks/%s", url.PathEscape(id))
	return c.do("DELETE", path, nil, nil)
}

type addDepReq struct {
	DependsOn string `json:"depends_on"`
}

func (c *Client) AddDependency(taskID, dependsOnID string) error {
	path := fmt.Sprintf("/api/v1/tasks/%s/deps", url.PathEscape(taskID))
	return c.do("POST", path, addDepReq{DependsOn: dependsOnID}, nil)
}

func (c *Client) UploadImage(taskID, filePath string) (*Image, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("file", filepath.Base(filePath))
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(fw, f); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}

	path := fmt.Sprintf("%s/api/v1/tasks/%s/images", c.BaseURL, url.PathEscape(taskID))
	req, err := http.NewRequest("POST", path, &body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, decodeServerError(resp)
	}
	var out Image
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ─── plumbing ───────────────────────────────────────────────────────────

func (c *Client) do(method, path string, in any, out any) error {
	var body io.Reader
	if in != nil {
		raw, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, c.BaseURL+path, body)
	if err != nil {
		return err
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return decodeServerError(resp)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

type errResp struct {
	Error string `json:"error"`
}

func decodeServerError(resp *http.Response) error {
	raw, _ := io.ReadAll(resp.Body)
	var e errResp
	if json.Unmarshal(raw, &e) == nil && e.Error != "" {
		return fmt.Errorf("taskline %d: %s", resp.StatusCode, e.Error)
	}
	if msg := strings.TrimSpace(string(raw)); msg != "" {
		return fmt.Errorf("taskline %d: %s", resp.StatusCode, msg)
	}
	return fmt.Errorf("taskline %d: %s", resp.StatusCode, http.StatusText(resp.StatusCode))
}
