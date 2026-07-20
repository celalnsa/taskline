package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestHTTPContractFixturesRoundTripServerModels(t *testing.T) {
	roundTripServerFixture(t, "project.json", &Project{})
	roundTripServerFixture(t, "task_full.json", &Task{})
	roundTripServerFixture(t, "tasks_response.json", &struct {
		Tasks []Task `json:"tasks"`
	}{})
	roundTripServerFixture(t, "next_task_response.json", &struct {
		Task *Task `json:"task"`
	}{})
	roundTripServerFixture(t, "status.json", &ServerStatus{})
	roundTripServerFixture(t, "doc.json", &Doc{})
	roundTripServerFixture(t, "image.json", &Image{})
	roundTripServerFixture(t, "link.json", &Link{})
}

func TestHTTPContractFixtureStateAndTypeAreKnown(t *testing.T) {
	var task Task
	readServerFixture(t, "task_full.json", &task)

	if !task.State.Valid() {
		t.Fatalf("fixture task state %q is not a known TaskState", task.State)
	}
	if !task.Type.Valid() {
		t.Fatalf("fixture task type %q is not a known TaskType", task.Type)
	}
}

func roundTripServerFixture(t *testing.T, name string, out any) {
	t.Helper()
	raw := readServerFixture(t, name, out)
	got, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("marshal %s: %v", name, err)
	}
	if !bytes.Equal(compactJSON(t, raw), got) {
		t.Fatalf("%s drifted\nwant: %s\n got: %s", name, compactJSON(t, raw), got)
	}
}

func readServerFixture(t *testing.T, name string, out any) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "testdata", "http_contract", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("unmarshal %s: %v", name, err)
	}
	return raw
}

func compactJSON(t *testing.T, raw []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		t.Fatalf("compact fixture: %v", err)
	}
	return buf.Bytes()
}
