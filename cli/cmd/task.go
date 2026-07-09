package cmd

import (
	"errors"
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
	rootCmd.AddCommand(taskCmd)
	taskCmd.AddCommand(
		taskCreateCmd,
		taskListCmd,
		taskSearchCmd,
		taskNextCmd,
		taskGetCmd,
		taskUpdateCmd,
		taskDeleteCmd,
		taskClaimCmd,
		taskReleaseCmd,
		taskHeartbeatCmd,
		taskDependCmd,
		taskUndependCmd,
		taskUploadCmd,
		taskDocCmd,
		taskLinkCmd,
		taskUnlinkCmd,
	)
	taskDocCmd.AddCommand(
		taskDocCreateCmd,
		taskDocGetCmd,
		taskDocUpdateCmd,
		taskDocDeleteCmd,
	)

	// Common --project flag (shared semantics across subcommands).
	for _, cmd := range []*cobra.Command{
		taskCreateCmd, taskListCmd, taskSearchCmd, taskNextCmd,
	} {
		cmd.Flags().StringP("project", "p", "", "project id or name (or $TASKLINE_PROJECT)")
	}

	taskCreateCmd.Flags().String("title", "", "task title (required)")
	taskCreateCmd.Flags().String("description", "", "task description")
	taskCreateCmd.Flags().String("type", "feature", "task type: feature|bug|docs")
	taskCreateCmd.Flags().Int("priority", 0, "task priority (higher = runs sooner)")
	taskCreateCmd.Flags().StringArray("label", nil, "task label (repeatable)")
	taskCreateCmd.Flags().Bool("auto-start", true, "start the task immediately ('start'); pass --auto-start=false to park it as 'pending'")
	_ = taskCreateCmd.MarkFlagRequired("title")

	taskListCmd.Flags().String("state", "", "comma-separated states to include (default: all)")
	taskListCmd.Flags().String("owner", "", "filter tasks by owner (or $TASKLINE_OWNER with --mine)")
	taskListCmd.Flags().Bool("mine", false, "filter tasks owned by $TASKLINE_OWNER")
	taskListCmd.Flags().Bool("unclaimed", false, "filter tasks with no owner")
	taskListCmd.Flags().Bool("runnable", false, "list only currently runnable tasks")
	taskListCmd.Flags().StringArray("label", nil, "filter tasks by label; repeat for AND semantics")
	taskSearchCmd.Flags().Int("limit", 20, "maximum number of matching tasks")
	taskNextCmd.Flags().Bool("claim", false, "atomically claim the next runnable task")
	taskNextCmd.Flags().String("owner", "", "claim owner (or $TASKLINE_OWNER)")
	taskNextCmd.Flags().String("lease", "", "claim lease duration, e.g. 30m, 2h, 6h (default: server policy)")
	taskNextCmd.Flags().StringArray("label", nil, "filter by label; repeat for AND semantics")

	taskUpdateCmd.Flags().String("title", "", "new title")
	taskUpdateCmd.Flags().String("description", "", "new description")
	taskUpdateCmd.Flags().String("type", "", "new type: feature|bug|docs")
	taskUpdateCmd.Flags().String("state", "", "new state: pending|start|spec|dev|test|review|done")
	taskUpdateCmd.Flags().Int("priority", 0, "new priority")
	taskUpdateCmd.Flags().StringArray("label", nil, "replace task labels (repeatable)")
	taskUpdateCmd.Flags().Bool("clear-labels", false, "clear all task labels")
	taskUpdateCmd.Flags().String("if-state", "", "only update if current state still matches")
	taskUpdateCmd.Flags().String("owner", "", "task owner for claimed-task updates (or $TASKLINE_OWNER)")
	taskUpdateCmd.Flags().Bool("force", false, "bypass owner guard for manual correction")

	for _, cmd := range []*cobra.Command{taskClaimCmd, taskReleaseCmd, taskHeartbeatCmd} {
		cmd.Flags().String("owner", "", "task owner (or $TASKLINE_OWNER)")
	}
	for _, cmd := range []*cobra.Command{taskClaimCmd, taskHeartbeatCmd} {
		cmd.Flags().String("lease", "", "lease duration, e.g. 30m, 2h, 6h (default: server policy)")
	}
	taskReleaseCmd.Flags().Bool("force", false, "release regardless of current owner")

	taskDependCmd.Flags().String("on", "", "id of the task this one depends on (required)")
	_ = taskDependCmd.MarkFlagRequired("on")
	taskUndependCmd.Flags().String("on", "", "id of the dependency to remove (required)")
	_ = taskUndependCmd.MarkFlagRequired("on")

	taskUploadCmd.Flags().String("file", "", "local file path to upload (required)")
	_ = taskUploadCmd.MarkFlagRequired("file")

	taskDocCreateCmd.Flags().String("title", "", "document title (required)")
	taskDocCreateCmd.Flags().String("file", "", "markdown file path to upload (required)")
	_ = taskDocCreateCmd.MarkFlagRequired("title")
	_ = taskDocCreateCmd.MarkFlagRequired("file")

	taskDocUpdateCmd.Flags().String("title", "", "new document title")
	taskDocUpdateCmd.Flags().String("file", "", "markdown file path with replacement content")

	taskLinkCmd.Flags().String("url", "", "URL to attach (required)")
	taskLinkCmd.Flags().String("label", "", "optional display label for the link")
	_ = taskLinkCmd.MarkFlagRequired("url")
}

