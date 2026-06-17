package client_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"cli.taskline.dev/client"
)

func TestHTTPContractFixturesRoundTripCLIModels(t *testing.T) {
	roundTripCLIFixture(t, "project.json", &client.Project{})
	roundTripCLIFixture(t, "task_full.json", &client.Task{})
	roundTripCLIFixture(t, "tasks_response.json", &struct {
		Tasks []client.Task `json:"tasks"`
	}{})
	roundTripCLIFixture(t, "next_task_response.json", &struct {
		Task *client.Task `json:"task"`
	}{})
	roundTripCLIFixture(t, "doc.json", &client.Doc{})
	roundTripCLIFixture(t, "image.json", &client.Image{})
	roundTripCLIFixture(t, "link.json", &client.Link{})
}

func roundTripCLIFixture(t *testing.T, name string, out any) {
	t.Helper()
	raw := readCLIFixture(t, name, out)
	got, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("marshal %s: %v", name, err)
	}
	if !bytes.Equal(compactCLIJSON(t, raw), got) {
		t.Fatalf("%s drifted\nwant: %s\n got: %s", name, compactCLIJSON(t, raw), got)
	}
}

func readCLIFixture(t *testing.T, name string, out any) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "testdata", "http_contract", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("unmarshal %s: %v", name, err)
	}
	return raw
}

func compactCLIJSON(t *testing.T, raw []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		t.Fatalf("compact fixture: %v", err)
	}
	return buf.Bytes()
}
