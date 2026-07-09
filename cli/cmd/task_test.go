package cmd

import (
	"strings"
	"testing"

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

func TestTaskClaimCommandsAndFlagsRegistered(t *testing.T) {
	for _, tc := range []struct {
		name string
		cmd  interface{ Flag(string) *pflag.Flag }
		flag string
	}{
		{name: "next", cmd: taskNextCmd, flag: "claim"},
		{name: "next", cmd: taskNextCmd, flag: "owner"},
		{name: "next", cmd: taskNextCmd, flag: "lease"},
		{name: "update", cmd: taskUpdateCmd, flag: "if-state"},
		{name: "update", cmd: taskUpdateCmd, flag: "owner"},
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

func TestResolveOwnerPrefersFlagThenEnvironment(t *testing.T) {
	t.Setenv("TASKLINE_OWNER", "env-owner")
	if got := resolveOwner("flag-owner"); got != "flag-owner" {
		t.Fatalf("flag owner should win, got %q", got)
	}
	if got := resolveOwner(""); got != "env-owner" {
		t.Fatalf("env owner should be used, got %q", got)
	}
}
