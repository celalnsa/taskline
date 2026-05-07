package store_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"taskline_server/api/model"
	"taskline_server/internal/store"
)

func newTestStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.New(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func TestProjectCRUD(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)

	p, err := st.CreateProject(ctx, "demo", "first project")
	require.NoError(t, err)
	require.NotEmpty(t, p.ID)
	require.Equal(t, "demo", p.Name)

	got, err := st.GetProjectByName(ctx, "demo")
	require.NoError(t, err)
	require.Equal(t, p.ID, got.ID)

	got2, err := st.GetProjectByID(ctx, p.ID)
	require.NoError(t, err)
	require.Equal(t, p.Name, got2.Name)

	// Duplicate name → conflict.
	_, err = st.CreateProject(ctx, "demo", "")
	require.ErrorIs(t, err, store.ErrConflict)

	all, err := st.ListProjects(ctx)
	require.NoError(t, err)
	require.Len(t, all, 1)
}

func TestTaskCreateAndState(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	p, err := st.CreateProject(ctx, "p1", "")
	require.NoError(t, err)

	tk, err := st.CreateTask(ctx, p.ID, "first", "desc", model.TaskTypeFeature, 1)
	require.NoError(t, err)
	require.Equal(t, model.StateCreated, tk.State)
	require.Equal(t, model.TaskTypeFeature, tk.Type)

	// Bad project id → not found.
	_, err = st.CreateTask(ctx, "no-such-project", "x", "", model.TaskTypeFeature, 0)
	require.ErrorIs(t, err, store.ErrNotFound)

	// Bad type rejected.
	_, err = st.CreateTask(ctx, p.ID, "x", "", model.TaskType("bogus"), 0)
	require.Error(t, err)
}

func TestStateTransitionRules(t *testing.T) {
	// Forward jumps are allowed.
	require.NoError(t, model.StateCreated.CanTransitionTo(model.StateDesign))
	require.NoError(t, model.StateCreated.CanTransitionTo(model.StateDone))
	// Backward moves are allowed too — the workflow no longer enforces direction.
	require.NoError(t, model.StateReview.CanTransitionTo(model.StateDev))
	require.NoError(t, model.StateDone.CanTransitionTo(model.StateCreated))
	// Unknown state names still fail validation.
	require.Error(t, model.TaskState("bogus").CanTransitionTo(model.StateDev))
	require.Error(t, model.StateDev.CanTransitionTo(model.TaskState("test")))
}

func TestUpdateTaskAndDelete(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	p, _ := st.CreateProject(ctx, "p", "")
	tk, _ := st.CreateTask(ctx, p.ID, "t", "", model.TaskTypeFeature, 0)

	newTitle := "renamed"
	newPrio := 7
	got, err := st.UpdateTask(ctx, tk.ID, store.TaskUpdate{Title: &newTitle, Priority: &newPrio})
	require.NoError(t, err)
	require.Equal(t, "renamed", got.Title)
	require.Equal(t, 7, got.Priority)

	require.NoError(t, st.DeleteTask(ctx, tk.ID))
	require.True(t, errors.Is(st.DeleteTask(ctx, tk.ID), store.ErrNotFound))
}

func TestDependencyCycleProtection(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	p, _ := st.CreateProject(ctx, "p", "")
	a, _ := st.CreateTask(ctx, p.ID, "a", "", model.TaskTypeFeature, 0)
	b, _ := st.CreateTask(ctx, p.ID, "b", "", model.TaskTypeFeature, 0)
	c, _ := st.CreateTask(ctx, p.ID, "c", "", model.TaskTypeFeature, 0)

	require.NoError(t, st.AddDependency(ctx, b.ID, a.ID))
	require.NoError(t, st.AddDependency(ctx, c.ID, b.ID))

	// Adding (a depends on c) would close the loop a -> c -> b -> a.
	err := st.AddDependency(ctx, a.ID, c.ID)
	require.ErrorIs(t, err, store.ErrConflict)

	// Self-dep refused.
	err = st.AddDependency(ctx, a.ID, a.ID)
	require.ErrorIs(t, err, store.ErrConflict)

	// Idempotent re-add of an existing edge succeeds.
	require.NoError(t, st.AddDependency(ctx, b.ID, a.ID))
}

