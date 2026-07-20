package cmd

import (
	"bytes"
	"strings"
	"testing"

	"cli.taskline.dev/client"
	"github.com/spf13/pflag"
)

func TestTaskUpdateStateHelpMentionsTest(t *testing.T) {
	flag := taskUpdateCmd.Flag("state")
	if flag == nil {
		t.Fatal("state flag not found on taskUpdateCmd")
	}
	usage := flag.Usage
	if !strings.Contains(usage, "test") {
		t.Fatalf("state help %q does not mention test", usage)
	}
}

func TestTaskTypeHelpMentionsDocs(t *testing.T) {
	for _, tc := range []struct {
		name string
		cmd  interface{ Flag(string) *pflag.Flag }
	}{
		{name: "create", cmd: taskCreateCmd},
		{name: "update", cmd: taskUpdateCmd},
	} {
		flag := tc.cmd.Flag("type")
		if flag == nil {
			t.Fatalf("type flag not found on task %s command", tc.name)
		}
		if !strings.Contains(flag.Usage, "docs") {
			t.Fatalf("task %s type help %q does not mention docs", tc.name, flag.Usage)
		}
	}
}

func TestTaskDocCommandsRegistered(t *testing.T) {
	if taskDocCmd == nil {
		t.Fatal("task doc command not found")
	}
	for _, name := range []string{"create", "get", "update", "delete"} {
		found := false
		for _, cmd := range taskDocCmd.Commands() {
			if cmd.Name() == name {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("task doc %s command not registered", name)
		}
	}
	if taskDocCreateCmd.Flag("title") == nil || taskDocCreateCmd.Flag("file") == nil {
		t.Fatal("task doc create should expose --title and --file flags")
	}
	if taskDocUpdateCmd.Flag("title") == nil || taskDocUpdateCmd.Flag("file") == nil {
		t.Fatal("task doc update should expose --title and --file flags")
	}
}

func TestTaskLabelFlagsRegistered(t *testing.T) {
	if taskCreateCmd.Flag("label") == nil {
		t.Fatal("task create should expose repeatable --label flag")
	}
	if taskListCmd.Flag("label") == nil {
		t.Fatal("task list should expose repeatable --label flag")
	}
	if taskListCmd.Flag("runnable") == nil {
		t.Fatal("task list should expose --runnable flag")
	}
	if taskNextCmd.Flag("label") == nil {
		t.Fatal("task next should expose repeatable --label flag")
	}
	if taskUpdateCmd.Flag("label") == nil {
		t.Fatal("task update should expose repeatable --label flag")
	}
	if taskUpdateCmd.Flag("add-label") == nil {
		t.Fatal("task update should expose repeatable --add-label flag")
	}
	if taskUpdateCmd.Flag("remove-label") == nil {
		t.Fatal("task update should expose repeatable --remove-label flag")
	}
	if taskUpdateCmd.Flag("clear-labels") == nil {
		t.Fatal("task update should expose --clear-labels flag")
	}
	if taskUpdateCmd.Flag("append-description") == nil {
		t.Fatal("task update should expose --append-description flag")
	}
}

func TestTaskSearchCommandRegistered(t *testing.T) {
	found := false
	for _, cmd := range taskCmd.Commands() {
		if cmd.Name() == "search" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("task search command not registered")
	}
	if taskSearchCmd.Flag("project") == nil {
		t.Fatal("task search should expose --project")
	}
	if taskSearchCmd.Flag("limit") == nil {
		t.Fatal("task search should expose --limit")
	}
}

func TestTaskHistoryCommandRegistered(t *testing.T) {
	found := false
	for _, cmd := range taskCmd.Commands() {
		if cmd.Name() == "history" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("task history command not registered")
	}
}

func TestRenderTaskHistoryTable(t *testing.T) {
	var buf bytes.Buffer
	renderTaskHistoryTable(&buf, []client.TaskEvent{{
		Actor: "agent-a", Action: "updated", Summary: "Updated title", CreatedAt: 1_234,
	}})
	out := buf.String()
	for _, want := range []string{"TIME", "ACTOR", "ACTION", "SUMMARY", "agent-a", "updated", "Updated title"} {
		if !strings.Contains(out, want) {
			t.Fatalf("history table %q missing %q", out, want)
		}
	}
}

func TestTaskClaimCommandsAndFlagsRegistered(t *testing.T) {
	for _, tc := range []struct {
		name string
		cmd  interface{ Flag(string) *pflag.Flag }
		flag string
	}{
		{name: "next", cmd: taskNextCmd, flag: "claim"},
		{name: "next", cmd: taskNextCmd, flag: "lease"},
		{name: "update", cmd: taskUpdateCmd, flag: "if-state"},
		{name: "update", cmd: taskUpdateCmd, flag: "force"},
	} {
		if tc.cmd.Flag(tc.flag) == nil {
			t.Fatalf("task %s should expose --%s", tc.name, tc.flag)
		}
	}

	for _, name := range []string{"claim", "release", "heartbeat"} {
		found := false
		for _, cmd := range taskCmd.Commands() {
			if cmd.Name() == name {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("task %s command not registered", name)
		}
	}
}

func TestTaskClaimCommandsDoNotExposeOwnerFlag(t *testing.T) {
	for _, tc := range []struct {
		name string
		cmd  interface{ Flag(string) *pflag.Flag }
	}{
		{name: "next", cmd: taskNextCmd},
		{name: "update", cmd: taskUpdateCmd},
		{name: "claim", cmd: taskClaimCmd},
		{name: "release", cmd: taskReleaseCmd},
		{name: "heartbeat", cmd: taskHeartbeatCmd},
	} {
		if tc.cmd.Flag("owner") != nil {
			t.Fatalf("task %s should not expose --owner", tc.name)
		}
	}
}

func TestRegisterCommandRegistered(t *testing.T) {
	found := false
	for _, cmd := range rootCmd.Commands() {
		if cmd.Name() == "register" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("register command not registered")
	}
	if registerCmd.Flag("name") == nil {
		t.Fatal("register should expose --name")
	}
}

func TestRenderTaskTableShowsOwner(t *testing.T) {
	var buf bytes.Buffer
	renderTaskTable(&buf, []client.Task{
		{
			ID:       "12345678-1234-1234-1234-123456789abc",
			State:    "start",
			Type:     "feature",
			Priority: 7,
			Owner:    "juex_main",
			Title:    "claimed task",
		},
	})

	out := buf.String()
	if !strings.Contains(out, "OWNER") {
		t.Fatalf("task table should expose OWNER column, got:\n%s", out)
	}
	if !strings.Contains(out, "juex_main") {
		t.Fatalf("task table should show current owner, got:\n%s", out)
	}
}
