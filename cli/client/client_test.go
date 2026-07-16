package client_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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
	patchCount := 0
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
			patchCount++
			var in client.UpdateTaskInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Fatalf("decode update task input: %v", err)
			}
			if patchCount == 1 {
				if in.Labels == nil || len(*in.Labels) != 1 || (*in.Labels)[0] != "review" {
					t.Fatalf("unexpected update labels: %#v", in.Labels)
				}
			} else {
				if in.LabelOps == nil || len(in.LabelOps.Add) != 1 || in.LabelOps.Add[0] != "backend" || len(in.LabelOps.Remove) != 1 || in.LabelOps.Remove[0] != "triage" {
					t.Fatalf("unexpected label ops: %#v", in.LabelOps)
				}
				if in.DescriptionAppend == nil || *in.DescriptionAppend != "note" {
					t.Fatalf("unexpected description append: %#v", in.DescriptionAppend)
				}
			}
			_ = json.NewEncoder(w).Encode(client.Task{
				ID: "task-one", ProjectID: "project-one", Title: "labeled", Type: "feature",
				State: "start", Labels: []string{"review"},
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
	appendText := "note"
	updated, err := c.UpdateTask("task-one", client.UpdateTaskInput{Labels: &labels})
	if err != nil {
		t.Fatalf("UpdateTask: %v", err)
	}
	if len(updated.Labels) != 1 || updated.Labels[0] != "review" {
		t.Fatalf("unexpected updated labels: %#v", updated.Labels)
	}
	_, err = c.UpdateTask("task-one", client.UpdateTaskInput{
		LabelOps:          &client.LabelOps{Add: []string{"backend"}, Remove: []string{"triage"}},
		DescriptionAppend: &appendText,
	})
	if err != nil {
		t.Fatalf("UpdateTask incremental payload: %v", err)
	}
}

func TestUpdateTaskPreservesStateEntryGuidance(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error": "state entry blocked: cannot enter review: attach a valid GitHub PR first with taskline task link task-one --url https://github.com/<owner>/<repo>/pull/<number>",
		})
	}))
	defer srv.Close()

	state := "review"
	_, err := client.New(srv.URL).UpdateTask("task-one", client.UpdateTaskInput{State: &state})
	if err == nil {
		t.Fatal("UpdateTask should return the server error")
	}
	for _, fragment := range []string{"taskline 409", "cannot enter review", "taskline task link task-one"} {
		if !strings.Contains(err.Error(), fragment) {
			t.Fatalf("error %q does not contain %q", err, fragment)
		}
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

func TestRegisterAgentClientPayload(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/agents/register" {
			http.Error(w, "unexpected "+r.Method+" "+r.URL.String(), http.StatusTeapot)
			return
		}
		var in client.RegisterAgentInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			t.Fatalf("decode register input: %v", err)
		}
		if in.Name != "agent-a" {
			t.Fatalf("unexpected register input: %#v", in)
		}
		_ = json.NewEncoder(w).Encode(client.RegisterAgentOutput{
			Agent: client.Agent{ID: "agent-id", Name: in.Name},
			Token: "tl_agent_token",
		})
	}))
	defer srv.Close()

	c := client.New(srv.URL)
	out, err := c.RegisterAgent(client.RegisterAgentInput{Name: "agent-a"})
	if err != nil {
		t.Fatalf("RegisterAgent: %v", err)
	}
	if out.Agent.Name != "agent-a" || out.Token != "tl_agent_token" {
		t.Fatalf("unexpected register output: %#v", out)
	}
}