func TestRunnableTasksRespectsDependencies(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	p, _ := st.CreateProject(ctx, "p", "")
	a, _ := st.CreateTask(ctx, p.ID, "a", "", model.TaskTypeFeature, 1)
	b, _ := st.CreateTask(ctx, p.ID, "b", "", model.TaskTypeFeature, 5)
	c, _ := st.CreateTask(ctx, p.ID, "c", "", model.TaskTypeFeature, 9)

	require.NoError(t, st.AddDependency(ctx, b.ID, a.ID))
	require.NoError(t, st.AddDependency(ctx, c.ID, b.ID))

	// Initially only `a` is runnable (no deps).
	rs, err := st.ListRunnableTasks(ctx, p.ID)
	require.NoError(t, err)
	require.Len(t, rs, 1)
	require.Equal(t, a.ID, rs[0].ID)

	// Mark a done → b becomes runnable. c still blocked.
	stDone := model.StateDone
	_, err = st.UpdateTask(ctx, a.ID, store.TaskUpdate{State: &stDone})
	require.NoError(t, err)
	rs, _ = st.ListRunnableTasks(ctx, p.ID)
	require.Len(t, rs, 1)
	require.Equal(t, b.ID, rs[0].ID)

	// Mark b done → c finally runnable.
	_, err = st.UpdateTask(ctx, b.ID, store.TaskUpdate{State: &stDone})
	require.NoError(t, err)
	rs, _ = st.ListRunnableTasks(ctx, p.ID)
	require.Len(t, rs, 1)
	require.Equal(t, c.ID, rs[0].ID)
}

func TestRunnableTasksOrderedByPriority(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	p, _ := st.CreateProject(ctx, "p", "")
	low, _ := st.CreateTask(ctx, p.ID, "low", "", model.TaskTypeFeature, 1)
	high, _ := st.CreateTask(ctx, p.ID, "high", "", model.TaskTypeFeature, 9)
	mid, _ := st.CreateTask(ctx, p.ID, "mid", "", model.TaskTypeFeature, 5)

	rs, err := st.ListRunnableTasks(ctx, p.ID)
	require.NoError(t, err)
	require.Len(t, rs, 3)
	require.Equal(t, high.ID, rs[0].ID)
	require.Equal(t, mid.ID, rs[1].ID)
	require.Equal(t, low.ID, rs[2].ID)
}

func TestListTasksFilteredByState(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	p, _ := st.CreateProject(ctx, "p", "")
	_, _ = st.CreateTask(ctx, p.ID, "a", "", model.TaskTypeFeature, 0)
	t2, _ := st.CreateTask(ctx, p.ID, "b", "", model.TaskTypeFeature, 0)
	stDev := model.StateDev
	_, _ = st.UpdateTask(ctx, t2.ID, store.TaskUpdate{State: &stDev})

	all, err := st.ListTasks(ctx, store.TaskFilter{ProjectID: p.ID})
	require.NoError(t, err)
	require.Len(t, all, 2)

	devOnly, err := st.ListTasks(ctx, store.TaskFilter{ProjectID: p.ID, States: []model.TaskState{model.StateDev}})
	require.NoError(t, err)
	require.Len(t, devOnly, 1)
	require.Equal(t, t2.ID, devOnly[0].ID)
}

// TestMigrationsRunOnceAcrossReopens verifies that PRAGMA user_version
// gates migration application: after a first open the version is at
// the latest entry in schemaMigrations, and a second open against the
// same file is effectively a no-op. We use a temp file because
// :memory: is per-connection and would defeat the test.
func TestMigrationsRunOnceAcrossReopens(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "taskline.db")

	st1, err := store.New(path)
	require.NoError(t, err)

	v1, err := readUserVersion(path)
	require.NoError(t, err)
	require.GreaterOrEqual(t, v1, 2, "first open should advance to >=2")

	require.NoError(t, st1.Close())

	st2, err := store.New(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = st2.Close() })

	v2, err := readUserVersion(path)
	require.NoError(t, err)
	require.Equal(t, v1, v2, "re-opening must not change user_version")
}

// readUserVersion opens a side-channel SQL handle to inspect the
// PRAGMA without going through the Store API.
func readUserVersion(path string) (int, error) {
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		return 0, err
	}
	defer db.Close()
	var v int
	err = db.QueryRowContext(context.Background(), "PRAGMA user_version").Scan(&v)
	return v, err
}
