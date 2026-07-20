package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"cli.taskline.dev/client"
	"cli.taskline.dev/internal/identity"
	"cli.taskline.dev/internal/output"
)

func TestStatusCommandRegistered(t *testing.T) {
	for _, command := range rootCmd.Commands() {
		if command.Name() == "status" {
			return
		}
	}
	t.Fatal("status command not registered")
}

func TestLoadStatusWithoutRegistrationIncludesLocalConfig(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("TASKLINE_PROJECT", "demo")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "" {
			t.Fatalf("unexpected authorization: %q", got)
		}
		_ = json.NewEncoder(w).Encode(client.ServerStatus{OK: true, ServerTime: 5_000})
	}))
	defer server.Close()

	status, err := loadStatus(context.Background(), server.URL)
	if err != nil {
		t.Fatalf("loadStatus: %v", err)
	}
	if status.Registered || status.Agent != nil {
		t.Fatalf("unexpected registered status: %#v", status)
	}
	if status.DefaultProject != "demo" {
		t.Fatalf("default project = %q", status.DefaultProject)
	}
	wantDir := filepath.Join(tmp, ".config", "taskline")
	if status.ConfigDir != wantDir {
		t.Fatalf("config dir = %q, want %q", status.ConfigDir, wantDir)
	}
}

func TestLoadStatusValidatesRegisteredIdentity(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer agent-token" {
			t.Fatalf("authorization = %q", got)
		}
		_ = json.NewEncoder(w).Encode(client.ServerStatus{
			OK:    true,
			Agent: &client.Agent{ID: "agent-id", Name: "agent-a"},
			ActiveTasks: []client.ActiveClaim{{
				ID: "12345678-task", Title: "claimed", ClaimedForMS: 90_000, LeaseExpiresAt: 10_000,
			}},
		})
	}))
	defer server.Close()
	_, err := identity.Save(identity.Identity{
		Server: server.URL,
		Agent:  identity.Agent{ID: "agent-id", Name: "agent-a"},
		Token:  "agent-token",
	})
	if err != nil {
		t.Fatalf("Save identity: %v", err)
	}

	status, err := loadStatus(context.Background(), server.URL)
	if err != nil {
		t.Fatalf("loadStatus: %v", err)
	}
	if !status.Registered || status.Agent == nil || status.Agent.Name != "agent-a" {
		t.Fatalf("unexpected status: %#v", status)
	}

	var table bytes.Buffer
	renderStatusTable(&table, status)
	for _, fragment := range []string{"agent-a", "12345678", "claimed", "1m30s"} {
		if !strings.Contains(table.String(), fragment) {
			t.Fatalf("table %q does not contain %q", table.String(), fragment)
		}
	}
}

func TestRunRegisterSendsExistingIdentity(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer agent-token" {
			t.Fatalf("authorization = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error": "already registered as agent-a; run taskline status",
		})
	}))
	defer server.Close()
	_, err := identity.Save(identity.Identity{
		Server: server.URL,
		Agent:  identity.Agent{ID: "agent-id", Name: "agent-a"},
		Token:  "agent-token",
	})
	if err != nil {
		t.Fatalf("Save identity: %v", err)
	}

	err = runRegister(&bytes.Buffer{}, "replacement", server.URL, output.FormatJSON)
	if err == nil || !strings.Contains(err.Error(), "already registered as agent-a") {
		t.Fatalf("unexpected register error: %v", err)
	}
}
