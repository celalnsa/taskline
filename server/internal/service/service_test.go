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
}

func TestUpdateTaskRejectsUnknownState(t *testing.T) {
	ctx := context.Background()
	s := newSvc(t)
	p, _ := s.CreateProject(ctx, "p", "")
	tk, _ := s.CreateTask(ctx, p.ID, "t", "", model.TaskTypeFeature, 0, true)

	// 'test' was retired — passing it should be rejected as invalid.
	_, err := s.UpdateTask(ctx, tk.ID, store.TaskUpdate{State: ptrState(model.TaskState("test"))})
	require.Error(t, err)
	require.True(t, strings.Contains(err.Error(), "invalid"))
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
