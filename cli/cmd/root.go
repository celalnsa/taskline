package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"cli.taskline.dev/client"
)

var (
	version     string
	commit      string
	serverFlag  string
	formatFlag  string
	verboseFlag bool
)

func SetVersion(v string) { version = v }
func SetCommit(c string)  { commit = c }

var rootCmd = &cobra.Command{
	Use:   "taskline",
	Short: "taskline CLI — agent-friendly task / kanban management",
	Long: `Command-line client for taskline-server.

Manage projects, tasks, dependencies, and image attachments. Designed to be
driven primarily by AI agents — output defaults to JSON when not attached to
a TTY, exit codes are stable, stderr is reserved for diagnostics.

Environment:
  TASKLINE_SERVER   — base URL of taskline-server (default http://127.0.0.1:8787)
  TASKLINE_PROJECT  — default project (id or name); --project flag overrides

Examples:
  taskline project create --name demo
  taskline task create --project demo --title "first task" --type feature
  taskline task list --project demo --state start,dev
  taskline task next --project demo
  taskline task update <id> --state review
  taskline task depend <id> --on <other-id>`,
	SilenceUsage:  true,
	SilenceErrors: true,
}

func init() {
	rootCmd.PersistentFlags().StringVarP(&serverFlag, "server", "s", "", "taskline-server base URL (default $TASKLINE_SERVER or http://127.0.0.1:8787)")
	rootCmd.PersistentFlags().StringVarP(&formatFlag, "format", "f", "", "output format: json, table (default: json in non-TTY, table in TTY)")
	rootCmd.PersistentFlags().BoolVarP(&verboseFlag, "verbose", "v", false, "verbose stderr logging")
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(2)
	}
}

// newClient resolves --server flag → $TASKLINE_SERVER → default.
func newClient() *client.Client {
	url := serverFlag
	if url == "" {
		url = os.Getenv("TASKLINE_SERVER")
	}
	if url == "" {
		url = "http://127.0.0.1:8787"
	}
	return client.New(url)
}

// resolveProject returns --project flag → $TASKLINE_PROJECT → "".
// Caller errors when result is empty if a project is required.
func resolveProject(flagVal string) string {
	if flagVal != "" {
		return flagVal
	}
	return os.Getenv("TASKLINE_PROJECT")
}
