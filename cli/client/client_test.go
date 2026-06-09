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
