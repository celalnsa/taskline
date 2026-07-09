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
		server := resolveServer()
		c := client.New(server)
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
		return output.Render(os.Stdout, output.Resolve(formatFlag), out, func(w io.Writer) {
			renderRegisterTable(w, out)
		})
	},
}

func renderRegisterTable(w io.Writer, out registerOutput) {
	_, _ = io.WriteString(w, "AGENT\tSERVER\tCONFIG\n")
	_, _ = io.WriteString(w, out.Agent.Name+"\t"+out.Server+"\t"+out.ConfigPath+"\n")
}
