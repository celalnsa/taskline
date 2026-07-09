package client_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"cli.taskline.dev/client"
)

func TestDocClientLifecycle(t *testing.T) {
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.String())
		w.Header().Set("Content-Type", "application/json")

		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/tasks/task-one/docs":
			var in client.CreateDocInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Fatalf("decode create doc input: %v", err)
			}
			if in.Title != "Spec" || in.Content != "# Product design" {
				t.Fatalf("unexpected create doc input: %#v", in)
			}
			_ = json.NewEncoder(w).Encode(client.Doc{
				ID: "doc-one", TaskID: "task-one", Title: in.Title,
				URL: "/api/v1/docs/doc-one/content", Content: in.Content,
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/docs/doc-one":
			_ = json.NewEncoder(w).Encode(client.Doc{
				ID: "doc-one", TaskID: "task-one", Title: "Spec",
				URL: "/api/v1/docs/doc-one/content", Content: "# Product design",
			})
		case r.Method == http.MethodPatch && r.URL.Path == "/api/v1/docs/doc-one":
			var in client.UpdateDocInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Fatalf("decode update doc input: %v", err)
			}
			if in.Title == nil || in.Content == nil {
				t.Fatalf("update doc input should include title and content: %#v", in)
			}
			if *in.Title != "Test report" || *in.Content != "# Tests" {
				t.Fatalf("unexpected update doc input: %#v", in)
			}
			_ = json.NewEncoder(w).Encode(client.Doc{
				ID: "doc-one", TaskID: "task-one", Title: *in.Title,
				URL: "/api/v1/docs/doc-one/content", Content: *in.Content,
			})
		case r.Method == http.MethodDelete && r.URL.Path == "/api/v1/docs/doc-one":
			_ = json.NewEncoder(w).Encode(map[string]any{"deleted": true, "id": "doc-one"})
		default:
			http.Error(w, "unexpected "+r.Method+" "+r.URL.String(), http.StatusTeapot)
		}
	}))
	defer srv.Close()

	c := client.New(srv.URL)
	created, err := c.CreateDoc("task-one", client.CreateDocInput{
		Title:   "Spec",
		Content: "# Product design",
	})
	if err != nil {
		t.Fatalf("CreateDoc: %v", err)
	}
	if created.ID != "doc-one" || created.URL != "/api/v1/docs/doc-one/content" || created.Content != "# Product design" {
		t.Fatalf("unexpected created doc: %#v", created)
	}

	fetched, err := c.GetDoc("doc-one")
	if err != nil {
		t.Fatalf("GetDoc: %v", err)
	}
	if fetched.Title != "Spec" || fetched.Content != "# Product design" {
		t.Fatalf("unexpected fetched doc: %#v", fetched)
	}

	title := "Test report"
	content := "# Tests"
	updated, err := c.UpdateDoc("doc-one", client.UpdateDocInput{
		Title:   &title,
		Content: &content,
	})
	if err != nil {
		t.Fatalf("UpdateDoc: %v", err)
	}
	if updated.Title != title || updated.Content != content {
		t.Fatalf("unexpected updated doc: %#v", updated)
	}

	if err := c.DeleteDoc("doc-one"); err != nil {
		t.Fatalf("DeleteDoc: %v", err)
	}
	want := []string{
		"POST /api/v1/tasks/task-one/docs",
		"GET /api/v1/docs/doc-one",
		"PATCH /api/v1/docs/doc-one",
		"DELETE /api/v1/docs/doc-one",
	}
	if len(seen) != len(want) {
		t.Fatalf("seen paths = %#v, want %#v", seen, want)
	}
	for i := range want {
		if seen[i] != want[i] {
			t.Fatalf("seen paths = %#v, want %#v", seen, want)
		}
	}
}

func TestTaskLabelsClientPayloads(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/projects/demo/tasks":
			var in client.CreateTaskInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Fatalf("decode create task input: %v", err)
			}
			if len(in.Labels) != 2 || in.Labels[0] != "backend" || in.Labels[1] != "ui" {
				t.Fatalf("unexpected create labels: %#v", in.Labels)
			}
			_ = json.NewEncoder(w).Encode(client.Task{
				ID: "task-one", ProjectID: "project-one", Title: in.Title, Type: "feature",
				State: "start", Labels: in.Labels,
			})
		case r.Method == http.MethodPatch && r.URL.Path == "/api/v1/tasks/task-one":
			var in client.UpdateTaskInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Fatalf("decode update task input: %v", err)
			}
			if in.Labels == nil || len(*in.Labels) != 1 || (*in.Labels)[0] != "review" {
				t.Fatalf("unexpected update labels: %#v", in.Labels)
			}
			_ = json.NewEncoder(w).Encode(client.Task{
				ID: "task-one", ProjectID: "project-one", Title: "labeled", Type: "feature",
				State: "start", Labels: *in.Labels,
			})
		default:
			http.Error(w, "unexpected "+r.Method+" "+r.URL.String(), http.StatusTeapot)
		}
	}))
	defer srv.Close()

	c := client.New(srv.URL)
	created, err := c.CreateTask("demo", client.CreateTaskInput{
		Title:  "labeled",
		Type:   "feature",
		Labels: []string{"backend", "ui"},
	})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	if len(created.Labels) != 2 || created.Labels[0] != "backend" || created.Labels[1] != "ui" {
		t.Fatalf("unexpected created labels: %#v", created.Labels)
	}

	labels := []string{"review"}
	updated, err := c.UpdateTask("task-one", client.UpdateTaskInput{Labels: &labels})
	if err != nil {
		t.Fatalf("UpdateTask: %v", err)
	}
	if len(updated.Labels) != 1 || updated.Labels[0] != "review" {
		t.Fatalf("unexpected updated labels: %#v", updated.Labels)
	}
}

