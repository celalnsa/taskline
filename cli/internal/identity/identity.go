package identity

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	dirName  = ".config/taskline"
	fileName = "agent.json"
)

type Identity struct {
	Server string `json:"server"`
	Agent  Agent  `json:"agent"`
	Token  string `json:"token"`
}

type Agent struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func Path() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	return filepath.Join(wd, dirName, fileName), nil
}

func Load(server string) (*Identity, bool, error) {
	path, err := Path()
	if err != nil {
		return nil, false, err
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	var id Identity
	if err := json.Unmarshal(raw, &id); err != nil {
		return nil, false, fmt.Errorf("read %s: %w", path, err)
	}
	id.Server = strings.TrimRight(id.Server, "/")
	if id.Server != strings.TrimRight(server, "/") {
		return nil, false, fmt.Errorf(
			"agent identity in %s is for %s, current server is %s; correct TASKLINE_SERVER or remove the local identity before intentional re-registration",
			path,
			id.Server,
			strings.TrimRight(server, "/"),
		)
	}
	if strings.TrimSpace(id.Token) == "" || strings.TrimSpace(id.Agent.Name) == "" {
		return nil, false, fmt.Errorf(
			"agent identity in %s is incomplete; repair or remove it before registering again",
			path,
		)
	}
	return &id, true, nil
}

func Save(id Identity) (string, error) {
	path, err := Path()
	if err != nil {
		return "", err
	}
	id.Server = strings.TrimRight(id.Server, "/")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	raw, err := json.MarshalIndent(id, "", "  ")
	if err != nil {
		return "", err
	}
	raw = append(raw, '\n')
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return "", err
	}
	return path, nil
}
