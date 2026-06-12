package service_test

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"taskline_server/api/model"
	"taskline_server/internal/service"
	"taskline_server/internal/store"
)

func ptrState(s model.TaskState) *model.TaskState { return &s }

func newSvc(t *testing.T) *service.Service {
	t.Helper()
	st, err := store.New(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = st.Close() })
	return service.New(st)
}

func TestResolveProjectByIdOrName(t *testing.T) {
	ctx := context.Background()
	s := newSvc(t)
	p, err := s.CreateProject(ctx, "alpha", "")
	require.NoError(t, err)

	gotByName, err := s.ResolveProject(ctx, "alpha")
	require.NoError(t, err)
	require.Equal(t, p.ID, gotByName.ID)

	gotByID, err := s.ResolveProject(ctx, p.ID)
	require.NoError(t, err)
	require.Equal(t, "alpha", gotByID.Name)

	_, err = s.ResolveProject(ctx, "missing")
	require.Error(t, err)
}

func TestUpdateTaskAllowsBackwardTransition(t *testing.T) {
	ctx := context.Background()
	s := newSvc(t)
	p, _ := s.CreateProject(ctx, "p", "")
	tk, _ := s.CreateTask(ctx, p.ID, "t", "", model.TaskTypeFeature, 0, true)

	// Forward skip is fine.
	got, err := s.UpdateTask(ctx, tk.ID, store.TaskUpdate{State: ptrState(model.StateReview)})
	require.NoError(t, err)
	require.Equal(t, model.StateReview, got.State)

	// Backward move (review → dev) is also accepted now: a review can
	// surface a defect that needs to drop the task back to dev.
	got, err = s.UpdateTask(ctx, tk.ID, store.TaskUpdate{State: ptrState(model.StateDev)})
	require.NoError(t, err)
	require.Equal(t, model.StateDev, got.State)

	// The local verification stage is a normal in-progress state.
	got, err = s.UpdateTask(ctx, tk.ID, store.TaskUpdate{State: ptrState(model.StateTest)})
	require.NoError(t, err)
	require.Equal(t, model.StateTest, got.State)
}

func TestUpdateTaskRejectsUnknownState(t *testing.T) {
	ctx := context.Background()
	s := newSvc(t)
	p, _ := s.CreateProject(ctx, "p", "")
	tk, _ := s.CreateTask(ctx, p.ID, "t", "", model.TaskTypeFeature, 0, true)

	_, err := s.UpdateTask(ctx, tk.ID, store.TaskUpdate{State: ptrState(model.TaskState("bogus"))})
	require.Error(t, err)
	require.True(t, strings.Contains(err.Error(), "invalid"))
}

func TestCreateTaskAcceptsDocsType(t *testing.T) {
	ctx := context.Background()
	s := newSvc(t)
	p, _ := s.CreateProject(ctx, "p", "")

	tk, err := s.CreateTask(ctx, p.ID, "refresh docs", "", model.TaskTypeDocs, 0, true)
	require.NoError(t, err)
	require.Equal(t, model.TaskTypeDocs, tk.Type)
	require.Equal(t, model.StateStart, tk.State)
}

func TestSearchTasksRanksShortIDsAndKeywords(t *testing.T) {
	ctx := context.Background()
	s := newSvc(t)
	p, _ := s.CreateProject(ctx, "p", "")
	other, _ := s.CreateProject(ctx, "other", "")

	eval, err := s.CreateTask(
		ctx,
		p.ID,
		"Agent capability evaluation harness",
		"Build tools, sandbox, and hooks coverage.",
		model.TaskTypeFeature,
		1,
		true,
		[]string{"evaluation", "tools"},
	)
	require.NoError(t, err)
	search, err := s.CreateTask(
		ctx,
		p.ID,
		"Task search command",
		"Find historical task context from the CLI.",
		model.TaskTypeFeature,
		5,
		true,
		[]string{"cli"},
	)
	require.NoError(t, err)
	_, err = s.CreateTask(ctx, other.ID, "Task search command", "wrong project", model.TaskTypeFeature, 99, true)
	require.NoError(t, err)

	byShortID, err := s.SearchTasks(ctx, p.ID, eval.ID[:8], 10)
	require.NoError(t, err)
	require.Len(t, byShortID, 1)
	require.Equal(t, eval.ID, byShortID[0].ID)

	byKeywords, err := s.SearchTasks(ctx, p.ID, "evaluation sandbox", 10)
	require.NoError(t, err)
	require.NotEmpty(t, byKeywords)
	require.Equal(t, eval.ID, byKeywords[0].ID)

	byDescription, err := s.SearchTasks(ctx, p.ID, "historical context", 10)
	require.NoError(t, err)
	require.Len(t, byDescription, 1)
	require.Equal(t, search.ID, byDescription[0].ID)

	_, err = s.SearchTasks(ctx, p.ID, "   ", 10)
	require.Error(t, err)
}