func TestSearchTasksClientEncodesQueryAndLimit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/projects/demo/tasks/search" {
			http.Error(w, "unexpected "+r.Method+" "+r.URL.String(), http.StatusTeapot)
			return
		}
		if got := r.URL.Query().Get("q"); got != "fc7a0732 hooks" {
			t.Fatalf("q = %q", got)
		}
		if got := r.URL.Query().Get("limit"); got != "7" {
			t.Fatalf("limit = %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tasks": []client.Task{{
				ID:        "fc7a0732-0000-4000-8000-000000000000",
				ProjectID: "project-one",
				Title:     "Found task",
				Type:      "feature",
				State:     "start",
			}},
		})
	}))
	defer srv.Close()

	c := client.New(srv.URL)
	tasks, err := c.SearchTasks("demo", "fc7a0732 hooks", 7)
	if err != nil {
		t.Fatalf("SearchTasks: %v", err)
	}
	if len(tasks) != 1 || tasks[0].Title != "Found task" {
		t.Fatalf("unexpected search results: %#v", tasks)
	}
}

func TestTaskClaimClientPayloads(t *testing.T) {
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.String())
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/projects/demo/tasks/next":
			q := r.URL.Query()
			if q.Get("claim") != "true" || q.Get("owner") != "agent-a" || q.Get("lease") != "30m" {
				t.Fatalf("unexpected next claim query: %s", r.URL.RawQuery)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"task": client.Task{
				ID: "task-one", ProjectID: "project-one", Title: "claimed", Type: "feature",
				State: "start", Owner: "agent-a", ClaimedAt: 1000, LeaseExpiresAt: 2000,
			}})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/tasks/task-one/claim":
			var in client.ClaimTaskInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Fatalf("decode claim input: %v", err)
			}
			if in.Owner != "agent-b" || in.Lease != "2h" {
				t.Fatalf("unexpected claim input: %#v", in)
			}
			_ = json.NewEncoder(w).Encode(client.Task{ID: "task-one", Owner: in.Owner})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/tasks/task-one/heartbeat":
			var in client.HeartbeatTaskInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Fatalf("decode heartbeat input: %v", err)
			}
			if in.Owner != "agent-b" || in.Lease != "3h" {
				t.Fatalf("unexpected heartbeat input: %#v", in)
			}
			_ = json.NewEncoder(w).Encode(client.Task{ID: "task-one", Owner: in.Owner})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/tasks/task-one/release":
			var in client.ReleaseTaskInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Fatalf("decode release input: %v", err)
			}
			if in.Owner != "agent-b" || !in.Force {
				t.Fatalf("unexpected release input: %#v", in)
			}
			_ = json.NewEncoder(w).Encode(client.Task{ID: "task-one"})
		case r.Method == http.MethodPatch && r.URL.Path == "/api/v1/tasks/task-one":
			var in client.UpdateTaskInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Fatalf("decode update input: %v", err)
			}
			if in.IfState == nil || *in.IfState != "start" || in.Owner != "agent-b" || !in.Force {
				t.Fatalf("unexpected update input: %#v", in)
			}
			_ = json.NewEncoder(w).Encode(client.Task{ID: "task-one", State: "done"})
		default:
			http.Error(w, "unexpected "+r.Method+" "+r.URL.String(), http.StatusTeapot)
		}
	}))
	defer srv.Close()

	c := client.New(srv.URL)
	next, err := c.NextRunnableTask("demo", client.NextTaskOptions{Claim: true, Owner: "agent-a", Lease: "30m"})
	if err != nil {
		t.Fatalf("NextRunnableTask claim: %v", err)
	}
	if next == nil || next.Owner != "agent-a" || next.ClaimedAt != 1000 || next.LeaseExpiresAt != 2000 {
		t.Fatalf("unexpected next claim task: %#v", next)
	}
	if _, err := c.ClaimTask("task-one", client.ClaimTaskInput{Owner: "agent-b", Lease: "2h"}); err != nil {
		t.Fatalf("ClaimTask: %v", err)
	}
	if _, err := c.HeartbeatTask("task-one", client.HeartbeatTaskInput{Owner: "agent-b", Lease: "3h"}); err != nil {
		t.Fatalf("HeartbeatTask: %v", err)
	}
	if _, err := c.ReleaseTask("task-one", client.ReleaseTaskInput{Owner: "agent-b", Force: true}); err != nil {
		t.Fatalf("ReleaseTask: %v", err)
	}
	ifState := "start"
	if _, err := c.UpdateTask("task-one", client.UpdateTaskInput{IfState: &ifState, Owner: "agent-b", Force: true}); err != nil {
		t.Fatalf("UpdateTask: %v", err)
	}

	want := []string{
		"GET /api/v1/projects/demo/tasks/next?claim=true&lease=30m&owner=agent-a",
		"POST /api/v1/tasks/task-one/claim",
		"POST /api/v1/tasks/task-one/heartbeat",
		"POST /api/v1/tasks/task-one/release",
		"PATCH /api/v1/tasks/task-one",
	}
	if len(seen) != len(want) {
		t.Fatalf("seen paths = %#v, want %#v", seen, want)
	}
	for i := range want {
		if seen[i] != want[i] {
			t.Fatalf("seen paths = %#v, want %#v", seen, want)
		}
	}
}