var taskCmd = &cobra.Command{
	Use:   "task",
	Short: "Manage tasks within a project",
}

var taskCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new task in a project",
	RunE: func(cmd *cobra.Command, args []string) error {
		flagVal, _ := cmd.Flags().GetString("project")
		project := resolveProject(flagVal)
		if project == "" {
			return errors.New("project required (--project or $TASKLINE_PROJECT)")
		}
		title, _ := cmd.Flags().GetString("title")
		desc, _ := cmd.Flags().GetString("description")
		typ, _ := cmd.Flags().GetString("type")
		prio, _ := cmd.Flags().GetInt("priority")
		labels, _ := cmd.Flags().GetStringArray("label")
		autoStart, _ := cmd.Flags().GetBool("auto-start")
		c := newClient()
		t, err := c.CreateTask(project, client.CreateTaskInput{
			Title: title, Description: desc, Type: typ, Priority: prio,
			Labels:    labels,
			AutoStart: &autoStart,
		})
		if err != nil {
			return err
		}
		return output.Render(os.Stdout, output.Resolve(formatFlag), t, func(w io.Writer) {
			renderTaskTable(w, []client.Task{*t})
		})
	},
}

var taskListCmd = &cobra.Command{
	Use:   "list",
	Short: "List tasks in a project (optionally filter by state)",
	RunE: func(cmd *cobra.Command, args []string) error {
		flagVal, _ := cmd.Flags().GetString("project")
		project := resolveProject(flagVal)
		if project == "" {
			return errors.New("project required (--project or $TASKLINE_PROJECT)")
		}
		stateRaw, _ := cmd.Flags().GetString("state")
		var states []string
		for _, s := range strings.Split(stateRaw, ",") {
			s = strings.TrimSpace(s)
			if s != "" {
				states = append(states, s)
			}
		}
		ownerFlag, _ := cmd.Flags().GetString("owner")
		mine, _ := cmd.Flags().GetBool("mine")
		unclaimed, _ := cmd.Flags().GetBool("unclaimed")
		runnable, _ := cmd.Flags().GetBool("runnable")
		labels, _ := cmd.Flags().GetStringArray("label")
		if ownerFlag != "" && mine {
			return errors.New("--owner and --mine cannot be used together")
		}
		owner := ownerFlag
		if mine {
			owner = resolveOwner("")
			if owner == "" {
				return errors.New("owner required: pass --owner or set TASKLINE_OWNER")
			}
		}
		if owner != "" && unclaimed {
			return errors.New("--owner/--mine and --unclaimed cannot be used together")
		}
		c := newClient()
		var (
			ts  []client.Task
			err error
		)
		if runnable {
			if stateRaw != "" || owner != "" || unclaimed {
				return errors.New("--runnable cannot be combined with --state, --owner, --mine, or --unclaimed")
			}
			ts, err = c.ListRunnableTasks(project, client.ListRunnableOptions{Labels: labels})
		} else {
			ts, err = c.ListTasks(project, states, client.ListTaskOptions{Owner: owner, Unclaimed: unclaimed, Labels: labels})
		}
		if err != nil {
			return err
		}
		return output.Render(os.Stdout, output.Resolve(formatFlag), map[string]any{"tasks": ts}, func(w io.Writer) {
			renderTaskTable(w, ts)
		})
	},
}

