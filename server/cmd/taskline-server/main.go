package main

import (
	"fmt"
	"log/slog"
	"os"

	"github.com/cloudwego/hertz/pkg/app/server"

	"taskline_server/api/handler"
	"taskline_server/internal/config"
	"taskline_server/internal/service"
	"taskline_server/internal/store"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	cfg, err := config.Load("")
	if err != nil {
		logger.Error("load config", "err", err)
		os.Exit(1)
	}
	logger.Info("config loaded", "db", cfg.DBPath, "listen", cfg.ListenAddr, "images", cfg.ImagesDir, "docs", cfg.DocsDir)

	st, err := store.New(cfg.DBPath)
	if err != nil {
		logger.Error("open store", "err", err)
		os.Exit(1)
	}
	defer func() { _ = st.Close() }()

	svc := service.New(st)
	h := handler.New(svc, cfg)

	hz := server.Default(server.WithHostPorts(cfg.ListenAddr))
	h.Register(hz)

	fmt.Fprintf(os.Stderr, "taskline-server listening on %s\n", cfg.ListenAddr)
	hz.Spin()
}
