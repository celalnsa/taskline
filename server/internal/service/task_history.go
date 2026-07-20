package service

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"taskline_server/api/model"
)

type taskActorContextKey struct{}

// WithActor attaches the user-facing mutation actor to a request context.
// Registered agent names are resolved by the handler before they reach here.
func WithActor(ctx context.Context, actor string) context.Context {
	return context.WithValue(ctx, taskActorContextKey{}, strings.TrimSpace(actor))
}

func actorFromContext(ctx context.Context) string {
	if actor, ok := ctx.Value(taskActorContextKey{}).(string); ok {
		if actor = strings.TrimSpace(actor); actor != "" {
			return actor
		}
	}
	return "system"
}

// ListTaskEvents returns the complete task history newest first.
func (s *Service) ListTaskEvents(ctx context.Context, taskID string) ([]*model.TaskEvent, error) {
	return s.st.ListTaskEvents(ctx, taskID)
}

func (s *Service) recordTaskEvent(
	ctx context.Context,
	taskID, action, summary string,
	details map[string]any,
	createdAt int64,
) error {
	event := &model.TaskEvent{
		TaskID: taskID, Actor: actorFromContext(ctx), Action: action,
		Summary: summary, Details: details, CreatedAt: createdAt,
	}
	if err := s.st.AddTaskEvent(ctx, event); err != nil {
		return fmt.Errorf("record task history: %w", err)
	}
	return nil
}

func taskSnapshot(task *model.Task) map[string]any {
	return map[string]any{
		"title":       task.Title,
		"description": task.Description,
		"type":        task.Type,
		"state":       task.State,
		"priority":    task.Priority,
		"labels":      task.Labels,
	}
}

func taskFieldChanges(before, after *model.Task) map[string]any {
	changes := make(map[string]any)
	addChange := func(field string, oldValue, newValue any) {
		changes[field] = map[string]any{"before": oldValue, "after": newValue}
	}
	if before.Title != after.Title {
		addChange("title", before.Title, after.Title)
	}
	if before.Description != after.Description {
		addChange("description", before.Description, after.Description)
	}
	if before.Type != after.Type {
		addChange("type", before.Type, after.Type)
	}
	if before.State != after.State {
		addChange("state", before.State, after.State)
	}
	if before.Priority != after.Priority {
		addChange("priority", before.Priority, after.Priority)
	}
	if !slices.Equal(before.Labels, after.Labels) {
		addChange("labels", before.Labels, after.Labels)
	}
	return changes
}

func updatedTaskSummary(changes map[string]any) string {
	order := []string{"title", "description", "type", "state", "priority", "labels"}
	fields := make([]string, 0, len(changes))
	for _, field := range order {
		if _, ok := changes[field]; ok {
			fields = append(fields, field)
		}
	}
	if len(fields) == 0 {
		return "Updated task"
	}
	return "Updated " + joinSummaryFields(fields)
}

func joinSummaryFields(fields []string) string {
	switch len(fields) {
	case 0:
		return ""
	case 1:
		return fields[0]
	case 2:
		return fields[0] + " and " + fields[1]
	default:
		return strings.Join(fields[:len(fields)-1], ", ") + ", and " + fields[len(fields)-1]
	}
}