var taskSearchCmd = &cobra.Command{
	Use:   "search <query>",
	Short: "Search tasks in a project",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		flagVal, _ := cmd.Flags().GetString("project")
		project := resolveProject(flagVal)
		if project == "" {
			return errors.New("project required (--project or $TASKLINE_PROJECT)")
		}
		query := strings.TrimSpace(strings.Join(args, " "))
		if query == "" {
			return errors.New("query required")
		}
		limit, _ := cmd.Flags().GetInt("limit")
		if limit < 1 {
			return errors.New("limit must be a positive integer")
		}
		c := newClient()
		ts, err := c.SearchTasks(project, query, limit)
		if err != nil {
			return err
		}
		return output.Render(os.Stdout, output.Resolve(formatFlag), map[string]any{"tasks": ts}, func(w io.Writer) {
			renderTaskTable(w, ts)
		})
	},
}

var taskNextCmd = &cobra.Command{
	Use:   "next",
	Short: "Return the highest-priority task whose dependencies are all done",
	RunE: func(cmd *cobra.Command, args []string) error {
		flagVal, _ := cmd.Flags().GetString("project")
		project := resolveProject(flagVal)
		if project == "" {
			return errors.New("project required (--project or $TASKLINE_PROJECT)")
		}
		claim, _ := cmd.Flags().GetBool("claim")
		ownerFlag, _ := cmd.Flags().GetString("owner")
		lease, _ := cmd.Flags().GetString("lease")
		labels, _ := cmd.Flags().GetStringArray("label")
		c := newClient()
		var (
			t   *client.Task
			err error
		)
		if claim {
			owner := resolveOwner(ownerFlag)
			if owner == "" {
				return errors.New("owner required: pass --owner or set TASKLINE_OWNER")
			}
			t, err = c.NextRunnableTask(project, client.NextTaskOptions{Claim: true, Owner: owner, Lease: lease, Labels: labels})
		} else {
			t, err = c.NextRunnableTask(project, client.NextTaskOptions{Labels: labels})
		}
		if err != nil {
			return err
		}
		return output.Render(os.Stdout, output.Resolve(formatFlag), t, func(w io.Writer) {
			if t == nil {
				fmt.Fprintln(w, "(no runnable task)")
				return
			}
			renderTaskTable(w, []client.Task{*t})
		})
	},
}

var taskGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Fetch a single task by id",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		c := newClient()
		t, err := c.GetTask(args[0])
		if err != nil {
			return err
		}
		return output.Render(os.Stdout, output.Resolve(formatFlag), t, func(w io.Writer) {
			renderTaskTable(w, []client.Task{*t})
		})
	},
}

var taskUpdateCmd = &cobra.Command{
	Use:   "update <id>",
	Short: "Update a task's fields (title, description, type, state, priority)",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		in := client.UpdateTaskInput{}
		if cmd.Flags().Changed("title") {
			v, _ := cmd.Flags().GetString("title")
			in.Title = &v
		}
		if cmd.Flags().Changed("description") {
			v, _ := cmd.Flags().GetString("description")
			in.Description = &v
		}
		if cmd.Flags().Changed("type") {
			v, _ := cmd.Flags().GetString("type")
			in.Type = &v
		}
		if cmd.Flags().Changed("state") {
			v, _ := cmd.Flags().GetString("state")
			in.State = &v
		}
		if cmd.Flags().Changed("priority") {
			v, _ := cmd.Flags().GetInt("priority")
			in.Priority = &v
		}
		labelsChanged := cmd.Flags().Changed("label")
		clearLabels, _ := cmd.Flags().GetBool("clear-labels")
		if labelsChanged && clearLabels {
			return errors.New("--label and --clear-labels cannot be used together")
		}
		if labelsChanged {
			v, _ := cmd.Flags().GetStringArray("label")
			in.Labels = &v
		}
		if clearLabels {
			v := []string{}
			in.Labels = &v
		}
		if cmd.Flags().Changed("if-state") {
			v, _ := cmd.Flags().GetString("if-state")
			in.IfState = &v
		}
		if cmd.Flags().Changed("owner") {
			v, _ := cmd.Flags().GetString("owner")
			in.Owner = resolveOwner(v)
		} else if envOwner := resolveOwner(""); envOwner != "" {
			in.Owner = envOwner
		}
		force, _ := cmd.Flags().GetBool("force")
		in.Force = force
		c := newClient()
		t, err := c.UpdateTask(args[0], in)
		if err != nil {
			return err
		}
		return output.Render(os.Stdout, output.Resolve(formatFlag), t, func(w io.Writer) {
			renderTaskTable(w, []client.Task{*t})
		})
	},
}