func TestTaskClaimClientPayloads(t *testing.T) {
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.String())
		w.Header().Set("Content-Type", "application/json")
		if got := r.Header.Get("Authorization"); got != "Bearer agent-token" {
			t.Fatalf("Authorization = %q", got)
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/projects/demo/tasks/next":
			q := r.URL.Query()
			if q.Get("claim") != "true" || q.Get("owner") != "" || q.Get("lease") != "30m" {
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
			if in.Lease != "2h" {
				t.Fatalf("unexpected claim input: %#v", in)
			}
			_ = json.NewEncoder(w).Encode(client.Task{ID: "task-one", Owner: "agent-b"})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/tasks/task-one/heartbeat":
			var in client.HeartbeatTaskInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Fatalf("decode heartbeat input: %v", err)
			}
			if in.Lease != "3h" {
				t.Fatalf("unexpected heartbeat input: %#v", in)
			}
			_ = json.NewEncoder(w).Encode(client.Task{ID: "task-one", Owner: "agent-b"})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/tasks/task-one/release":
			var in client.ReleaseTaskInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Fatalf("decode release input: %v", err)
			}
			if !in.Force {
				t.Fatalf("unexpected release input: %#v", in)
			}
			_ = json.NewEncoder(w).Encode(client.Task{ID: "task-one"})
		case r.Method == http.MethodPatch && r.URL.Path == "/api/v1/tasks/task-one":
			var in client.UpdateTaskInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Fatalf("decode update input: %v", err)
			}
			if in.IfState == nil || *in.IfState != "start" || !in.Force {
				t.Fatalf("unexpected update input: %#v", in)
			}
			_ = json.NewEncoder(w).Encode(client.Task{ID: "task-one", State: "done"})
		default:
			http.Error(w, "unexpected "+r.Method+" "+r.URL.String(), http.StatusTeapot)
		}
	}))
	defer srv.Close()

	c := client.New(srv.URL)
	c.Token = "agent-token"
	next, err := c.NextRunnableTask("demo", client.NextTaskOptions{Claim: true, Lease: "30m"})
	if err != nil {
		t.Fatalf("NextRunnableTask claim: %v", err)
	}
	if next == nil || next.Owner != "agent-a" || next.ClaimedAt != 1000 || next.LeaseExpiresAt != 2000 {
		t.Fatalf("unexpected next claim task: %#v", next)
	}
	if _, err := c.ClaimTask("task-one", client.ClaimTaskInput{Lease: "2h"}); err != nil {
		t.Fatalf("ClaimTask: %v", err)
	}
	if _, err := c.HeartbeatTask("task-one", client.HeartbeatTaskInput{Lease: "3h"}); err != nil {
		t.Fatalf("HeartbeatTask: %v", err)
	}
	if _, err := c.ReleaseTask("task-one", client.ReleaseTaskInput{Force: true}); err != nil {
		t.Fatalf("ReleaseTask: %v", err)
	}
	ifState := "start"
	if _, err := c.UpdateTask("task-one", client.UpdateTaskInput{IfState: &ifState, Force: true}); err != nil {
		t.Fatalf("UpdateTask: %v", err)
	}

	want := []string{
		"GET /api/v1/projects/demo/tasks/next?claim=true&lease=30m",
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

func TestLabelFilteredClientPayloads(t *testing.T) {
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.String())
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/projects/demo/tasks":
			q := r.URL.Query()
			if q["label"][0] != "backend" || q["label"][1] != "urgent" {
				t.Fatalf("unexpected task list labels: %s", r.URL.RawQuery)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"tasks": []client.Task{{ID: "task-one"}}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/projects/demo/tasks/runnable":
			q := r.URL.Query()
			if q["label"][0] != "backend" || q["label"][1] != "urgent" || q.Get("owner") != "" {
				t.Fatalf("unexpected runnable labels: %s", r.URL.RawQuery)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"tasks": []client.Task{{ID: "task-one"}}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/projects/demo/tasks/next":
			q := r.URL.Query()
			if q.Get("claim") != "true" || q.Get("owner") != "" || q["label"][0] != "backend" || q["label"][1] != "urgent" {
				t.Fatalf("unexpected next labels: %s", r.URL.RawQuery)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"task": client.Task{ID: "task-one"}})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/tasks/task-one/deps":
			var in struct {
				DependsOn string `json:"depends_on"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Fatalf("decode dependency input: %v", err)
			}
			if in.DependsOn != "dep-one" {
				t.Fatalf("unexpected dependency input: %#v", in)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"task_id": "task-one", "depends_on": "dep-one"})
		default:
			http.Error(w, "unexpected "+r.Method+" "+r.URL.String(), http.StatusTeapot)
		}
	}))
	defer srv.Close()

	c := client.New(srv.URL)
	if _, err := c.ListTasks("demo", nil, client.ListTaskOptions{Labels: []string{"backend", "urgent"}}); err != nil {
		t.Fatalf("ListTasks: %v", err)
	}
	if _, err := c.ListRunnableTasks("demo", client.ListRunnableOptions{Labels: []string{"backend", "urgent"}}); err != nil {
		t.Fatalf("ListRunnableTasks: %v", err)
	}
	if _, err := c.NextRunnableTask("demo", client.NextTaskOptions{Claim: true, Labels: []string{"backend", "urgent"}}); err != nil {
		t.Fatalf("NextRunnableTask: %v", err)
	}
	if err := c.AddDependency("task-one", "dep-one"); err != nil {
		t.Fatalf("AddDependency: %v", err)
	}

	want := []string{
		"GET /api/v1/projects/demo/tasks?label=backend&label=urgent",
		"GET /api/v1/projects/demo/tasks/runnable?label=backend&label=urgent",
		"GET /api/v1/projects/demo/tasks/next?claim=true&label=backend&label=urgent",
		"POST /api/v1/tasks/task-one/deps",
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
