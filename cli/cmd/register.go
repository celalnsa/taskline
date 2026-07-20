package cmd

import (
	"io"
	"os"

	"github.com/spf13/cobra"

	"cli.taskline.dev/client"
	"cli.taskline.dev/internal/identity"
	"cli.taskline.dev/internal/output"
)

func init() {
	rootCmd.AddCommand(registerCmd)
	registerCmd.Flags().String("name", "", "agent name for this working directory (required)")
	_ = registerCmd.MarkFlagRequired("name")
}

type registerOutput struct {
	Agent      client.Agent `json:"agent"`
	Server     string       `json:"server"`
	ConfigPath string       `json:"config_path"`
}

var registerCmd = &cobra.Command{
	Use:   "register",
	Short: "Register this working directory as a taskline agent",
	RunE: func(cmd *cobra.Command, args []string) error {
		name, _ := cmd.Flags().GetString("name")
		return runRegister(os.Stdout, name, resolveServer(), output.Resolve(formatFlag))
	},
}

func runRegister(w io.Writer, name, server string, format output.Format) error {
	c := client.New(server)
	if current, ok, err := identity.Load(server); err != nil {
		return err
	} else if ok {
		c.Token = current.Token
	}
	reg, err := c.RegisterAgent(client.RegisterAgentInput{Name: name})
	if err != nil {
		return err
	}
	path, err := identity.Save(identity.Identity{
		Server: server,
		Agent: identity.Agent{
			ID:   reg.Agent.ID,
			Name: reg.Agent.Name,
		},
		Token: reg.Token,
	})
	if err != nil {
		return err
	}
	out := registerOutput{Agent: reg.Agent, Server: server, ConfigPath: path}
	return output.Render(w, format, out, func(tableWriter io.Writer) {
		renderRegisterTable(tableWriter, out)
	})
}

func renderRegisterTable(w io.Writer, out registerOutput) {
	_, _ = io.WriteString(w, "AGENT\tSERVER\tCONFIG\n")
	_, _ = io.WriteString(w, out.Agent.Name+"\t"+out.Server+"\t"+out.ConfigPath+"\n")
}