var taskDeleteCmd = &cobra.Command{
	Use:   "delete <id>",
	Short: "Delete a task (cascades to dependencies and images)",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		c := newClient()
		if err := c.DeleteTask(args[0]); err != nil {
			return err
		}
		return output.JSON(os.Stdout, map[string]any{"deleted": true, "id": args[0]})
	},
}

var taskClaimCmd = &cobra.Command{
	Use:   "claim <id>",
	Short: "Claim a runnable task for this owner",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ownerFlag, _ := cmd.Flags().GetString("owner")
		owner := resolveOwner(ownerFlag)
		if owner == "" {
			return errors.New("owner required: pass --owner or set TASKLINE_OWNER")
		}
		lease, _ := cmd.Flags().GetString("lease")
		c := newClient()
		t, err := c.ClaimTask(args[0], client.ClaimTaskInput{Owner: owner, Lease: lease})
		if err != nil {
			return err
		}
		return output.Render(os.Stdout, output.Resolve(formatFlag), t, func(w io.Writer) {
			renderTaskTable(w, []client.Task{*t})
		})
	},
}

var taskReleaseCmd = &cobra.Command{
	Use:   "release <id>",
	Short: "Release a claimed task",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ownerFlag, _ := cmd.Flags().GetString("owner")
		force, _ := cmd.Flags().GetBool("force")
		owner := resolveOwner(ownerFlag)
		if owner == "" && !force {
			return errors.New("owner required: pass --owner or set TASKLINE_OWNER")
		}
		c := newClient()
		t, err := c.ReleaseTask(args[0], client.ReleaseTaskInput{Owner: owner, Force: force})
		if err != nil {
			return err
		}
		return output.Render(os.Stdout, output.Resolve(formatFlag), t, func(w io.Writer) {
			renderTaskTable(w, []client.Task{*t})
		})
	},
}

var taskHeartbeatCmd = &cobra.Command{
	Use:   "heartbeat <id>",
	Short: "Renew a task claim lease",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ownerFlag, _ := cmd.Flags().GetString("owner")
		owner := resolveOwner(ownerFlag)
		if owner == "" {
			return errors.New("owner required: pass --owner or set TASKLINE_OWNER")
		}
		lease, _ := cmd.Flags().GetString("lease")
		c := newClient()
		t, err := c.HeartbeatTask(args[0], client.HeartbeatTaskInput{Owner: owner, Lease: lease})
		if err != nil {
			return err
		}
		return output.Render(os.Stdout, output.Resolve(formatFlag), t, func(w io.Writer) {
			renderTaskTable(w, []client.Task{*t})
		})
	},
}

var taskDependCmd = &cobra.Command{
	Use:   "depend <id>",
	Short: "Mark <id> as depending on another task (--on <other-id>)",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		dep, _ := cmd.Flags().GetString("on")
		c := newClient()
		if err := c.AddDependency(args[0], dep); err != nil {
			return err
		}
		return output.JSON(os.Stdout, map[string]any{"task_id": args[0], "depends_on": dep})
	},
}

var taskUndependCmd = &cobra.Command{
	Use:   "undepend <id>",
	Short: "Remove one dependency edge from <id> (--on <other-id>)",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		dep, _ := cmd.Flags().GetString("on")
		c := newClient()
		if err := c.DeleteDependency(args[0], dep); err != nil {
			return err
		}
		return output.JSON(os.Stdout, map[string]any{
			"deleted":    true,
			"task_id":    args[0],
			"depends_on": dep,
		})
	},
}

var taskUploadCmd = &cobra.Command{
	Use:   "upload <id>",
	Short: "Attach an image file to a task",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		path, _ := cmd.Flags().GetString("file")
		c := newClient()
		img, err := c.UploadImage(args[0], path)
		if err != nil {
			return err
		}
		return output.JSON(os.Stdout, img)
	},
}

var taskDocCmd = &cobra.Command{
	Use:   "doc",
	Short: "Manage markdown docs attached to tasks",
}

