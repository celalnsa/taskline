package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Config holds runtime configuration for the server.
//
// Source order (later overrides earlier):
//
//  1. Built-in defaults
//  2. .env file in CWD (or path passed to Load)
//  3. Process environment
//
// Knobs:
//
//	TASKLINE_DB         — sqlite file path (default ./data/taskline.db)
//	TASKLINE_LISTEN     — listen addr (default :8787)
//	TASKLINE_IMAGES_DIR — image storage dir (default ./data/images)
//	TASKLINE_DOCS_DIR   — markdown doc storage dir (default ./data/docs)
type Config struct {
	DBPath     string
	ListenAddr string
	ImagesDir  string
	DocsDir    string
}

// Load reads .env from envPath (empty = "./.env"), merges with the process
// environment, and returns a populated Config. Missing .env is not an error.
func Load(envPath string) (*Config, error) {
	if envPath == "" {
		envPath = ".env"
	}
	// Apply .env without overriding pre-existing env vars.
	if err := loadDotEnv(envPath); err != nil {
		return nil, err
	}

	c := &Config{
		DBPath:     getenv("TASKLINE_DB", "./data/taskline.db"),
		ListenAddr: getenv("TASKLINE_LISTEN", ":8787"),
		ImagesDir:  getenv("TASKLINE_IMAGES_DIR", "./data/images"),
		DocsDir:    getenv("TASKLINE_DOCS_DIR", "./data/docs"),
	}

	if dir := filepath.Dir(c.DBPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, fmt.Errorf("create db dir: %w", err)
		}
	}
	if err := os.MkdirAll(c.ImagesDir, 0o700); err != nil {
		return nil, fmt.Errorf("create images dir: %w", err)
	}
	if err := os.MkdirAll(c.DocsDir, 0o700); err != nil {
		return nil, fmt.Errorf("create docs dir: %w", err)
	}
	return c, nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// loadDotEnv applies KEY=VALUE pairs from path. Existing env vars win.
// Missing file is silently ignored.
func loadDotEnv(path string) error {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			continue
		}
		k := strings.TrimSpace(line[:eq])
		v := strings.TrimSpace(line[eq+1:])
		// Strip surrounding quotes.
		if len(v) >= 2 && (v[0] == '"' && v[len(v)-1] == '"' || v[0] == '\'' && v[len(v)-1] == '\'') {
			v = v[1 : len(v)-1]
		}
		if _, present := os.LookupEnv(k); !present {
			if err := os.Setenv(k, v); err != nil {
				return err
			}
		}
	}
	return scanner.Err()
}
