package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/stretchr/testify/require"

	"taskline_server/api/handler"
	"taskline_server/internal/config"
	"taskline_server/internal/service"
	"taskline_server/internal/store"
)

// startServer boots a taskline-server instance backed by a temp SQLite file +
// random port. Returns the base URL and a shutdown func.
func startServer(t *testing.T) (string, func()) {
	t.Helper()
	tmp := t.TempDir()
	dbPath := filepath.Join(tmp, "taskline.db")
	imagesDir := filepath.Join(tmp, "images")
	require.NoError(t, os.MkdirAll(imagesDir, 0o700))

	st, err := store.New(dbPath)
	require.NoError(t, err)
	svc := service.New(st)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := ln.Addr().String()
	require.NoError(t, ln.Close())

	cfg := &config.Config{DBPath: dbPath, ListenAddr: addr, ImagesDir: imagesDir}
	h := handler.New(svc, cfg)

	hz := server.New(server.WithHostPorts(addr))
	h.Register(hz)
	go hz.Spin()

	base := "http://" + addr
	// Poll /healthz until the listener is accepting.
	deadline := time.Now().Add(5 * time.Second)
	for {
		resp, err := http.Get(base + "/healthz")
		if err == nil {
			resp.Body.Close()
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("server did not become ready: %v", err)
		}
		time.Sleep(50 * time.Millisecond)
	}
	return base, func() {
		_ = hz.Shutdown(context.Background())
		_ = st.Close()
	}
}

// jsonReq performs a single JSON request, decoding into out (nil to skip).
// Returns the HTTP status so callers can assert on it.
func jsonReq(t *testing.T, method, url string, body any, out any) int {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		require.NoError(t, err)
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, url, rdr)
	require.NoError(t, err)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if out != nil && len(raw) > 0 && resp.StatusCode < 400 {
		require.NoError(t, json.Unmarshal(raw, out), "decode body: %s", string(raw))
	}
	return resp.StatusCode
}

type project struct {
	ID, Name, Description string
}

type task struct {
	ID, ProjectID, Title, Description, Type, State string
	Priority                                       int
	DependsOn                                      []string `json:"depends_on,omitempty"`
}

type taskListResp struct {
	Tasks []task `json:"tasks"`
}

type nextResp struct {
	Task *task `json:"task"`
}

func TestEndToEndHappyPath(t *testing.T) {
	base, stop := startServer(t)
	defer stop()

	// Create project.
	var p project
	st := jsonReq(t, "POST", base+"/api/v1/projects",
		map[string]any{"name": "demo", "description": "e2e"}, &p)
	require.Equal(t, http.StatusCreated, st)
	require.Equal(t, "demo", p.Name)

	// Two tasks created with auto_start=true so they're immediately
	// runnable. t2 depends on t1 but has higher priority.
	var t1, t2 task
	st = jsonReq(t, "POST", base+"/api/v1/projects/demo/tasks",
		map[string]any{"title": "first", "type": "feature", "priority": 1, "auto_start": true}, &t1)
	require.Equal(t, http.StatusCreated, st)
	require.Equal(t, "start", t1.State)
	st = jsonReq(t, "POST", base+"/api/v1/projects/demo/tasks",
		map[string]any{"title": "second", "type": "bug", "priority": 9, "auto_start": true}, &t2)
	require.Equal(t, http.StatusCreated, st)

	// Add dependency.
	st = jsonReq(t, "POST", base+"/api/v1/tasks/"+t2.ID+"/deps",
		map[string]any{"depends_on": t1.ID}, nil)
	require.Equal(t, http.StatusCreated, st)

	// Initially only t1 is runnable (t2 blocked even though prio is higher).
	var runnable taskListResp
	st = jsonReq(t, "GET", base+"/api/v1/projects/demo/tasks/runnable", nil, &runnable)
	require.Equal(t, http.StatusOK, st)
	require.Len(t, runnable.Tasks, 1)
	require.Equal(t, t1.ID, runnable.Tasks[0].ID)

	// `next` returns the same.
	var nx nextResp
	st = jsonReq(t, "GET", base+"/api/v1/projects/demo/tasks/next", nil, &nx)
	require.Equal(t, http.StatusOK, st)
	require.NotNil(t, nx.Task)
	require.Equal(t, t1.ID, nx.Task.ID)

	// Mark t1 done → t2 unblocks and outranks because of priority.
	var updated task
	st = jsonReq(t, "PATCH", base+"/api/v1/tasks/"+t1.ID,
		map[string]any{"state": "done"}, &updated)
	require.Equal(t, http.StatusOK, st)

	st = jsonReq(t, "GET", base+"/api/v1/projects/demo/tasks/runnable", nil, &runnable)
	require.Equal(t, http.StatusOK, st)
	require.Len(t, runnable.Tasks, 1)
	require.Equal(t, t2.ID, runnable.Tasks[0].ID)

	// State filter — t2 stayed in `start`; t1 was advanced to `done`.
	var startOnly taskListResp
	st = jsonReq(t, "GET", base+"/api/v1/projects/demo/tasks?state=start", nil, &startOnly)
	require.Equal(t, http.StatusOK, st)
	require.Len(t, startOnly.Tasks, 1)
	require.Equal(t, t2.ID, startOnly.Tasks[0].ID)

	// Description update + delete.
	st = jsonReq(t, "PATCH", base+"/api/v1/tasks/"+t2.ID,
		map[string]any{"description": "updated"}, &updated)
	require.Equal(t, http.StatusOK, st)
	require.Equal(t, "updated", updated.Description)

	st = jsonReq(t, "DELETE", base+"/api/v1/tasks/"+t2.ID, nil, nil)
	require.Equal(t, http.StatusOK, st)

	var allTasks taskListResp
	st = jsonReq(t, "GET", base+"/api/v1/projects/demo/tasks", nil, &allTasks)
	require.Equal(t, http.StatusOK, st)
	require.Len(t, allTasks.Tasks, 1)
	require.Equal(t, t1.ID, allTasks.Tasks[0].ID)
}