func TestNextRunnableTaskReturnsNilWhenNothingRunnable(t *testing.T) {
	ctx := context.Background()
	s := newSvc(t)
	p, _ := s.CreateProject(ctx, "p", "")
	tk, _ := s.CreateTask(ctx, p.ID, "t", "", model.TaskTypeFeature, 0, true)

	stDone := model.StateDone
	_, err := s.UpdateTask(ctx, tk.ID, store.TaskUpdate{State: &stDone})
	require.NoError(t, err)

	got, err := s.NextRunnableTask(ctx, p.ID)
	require.NoError(t, err)
	require.Nil(t, got)
}

func TestAddDependencyValidatesBothTasks(t *testing.T) {
	ctx := context.Background()
	s := newSvc(t)
	p, _ := s.CreateProject(ctx, "p", "")
	a, _ := s.CreateTask(ctx, p.ID, "a", "", model.TaskTypeFeature, 0, true)

	// Dependency on non-existent task → error mentions the dep id.
	err := s.AddDependency(ctx, a.ID, "no-such")
	require.Error(t, err)
	require.True(t, strings.Contains(err.Error(), "no-such"))
}

func TestCreateTaskAutoStartFalseLandsInPending(t *testing.T) {
	ctx := context.Background()
	s := newSvc(t)
	p, _ := s.CreateProject(ctx, "p", "")

	parked, err := s.CreateTask(ctx, p.ID, "later", "", model.TaskTypeFeature, 0, false)
	require.NoError(t, err)
	require.Equal(t, model.StatePending, parked.State)

	// Pending tasks must NOT show up in the runnable queue.
	got, err := s.NextRunnableTask(ctx, p.ID)
	require.NoError(t, err)
	require.Nil(t, got)

	// Promoting it to start makes it runnable.
	stStart := model.StateStart
	_, err = s.UpdateTask(ctx, parked.ID, store.TaskUpdate{State: &stStart})
	require.NoError(t, err)
	got, err = s.NextRunnableTask(ctx, p.ID)
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Equal(t, parked.ID, got.ID)
}

func TestCreateTaskAutoStartTrueLandsInStart(t *testing.T) {
	ctx := context.Background()
	s := newSvc(t)
	p, _ := s.CreateProject(ctx, "p", "")

	tk, err := s.CreateTask(ctx, p.ID, "go", "", model.TaskTypeFeature, 0, true)
	require.NoError(t, err)
	require.Equal(t, model.StateStart, tk.State)
}

// AddLink must reject anything that isn't http(s). The web renders these
// in <a href=…> and a `javascript:` (or `data:`, `file:`, …) URI would
// otherwise be a stored-XSS sink.
func TestAddLinkRejectsUnsafeSchemes(t *testing.T) {
	ctx := context.Background()
	s := newSvc(t)
	p, _ := s.CreateProject(ctx, "p", "")
	tk, _ := s.CreateTask(ctx, p.ID, "t", "", model.TaskTypeFeature, 0, true)

	for _, bad := range []string{
		"javascript:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"file:///etc/passwd",
		"vbscript:msgbox",
		"chrome://settings",
		"",
	} {
		_, err := s.AddLink(ctx, tk.ID, bad, "")
		require.Error(t, err, "bad url should be rejected: %q", bad)
	}

	// Missing host (e.g. "http:" or "https:///") is also rejected.
	_, err := s.AddLink(ctx, tk.ID, "https:///path", "")
	require.Error(t, err)

	// And anything http(s) with a real host is accepted.
	link, err := s.AddLink(ctx, tk.ID, "https://example.com/plan", "Plan")
	require.NoError(t, err)
	require.Equal(t, "https://example.com/plan", link.URL)
	require.Equal(t, "Plan", link.Label)

	// Missing task surfaces as ErrNotFound from the store FK check.
	_, err = s.AddLink(ctx, "no-such-task", "https://x.test", "")
	require.ErrorIs(t, err, store.ErrNotFound)
}
