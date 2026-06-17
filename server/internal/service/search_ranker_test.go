package service

import (
	"testing"

	"github.com/stretchr/testify/require"

	"taskline_server/api/model"
)

func TestTaskSearchRankerScoresLexicalFields(t *testing.T) {
	ranker := newTaskSearchRanker()

	tests := []struct {
		name  string
		task  *model.Task
		query string
		want  int
	}{
		{
			name:  "exact id",
			task:  searchTask("fc7a0732-0000-0000-0000-000000000001", "", "", model.TaskTypeFeature, model.StateStart, nil, 0, 0),
			query: "fc7a0732-0000-0000-0000-000000000001",
			want:  20000,
		},
		{
			name:  "short id prefix",
			task:  searchTask("fc7a0732-0000-0000-0000-000000000001", "", "", model.TaskTypeFeature, model.StateStart, nil, 0, 0),
			query: "fc7a",
			want:  15000,
		},
		{
			name:  "short id contains",
			task:  searchTask("fc7a0732-0000-0000-0000-000000000001", "", "", model.TaskTypeFeature, model.StateStart, nil, 0, 0),
			query: "0732",
			want:  8000,
		},
		{
			name:  "title",
			task:  searchTask("aaaaaaaa-0000-0000-0000-000000000001", "Agent Hooks", "", model.TaskTypeFeature, model.StateStart, nil, 0, 0),
			query: "agent",
			want:  2250,
		},
		{
			name:  "description",
			task:  searchTask("aaaaaaaa-0000-0000-0000-000000000001", "", "Agent hooks and runtime context", model.TaskTypeFeature, model.StateStart, nil, 0, 0),
			query: "agent",
			want:  900,
		},
		{
			name:  "labels",
			task:  searchTask("aaaaaaaa-0000-0000-0000-000000000001", "", "", model.TaskTypeFeature, model.StateStart, []string{"agent", "runtime"}, 0, 0),
			query: "agent",
			want:  750,
		},
		{
			name:  "type",
			task:  searchTask("aaaaaaaa-0000-0000-0000-000000000001", "", "", model.TaskTypeFeature, model.StateStart, nil, 0, 0),
			query: "feature",
			want:  480,
		},
		{
			name:  "state",
			task:  searchTask("aaaaaaaa-0000-0000-0000-000000000001", "", "", model.TaskTypeFeature, model.StateReview, nil, 0, 0),
			query: "review",
			want:  480,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, ranker.score(tt.task, tt.query))
		})
	}
}

func TestTaskSearchRankerRanksAndLimitsResults(t *testing.T) {
	ranker := newTaskSearchRanker()
	tasks := []*model.Task{
		searchTask("aaaaaaaa-0000-0000-0000-000000000001", "", "Agent runtime context", model.TaskTypeFeature, model.StateStart, nil, 100, 3),
		searchTask("bbbbbbbb-0000-0000-0000-000000000001", "Agent hooks", "", model.TaskTypeFeature, model.StateStart, nil, 1, 2),
		searchTask("cccccccc-0000-0000-0000-000000000001", "", "", model.TaskTypeFeature, model.StateStart, []string{"agent"}, 100, 1),
		searchTask("dddddddd-0000-0000-0000-000000000001", "Unmatched", "", model.TaskTypeFeature, model.StateStart, nil, 100, 0),
	}

	got := ranker.Rank(tasks, "agent", 2)

	require.Equal(t, []string{
		"bbbbbbbb-0000-0000-0000-000000000001",
		"aaaaaaaa-0000-0000-0000-000000000001",
	}, taskIDs(got))
}

func TestTaskSearchRankerBreaksScoreTiesByPriorityThenAge(t *testing.T) {
	ranker := newTaskSearchRanker()
	tasks := []*model.Task{
		searchTask("aaaaaaaa-0000-0000-0000-000000000001", "Agent", "", model.TaskTypeFeature, model.StateStart, nil, 1, 10),
		searchTask("bbbbbbbb-0000-0000-0000-000000000001", "Agent", "", model.TaskTypeFeature, model.StateStart, nil, 5, 20),
		searchTask("cccccccc-0000-0000-0000-000000000001", "Agent", "", model.TaskTypeFeature, model.StateStart, nil, 5, 5),
	}

	got := ranker.Rank(tasks, "agent", 10)

	require.Equal(t, []string{
		"cccccccc-0000-0000-0000-000000000001",
		"bbbbbbbb-0000-0000-0000-000000000001",
		"aaaaaaaa-0000-0000-0000-000000000001",
	}, taskIDs(got))
}

func searchTask(id, title, description string, taskType model.TaskType, state model.TaskState, labels []string, priority int, createdAt int64) *model.Task {
	return &model.Task{
		ID:          id,
		Title:       title,
		Description: description,
		Type:        taskType,
		State:       state,
		Labels:      labels,
		Priority:    priority,
		CreatedAt:   createdAt,
	}
}

func taskIDs(tasks []*model.Task) []string {
	ids := make([]string, 0, len(tasks))
	for _, task := range tasks {
		ids = append(ids, task.ID)
	}
	return ids
}
