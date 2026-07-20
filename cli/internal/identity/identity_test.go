package identity

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveAndLoadUseCurrentDirectoryConfig(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)

	path, err := Save(Identity{
		Server: "http://127.0.0.1:8787/",
		Agent:  Agent{ID: "agent-id", Name: "agent-a"},
		Token:  "tl_agent_token",
	})
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	wantPath := filepath.Join(tmp, ".config", "taskline", "agent.json")
	if path != wantPath {
		t.Fatalf("path = %q, want %q", path, wantPath)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat identity file: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("identity file mode = %v, want 0600", got)
	}

	id, ok, err := Load("http://127.0.0.1:8787")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !ok {
		t.Fatal("Load should find saved identity")
	}
	if id.Server != "http://127.0.0.1:8787" || id.Agent.Name != "agent-a" || id.Token != "tl_agent_token" {
		t.Fatalf("unexpected identity: %#v", id)
	}
}

func TestLoadRejectsDifferentServer(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	_, err := Save(Identity{
		Server: "http://127.0.0.1:8787",
		Agent:  Agent{ID: "agent-id", Name: "agent-a"},
		Token:  "tl_agent_token",
	})
	if err != nil {
		t.Fatalf("Save: %v", err)
	}

	_, ok, err := Load("http://127.0.0.1:8610")
	if err == nil {
		t.Fatal("Load should reject a config for a different server")
	}
	if ok {
		t.Fatal("Load should not report a usable identity on server mismatch")
	}
	if !strings.Contains(err.Error(), "current server is http://127.0.0.1:8610") {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(err.Error(), "correct TASKLINE_SERVER") {
		t.Fatalf("error should guide server correction: %v", err)
	}
}
