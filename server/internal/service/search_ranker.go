package service

import (
	"sort"
	"strings"

	"taskline_server/api/model"
)

type taskSearchRanker struct{}

func newTaskSearchRanker() taskSearchRanker {
	return taskSearchRanker{}
}

func (r taskSearchRanker) Rank(tasks []*model.Task, query string, limit int) []*model.Task {
	normalizedQuery := normalizeTaskSearchText(query)
	terms := taskSearchTerms(normalizedQuery)
	type scoredTask struct {
		task  *model.Task
		score int
	}
	scored := make([]scoredTask, 0, len(tasks))
	for _, task := range tasks {
		score := r.scoreNormalized(task, normalizedQuery, terms)
		if score > 0 {
			scored = append(scored, scoredTask{task: task, score: score})
		}
	}
	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		if scored[i].task.Priority != scored[j].task.Priority {
			return scored[i].task.Priority > scored[j].task.Priority
		}
		return scored[i].task.CreatedAt < scored[j].task.CreatedAt
	})
	if limit > 0 && len(scored) > limit {
		scored = scored[:limit]
	}
	out := make([]*model.Task, 0, len(scored))
	for _, item := range scored {
		out = append(out, item.task)
	}
	return out
}

func (r taskSearchRanker) score(task *model.Task, query string) int {
	normalizedQuery := normalizeTaskSearchText(query)
	return r.scoreNormalized(task, normalizedQuery, taskSearchTerms(normalizedQuery))
}

func (r taskSearchRanker) scoreNormalized(task *model.Task, query string, terms []string) int {
	if task == nil {
		return 0
	}
	score := 0
	id := task.ID
	if query == id {
		score += 20000
	} else if len(query) >= 4 && strings.HasPrefix(id, query) {
		score += 15000
	} else if len(query) >= 4 && strings.Contains(id, query) {
		score += 8000
	}

	title := normalizeTaskSearchText(task.Title)
	description := normalizeTaskSearchText(task.Description)
	labels := ""
	if len(task.Labels) > 0 {
		labels = normalizeTaskSearchText(strings.Join(task.Labels, " "))
	}
	taskType := string(task.Type)
	state := string(task.State)

	if query != "" {
		if strings.Contains(title, query) {
			score += 2000
		}
		if strings.Contains(description, query) {
			score += 800
		}
		if strings.Contains(labels, query) {
			score += 600
		}
		if query == taskType || query == state {
			score += 400
		}
	}

	for _, term := range terms {
		if strings.Contains(title, term) {
			score += 250
		}
		if strings.Contains(description, term) {
			score += 100
		}
		if strings.Contains(labels, term) {
			score += 150
		}
		if term == taskType || term == state {
			score += 80
		}
	}
	return score
}

func normalizeTaskSearchText(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

func taskSearchTerms(query string) []string {
	raw := strings.Fields(query)
	terms := make([]string, 0, len(raw))
	seen := map[string]struct{}{}
	for _, term := range raw {
		if _, ok := seen[term]; ok {
			continue
		}
		seen[term] = struct{}{}
		terms = append(terms, term)
	}
	return terms
}
