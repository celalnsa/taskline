package cmd

import (
	"fmt"
	"io"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"cli.taskline.dev/client"
	"cli.taskline.dev/internal/output"
)

func init() {
	rootCmd.AddCommand(projectCmd)
	projectCmd.AddCommand(projectCreateCmd, projectListCmd)

	projectCreateCmd.Flags().String("name", "", "project name (required, must be unique)")
	projectCreateCmd.Flags().String("description", "", "human-readable project description")
	_ = projectCreateCmd.MarkFlagRequired("name")
}

var projectCmd = &cobra.Command{
	Use:   "project",
	Short: "Manage projects (workspaces that own tasks)",
}

var projectCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new project",
	RunE: func(cmd *cobra.Command, args []string) error {
		name, _ := cmd.Flags().GetString("name")
		desc, _ := cmd.Flags().GetString("description")
		c := newClient()
		p, err := c.CreateProject(client.CreateProjectInput{Name: name, Description: desc})
		if err != nil {
			return err
		}
		return output.Render(os.Stdout, output.Resolve(formatFlag), p, func(w io.Writer) {
			renderProjectTable(w, []client.Project{*p})
		})
	},
}

var projectListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all projects",
	RunE: func(cmd *cobra.Command, args []string) error {
		c := newClient()
		ps, err := c.ListProjects()
		if err != nil {
			return err
		}
		return output.Render(os.Stdout, output.Resolve(formatFlag), map[string]any{"projects": ps}, func(w io.Writer) {
			renderProjectTable(w, ps)
		})
	},
}

func renderProjectTable(w io.Writer, ps []client.Project) {
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "NAME\tID\tDESCRIPTION")
	for _, p := range ps {
		fmt.Fprintf(tw, "%s\t%s\t%s\n", p.Name, shortID(p.ID), trimRune(p.Description, 60))
	}
	tw.Flush()
}

func shortID(id string) string {
	if len(id) <= 8 {
		return id
	}
	return id[:8]
}

func trimRune(s string, n int) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) <= n {
		return string(r)
	}
	return string(r[:n]) + "…"
}
