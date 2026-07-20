package cmd

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"

	"cli.taskline.dev/client"
	"cli.taskline.dev/internal/identity"
	"cli.taskline.dev/internal/output"
)

func init() { rootCmd.AddCommand(statusCmd) }

type statusOutput struct {
	CLIVersion     string               `json:"cli_version"`
	CLICommit      string               `json:"cli_commit"`
	Server         string               `json:"server"`
	Healthy        bool                 `json:"healthy"`
	ConfigDir      string               `json:"config_dir"`
	DefaultProject string               `json:"default_project"`
	Registered     bool                 `json:"registered"`
	Agent          *client.Agent        `json:"agent,omitempty"`
	ActiveTasks    []client.ActiveClaim `json:"active_tasks"`
}

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show CLI config, server health, agent identity, and active claims",
	RunE: func(cmd *cobra.Command, args []string) error {
		status, err := loadStatus(cmd.Context(), resolveServer())
		if err != nil {
			return err
		}
		return output.Render(os.Stdout, output.Resolve(formatFlag), status, func(w io.Writer) {
			renderStatusTable(w, status)
		})
	},
}

func loadStatus(ctx context.Context, server string) (statusOutput, error) {
	if err := ctx.Err(); err != nil {
		return statusOutput{}, err
	}
	identityPath, err := identity.Path()
	if err != nil {
		return statusOutput{}, err
	}
	server = strings.TrimRight(server, "/")
	localIdentity, registered, err := identity.Load(server)
	if err != nil {
		return statusOutput{}, err
	}

	c := client.New(server)
	if registered {
		c.Token = localIdentity.Token
	}
	serverStatus, err := c.GetStatus()
	if err != nil {
		return statusOutput{}, err
	}
	if registered {
		if serverStatus.Agent == nil {
			return statusOutput{}, fmt.Errorf("server did not confirm the registered agent in %s", identityPath)
		}
		if serverStatus.Agent.ID != localIdentity.Agent.ID || serverStatus.Agent.Name != localIdentity.Agent.Name {
			return statusOutput{}, fmt.Errorf(
				"agent identity in %s does not match server identity %s; remove the local identity and register again",
				identityPath,
				serverStatus.Agent.Name,
			)
		}
	}

	return statusOutput{
		CLIVersion:     version,
		CLICommit:      commit,
		Server:         server,
		Healthy:        serverStatus.OK,
		ConfigDir:      filepath.Dir(identityPath),
		DefaultProject: strings.TrimSpace(os.Getenv("TASKLINE_PROJECT")),
		Registered:     registered,
		Agent:          serverStatus.Agent,
		ActiveTasks:    serverStatus.ActiveTasks,
	}, nil
}

func renderStatusTable(w io.Writer, status statusOutput) {
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintf(tw, "CLI\t%s (%s)\n", status.CLIVersion, status.CLICommit)
	fmt.Fprintf(tw, "SERVER\t%s\n", status.Server)
	fmt.Fprintf(tw, "HEALTHY\t%t\n", status.Healthy)
	fmt.Fprintf(tw, "CONFIG\t%s\n", status.ConfigDir)
	fmt.Fprintf(tw, "PROJECT\t%s\n", fallback(status.DefaultProject, "-"))
	if status.Agent == nil {
		fmt.Fprintln(tw, "AGENT\tnot registered")
	} else {
		fmt.Fprintf(tw, "AGENT\t%s\n", status.Agent.Name)
	}
	fmt.Fprintf(tw, "ACTIVE TASKS\t%d\n", len(status.ActiveTasks))
	if len(status.ActiveTasks) > 0 {
		fmt.Fprintln(tw, "\nID\tTITLE\tELAPSED\tLEASE EXPIRES")
		for _, task := range status.ActiveTasks {
			fmt.Fprintf(
				tw,
				"%s\t%s\t%s\t%s\n",
				shortID(task.ID),
				trimRune(task.Title, 60),
				formatElapsed(task.ClaimedForMS),
				formatLeaseExpiry(task.LeaseExpiresAt),
			)
		}
	}
	_ = tw.Flush()
}

func fallback(value, fallbackValue string) string {
	if value == "" {
		return fallbackValue
	}
	return value
}

func formatElapsed(milliseconds int64) string {
	if milliseconds <= 0 {
		return "0s"
	}
	return (time.Duration(milliseconds) * time.Millisecond).Round(time.Second).String()
}

func formatLeaseExpiry(milliseconds int64) string {
	if milliseconds <= 0 {
		return "-"
	}
	return time.UnixMilli(milliseconds).Local().Format(time.RFC3339)
}