func TestImageUploadEndToEnd(t *testing.T) {
	base, stop := startServer(t)
	defer stop()

	var p project
	jsonReq(t, "POST", base+"/api/v1/projects",
		map[string]any{"name": "imgproj"}, &p)
	var tk task
	jsonReq(t, "POST", base+"/api/v1/projects/imgproj/tasks",
		map[string]any{"title": "with image", "type": "feature"}, &tk)

	tmp := t.TempDir()
	fp := filepath.Join(tmp, "hello.txt")
	require.NoError(t, os.WriteFile(fp, []byte("hello world"), 0o644))

	// Multipart upload.
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("file", "hello.txt")
	require.NoError(t, err)
	_, err = fw.Write([]byte("hello world"))
	require.NoError(t, err)
	require.NoError(t, w.Close())

	req, err := http.NewRequest("POST", base+"/api/v1/tasks/"+tk.ID+"/images", &body)
	require.NoError(t, err)
	req.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	raw, _ := io.ReadAll(resp.Body)
	require.True(t, strings.Contains(string(raw), "hello.txt"))

	// Re-fetch the task — image should be attached.
	var got task
	jsonReq(t, "GET", base+"/api/v1/tasks/"+tk.ID, nil, &got)
	// Note: task struct ignores images, but verify via raw GET shape.
	resp2, err := http.Get(base + "/api/v1/tasks/" + tk.ID)
	require.NoError(t, err)
	defer resp2.Body.Close()
	rawTask, _ := io.ReadAll(resp2.Body)
	require.True(t, strings.Contains(string(rawTask), "hello.txt"),
		"task json should include attached image filename: %s", string(rawTask))
}

func TestCycleProtectionViaHTTP(t *testing.T) {
	base, stop := startServer(t)
	defer stop()
	jsonReq(t, "POST", base+"/api/v1/projects", map[string]any{"name": "cyc"}, &project{})
	var a, b task
	jsonReq(t, "POST", base+"/api/v1/projects/cyc/tasks",
		map[string]any{"title": "a", "type": "feature"}, &a)
	jsonReq(t, "POST", base+"/api/v1/projects/cyc/tasks",
		map[string]any{"title": "b", "type": "feature"}, &b)

	// b -> a is fine.
	st := jsonReq(t, "POST", base+"/api/v1/tasks/"+b.ID+"/deps",
		map[string]any{"depends_on": a.ID}, nil)
	require.Equal(t, http.StatusCreated, st)

	// a -> b would close a cycle. Service maps store.ErrConflict to 409.
	st = jsonReq(t, "POST", base+"/api/v1/tasks/"+a.ID+"/deps",
		map[string]any{"depends_on": b.ID}, nil)
	require.Equal(t, http.StatusConflict, st)
}