var taskDocCreateCmd = &cobra.Command{
	Use:   "create <task-id>",
	Short: "Attach a markdown document to a task",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		title, _ := cmd.Flags().GetString("title")
		filePath, _ := cmd.Flags().GetString("file")
		content, err := os.ReadFile(filePath)
		if err != nil {
			return err
		}
		c := newClient()
		doc, err := c.CreateDoc(args[0], client.CreateDocInput{
			Title:   title,
			Content: string(content),
		})
		if err != nil {
			return err
		}
		return output.Render(os.Stdout, output.Resolve(formatFlag), doc, func(w io.Writer) {
			renderDocTable(w, []client.Doc{*doc})
		})
	},
}

var taskDocGetCmd = &cobra.Command{
	Use:   "get <doc-id>",
	Short: "Fetch a markdown document by id",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		c := newClient()
		doc, err := c.GetDoc(args[0])
		if err != nil {
			return err
		}
		return output.Render(os.Stdout, output.Resolve(formatFlag), doc, func(w io.Writer) {
			renderDocTable(w, []client.Doc{*doc})
		})
	},
}

var taskDocUpdateCmd = &cobra.Command{
	Use:   "update <doc-id>",
	Short: "Update a markdown document title and/or content",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		in := client.UpdateDocInput{}
		if cmd.Flags().Changed("title") {
			v, _ := cmd.Flags().GetString("title")
			in.Title = &v
		}
		if cmd.Flags().Changed("file") {
			filePath, _ := cmd.Flags().GetString("file")
			content, err := os.ReadFile(filePath)
			if err != nil {
				return err
			}
			v := string(content)
			in.Content = &v
		}
		if in.Title == nil && in.Content == nil {
			return errors.New("at least one of --title or --file is required")
		}
		c := newClient()
		doc, err := c.UpdateDoc(args[0], in)
		if err != nil {
			return err
		}
		return output.Render(os.Stdout, output.Resolve(formatFlag), doc, func(w io.Writer) {
			renderDocTable(w, []client.Doc{*doc})
		})
	},
}

var taskDocDeleteCmd = &cobra.Command{
	Use:   "delete <doc-id>",
	Short: "Remove a markdown document by id",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		c := newClient()
		if err := c.DeleteDoc(args[0]); err != nil {
			return err
		}
		return output.JSON(os.Stdout, map[string]any{"deleted": true, "id": args[0]})
	},
}

var taskLinkCmd = &cobra.Command{
	Use:   "link <task-id>",
	Short: "Attach a URL (spec doc, PR, technical note…) to a task",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		url, _ := cmd.Flags().GetString("url")
		label, _ := cmd.Flags().GetString("label")
		c := newClient()
		link, err := c.AddLink(args[0], client.AddLinkInput{URL: url, Label: label})
		if err != nil {
			return err
		}
		return output.JSON(os.Stdout, link)
	},
}

var taskUnlinkCmd = &cobra.Command{
	Use:   "unlink <link-id>",
	Short: "Remove a previously-attached link by its id",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		c := newClient()
		if err := c.DeleteLink(args[0]); err != nil {
			return err
		}
		return output.JSON(os.Stdout, map[string]any{"deleted": true, "id": args[0]})
	},
}

func renderTaskTable(w io.Writer, ts []client.Task) {
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "ID\tSTATE\tTYPE\tPRIO\tLABELS\tTITLE\tDEPS")
	for _, t := range ts {
		deps := "-"
		if len(t.DependsOn) > 0 {
			short := make([]string, 0, len(t.DependsOn))
			for _, d := range t.DependsOn {
				short = append(short, shortID(d))
			}
			deps = strings.Join(short, ",")
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\t%d\t%s\t%s\t%s\n",
			shortID(t.ID), t.State, t.Type, t.Priority, renderLabels(t.Labels), trimRune(t.Title, 50), deps)
	}
	tw.Flush()
}

func renderLabels(labels []string) string {
	if len(labels) == 0 {
		return "-"
	}
	return trimRune(strings.Join(labels, ","), 40)
}

func renderDocTable(w io.Writer, docs []client.Doc) {
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "ID\tTASK\tTITLE\tURL")
	for _, doc := range docs {
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n",
			shortID(doc.ID), shortID(doc.TaskID), trimRune(doc.Title, 50), doc.URL)
	}
	tw.Flush()
}
