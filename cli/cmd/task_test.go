package cmd

import (
	"strings"
	"testing"
)

func TestTaskUpdateStateHelpMentionsTest(t *testing.T) {
	usage := taskUpdateCmd.Flag("state").Usage
	if !strings.Contains(usage, "test") {
		t.Fatalf("state help %q does not mention test", usage)
	}
}