func TestStateTransitionAtAPI(t *testing.T) {
	base, stop := startServer(t)
	defer stop()
	jsonReq(t, "POST", base+"/api/v1/projects", map[string]any{"name": "states"}, &project{})
	var tk task
	jsonReq(t, "POST", base+"/api/v1/projects/states/tasks",
		map[string]any{"title": "x", "type": "feature"}, &tk)

	// Forward jump.
	st := jsonReq(t, "PATCH", base+"/api/v1/tasks/"+tk.ID,
		map[string]any{"state": "review"}, &tk)
	require.Equal(t, http.StatusOK, st)
	require.Equal(t, "review", tk.State)

	// Backward move — accepted (workflow is no longer forward-only).
	st = jsonReq(t, "PATCH", base+"/api/v1/tasks/"+tk.ID,
		map[string]any{"state": "dev"}, &tk)
	require.Equal(t, http.StatusOK, st)
	require.Equal(t, "dev", tk.State)

	// Retired state — must be rejected as invalid.
	st = jsonReq(t, "PATCH", base+"/api/v1/tasks/"+tk.ID,
		map[string]any{"state": "test"}, nil)
	require.Equal(t, http.StatusBadRequest, st)
}

func TestAutoStartDefaultsToPendingAndExcludesFromRunnable(t *testing.T) {
	base, stop := startServer(t)
	defer stop()
	jsonReq(t, "POST", base+"/api/v1/projects", map[string]any{"name": "parked"}, &project{})

	// Omitted auto_start → server parks the task in `pending`.
	var parked task
	st := jsonReq(t, "POST", base+"/api/v1/projects/parked/tasks",
		map[string]any{"title": "later", "type": "feature"}, &parked)
	require.Equal(t, http.StatusCreated, st)
	require.Equal(t, "pending", parked.State)

	// Runnable list must skip it; `task next` must return null.
	var rs taskListResp
	jsonReq(t, "GET", base+"/api/v1/projects/parked/tasks/runnable", nil, &rs)
	require.Len(t, rs.Tasks, 0)
	var nx nextResp
	jsonReq(t, "GET", base+"/api/v1/projects/parked/tasks/next", nil, &nx)
	require.Nil(t, nx.Task)

	// auto_start=true short-circuits the parking lot.
	var hot task
	jsonReq(t, "POST", base+"/api/v1/projects/parked/tasks",
		map[string]any{"title": "now", "type": "feature", "auto_start": true}, &hot)
	require.Equal(t, "start", hot.State)
	jsonReq(t, "GET", base+"/api/v1/projects/parked/tasks/runnable", nil, &rs)
	require.Len(t, rs.Tasks, 1)
	require.Equal(t, hot.ID, rs.Tasks[0].ID)

	// Promoting `parked` into a runnable state unblocks it too.
	jsonReq(t, "PATCH", base+"/api/v1/tasks/"+parked.ID, map[string]any{"state": "design"}, &parked)
	jsonReq(t, "GET", base+"/api/v1/projects/parked/tasks/runnable", nil, &rs)
	require.Len(t, rs.Tasks, 2)

	// And dropping a runnable task back into pending re-parks it.
	jsonReq(t, "PATCH", base+"/api/v1/tasks/"+hot.ID, map[string]any{"state": "pending"}, &hot)
	require.Equal(t, "pending", hot.State)
	jsonReq(t, "GET", base+"/api/v1/projects/parked/tasks/runnable", nil, &rs)
	require.Len(t, rs.Tasks, 1)
	require.Equal(t, parked.ID, rs.Tasks[0].ID)
}

// Sanity: status code for unknown project.
func TestUnknownProjectIs404(t *testing.T) {
	base, stop := startServer(t)
	defer stop()
	st := jsonReq(t, "POST", base+"/api/v1/projects/no-such/tasks",
		map[string]any{"title": "x", "type": "feature"}, nil)
	require.Equal(t, http.StatusNotFound, st)
}

func init() {
	// Quiet Hertz banner on test stdout; failures still print stack traces.
	_ = fmt.Sprintln
}
