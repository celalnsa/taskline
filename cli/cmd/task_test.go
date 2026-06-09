package cmd

import (
	"strings"
	"testing"
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
