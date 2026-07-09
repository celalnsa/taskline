package store_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

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

	tk, err := st.CreateTask(ctx, p.ID, "first", "desc", model.TaskTypeFeature, 1, model.StateStart)
	require.NoError(t, err)
	require.Equal(t, model.StateStart, tk.State)
	require.Equal(t, model.TaskTypeFeature, tk.Type)

	docs, err := st.CreateTask(ctx, p.ID, "docs", "update docs", model.TaskTypeDocs, 0, model.StateStart)
	require.NoError(t, err)
	require.Equal(t, model.TaskTypeDocs, docs.Type)

	// Tasks created in pending preserve that state.
	tkPending, err := st.CreateTask(ctx, p.ID, "later", "", model.TaskTypeFeature, 0, model.StatePending)
	require.NoError(t, err)
	require.Equal(t, model.StatePending, tkPending.State)

	// Bad project id → not found.
	_, err = st.CreateTask(ctx, "no-such-project", "x", "", model.TaskTypeFeature, 0, model.StateStart)
	require.ErrorIs(t, err, store.ErrNotFound)

	// Bad type rejected.
	_, err = st.CreateTask(ctx, p.ID, "x", "", model.TaskType("bogus"), 0, model.StateStart)
	require.Error(t, err)

	// Bad initial state rejected.
	_, err = st.CreateTask(ctx, p.ID, "x", "", model.TaskTypeFeature, 0, model.TaskState("bogus"))
	require.Error(t, err)
}

func TestStateTransitionRules(t *testing.T) {
	// Forward jumps are allowed.
	require.NoError(t, model.StateStart.CanTransitionTo(model.StateSpec))
	require.NoError(t, model.StateStart.CanTransitionTo(model.StateDone))
	// Backward moves are allowed too — the workflow no longer enforces direction.
	require.NoError(t, model.StateReview.CanTransitionTo(model.StateDev))
	require.NoError(t, model.StateDone.CanTransitionTo(model.StateStart))
	// The test stage sits between dev and review, but transitions are still
	// membership-only rather than directionally constrained.
	require.NoError(t, model.StateDev.CanTransitionTo(model.StateTest))
	require.NoError(t, model.StateTest.CanTransitionTo(model.StateReview))
	require.NoError(t, model.StateTest.CanTransitionTo(model.StateDev))
	// Pending may be reached from any state, including done.
	require.NoError(t, model.StateDone.CanTransitionTo(model.StatePending))
	require.NoError(t, model.StateDev.CanTransitionTo(model.StatePending))
	require.NoError(t, model.StatePending.CanTransitionTo(model.StateStart))
	// Unknown state names still fail validation.
	require.Error(t, model.TaskState("bogus").CanTransitionTo(model.StateDev))
	// 'created' was renamed to 'start' — passing it should now be rejected.
	require.Error(t, model.StateDev.CanTransitionTo(model.TaskState("created")))
	// 'design' was renamed to 'spec' — passing it should now be rejected.
	require.Error(t, model.StateDev.CanTransitionTo(model.TaskState("design")))
}

func TestUpdateTaskAndDelete(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	p, _ := st.CreateProject(ctx, "p", "")
	tk, _ := st.CreateTask(ctx, p.ID, "t", "", model.TaskTypeFeature, 0, model.StateStart)

	newTitle := "renamed"
	newPrio := 7
	got, err := st.UpdateTask(ctx, tk.ID, store.TaskUpdate{Title: &newTitle, Priority: &newPrio})
	require.NoError(t, err)
	require.Equal(t, "renamed", got.Title)
	require.Equal(t, 7, got.Priority)

	newType := model.TaskTypeDocs
	got, err = st.UpdateTask(ctx, tk.ID, store.TaskUpdate{Type: &newType})
	require.NoError(t, err)
	require.Equal(t, model.TaskTypeDocs, got.Type)

	require.NoError(t, st.DeleteTask(ctx, tk.ID))
	require.True(t, errors.Is(st.DeleteTask(ctx, tk.ID), store.ErrNotFound))
}

func TestTaskLabels(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	p, _ := st.CreateProject(ctx, "p", "")

	tk, err := st.CreateTask(ctx, p.ID, "labeled", "", model.TaskTypeFeature, 0, model.StateStart, []string{" backend ", "UI", "backend"})
	require.NoError(t, err)
	require.Equal(t, []string{"backend", "UI"}, tk.Labels)

	got, err := st.GetTask(ctx, tk.ID)
	require.NoError(t, err)
	require.Equal(t, []string{"backend", "UI"}, got.Labels)

	listed, err := st.ListTasks(ctx, store.TaskFilter{ProjectID: p.ID})
	require.NoError(t, err)
	require.Len(t, listed, 1)
	require.Equal(t, []string{"backend", "UI"}, listed[0].Labels)

	runnable, err := st.ListRunnableTasks(ctx, p.ID)
	require.NoError(t, err)
	require.Len(t, runnable, 1)
	require.Equal(t, []string{"backend", "UI"}, runnable[0].Labels)

	updatedLabels := []string{" review ", "Frontend"}
	updated, err := st.UpdateTask(ctx, tk.ID, store.TaskUpdate{Labels: &updatedLabels})
	require.NoError(t, err)
	require.Equal(t, []string{"review", "Frontend"}, updated.Labels)

	clearedLabels := []string{}
	cleared, err := st.UpdateTask(ctx, tk.ID, store.TaskUpdate{Labels: &clearedLabels})
	require.NoError(t, err)
	require.Empty(t, cleared.Labels)

	blankLabels := []string{"ok", " "}
	_, err = st.UpdateTask(ctx, tk.ID, store.TaskUpdate{Labels: &blankLabels})
	require.Error(t, err)

	for _, labels := range [][]string{
		{"bad,label"},
		{"bad\tlabel"},
		{"bad\nlabel"},
		{"bad\rlabel"},
	} {
		_, err = st.UpdateTask(ctx, tk.ID, store.TaskUpdate{Labels: &labels})
		require.Error(t, err)
	}
}

func TestDependencyCycleProtection(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	p, _ := st.CreateProject(ctx, "p", "")
	a, _ := st.CreateTask(ctx, p.ID, "a", "", model.TaskTypeFeature, 0, model.StateStart)
	b, _ := st.CreateTask(ctx, p.ID, "b", "", model.TaskTypeFeature, 0, model.StateStart)
	c, _ := st.CreateTask(ctx, p.ID, "c", "", model.TaskTypeFeature, 0, model.StateStart)

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
	a, _ := st.CreateTask(ctx, p.ID, "a", "", model.TaskTypeFeature, 1, model.StateStart)
	b, _ := st.CreateTask(ctx, p.ID, "b", "", model.TaskTypeFeature, 5, model.StateStart)
	c, _ := st.CreateTask(ctx, p.ID, "c", "", model.TaskTypeFeature, 9, model.StateStart)

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
	low, _ := st.CreateTask(ctx, p.ID, "low", "", model.TaskTypeFeature, 1, model.StateStart)
	high, _ := st.CreateTask(ctx, p.ID, "high", "", model.TaskTypeFeature, 9, model.StateStart)
	mid, _ := st.CreateTask(ctx, p.ID, "mid", "", model.TaskTypeFeature, 5, model.StateStart)

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
	_, _ = st.CreateTask(ctx, p.ID, "a", "", model.TaskTypeFeature, 0, model.StateStart)
	t2, _ := st.CreateTask(ctx, p.ID, "b", "", model.TaskTypeFeature, 0, model.StateStart)
	stDev := model.StateDev
	_, _ = st.UpdateTask(ctx, t2.ID, store.TaskUpdate{State: &stDev})

	all, err := st.ListTasks(ctx, store.TaskFilter{ProjectID: p.ID})
	require.NoError(t, err)
	require.Len(t, all, 2)

	devOnly, err := st.ListTasks(ctx, store.TaskFilter{ProjectID: p.ID, States: []model.TaskState{model.StateDev}})
	require.NoError(t, err)
	require.Len(t, devOnly, 1)
	require.Equal(t, t2.ID, devOnly[0].ID)

	stTest := model.StateTest
	_, err = st.UpdateTask(ctx, t2.ID, store.TaskUpdate{State: &stTest})
	require.NoError(t, err)

	testOnly, err := st.ListTasks(ctx, store.TaskFilter{ProjectID: p.ID, States: []model.TaskState{stTest}})
	require.NoError(t, err)
	require.Len(t, testOnly, 1)
	require.Equal(t, t2.ID, testOnly[0].ID)
}

func TestListTasksWithAttachmentsAvoidsPerTaskQueryFanout(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	p, err := st.CreateProject(ctx, "p", "")
	require.NoError(t, err)

	const taskCount = 2000
	baseDir := t.TempDir()
	var rootID string
	for i := range taskCount {
		tk, err := st.CreateTask(
			ctx,
			p.ID,
			fmt.Sprintf("task-%03d", i),
			"",
			model.TaskTypeFeature,
			i%10,
			model.StateStart,
			[]string{fmt.Sprintf("label-%02d", i%5)},
		)
		require.NoError(t, err)
		if i == 0 {
			rootID = tk.ID
		} else {
			require.NoError(t, st.AddDependency(ctx, tk.ID, rootID))
		}
		require.NoError(t, st.AddLink(ctx, &model.Link{
			TaskID: tk.ID,
			URL:    fmt.Sprintf("https://example.com/%03d", i),
			Label:  fmt.Sprintf("link-%03d", i),
		}))
		require.NoError(t, st.AddDoc(ctx, &model.Doc{
			TaskID:      tk.ID,
			Title:       fmt.Sprintf("doc-%03d", i),
			StoragePath: filepath.Join(baseDir, fmt.Sprintf("doc-%03d.md", i)),
		}))
		require.NoError(t, st.AddImage(ctx, &model.Image{
			TaskID:      tk.ID,
			Filename:    fmt.Sprintf("image-%03d.png", i),
			MimeType:    "image/png",
			SizeBytes:   int64(i + 1),
			StoragePath: filepath.Join(baseDir, fmt.Sprintf("image-%03d.png", i)),
		}))
	}

	start := time.Now()
	listed, err := st.ListTasks(ctx, store.TaskFilter{ProjectID: p.ID})
	elapsed := time.Since(start)
	t.Logf("ListTasks loaded %d tasks with attachments in %s", taskCount, elapsed)
	require.NoError(t, err)
	require.Len(t, listed, taskCount)
	require.Less(t, elapsed, 75*time.Millisecond, "ListTasks should batch-load attachments instead of querying once per task")

	for _, task := range listed {
		require.Len(t, task.Links, 1)
		require.Len(t, task.Docs, 1)
		require.Len(t, task.Images, 1)
		if task.ID == rootID {
			require.Empty(t, task.DependsOn)
		} else {
			require.Equal(t, []string{rootID}, task.DependsOn)
		}
	}
}

func TestClaimNextTaskAssignsUniqueOwnersConcurrently(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	p, err := st.CreateProject(ctx, "p", "")
	require.NoError(t, err)

	const taskCount = 12
	for i := range taskCount {
		_, err := st.CreateTask(ctx, p.ID, fmt.Sprintf("task-%02d", i), "", model.TaskTypeFeature, taskCount-i, model.StateStart)
		require.NoError(t, err)
	}

	var wg sync.WaitGroup
	claimed := make(chan string, taskCount)
	errs := make(chan error, taskCount)
	for i := range taskCount {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			task, err := st.ClaimNextTask(ctx, p.ID, store.ClaimOptions{
				Owner:          fmt.Sprintf("agent-%02d", i),
				Now:            10_000 + int64(i),
				LeaseExpiresAt: 20_000 + int64(i),
			})
			if err != nil {
				errs <- err
				return
			}
			if task == nil {
				errs <- errors.New("expected claimed task, got nil")
				return
			}
			claimed <- task.ID
		}(i)
	}
	wg.Wait()
	close(claimed)
	close(errs)

	for err := range errs {
		require.NoError(t, err)
	}
	seen := map[string]bool{}
	for id := range claimed {
		require.False(t, seen[id], "duplicate claim for task %s", id)
		seen[id] = true
	}
	require.Len(t, seen, taskCount)
}

func TestClaimLeaseLifecycleAndOwnerGuards(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	p, err := st.CreateProject(ctx, "p", "")
	require.NoError(t, err)
	tk, err := st.CreateTask(ctx, p.ID, "claim me", "", model.TaskTypeFeature, 0, model.StateStart)
	require.NoError(t, err)

	claimed, err := st.ClaimTask(ctx, tk.ID, store.ClaimOptions{Owner: "agent-a", Now: 1_000, LeaseExpiresAt: 11_000})
	require.NoError(t, err)
	require.Equal(t, "agent-a", claimed.Owner)
	require.Equal(t, int64(1_000), claimed.ClaimedAt)
	require.Equal(t, int64(11_000), claimed.LeaseExpiresAt)

	_, err = st.ClaimTask(ctx, tk.ID, store.ClaimOptions{Owner: "agent-b", Now: 2_000, LeaseExpiresAt: 12_000})
	require.ErrorIs(t, err, store.ErrConflict)

	reclaimed, err := st.ClaimNextTask(ctx, p.ID, store.ClaimOptions{Owner: "agent-a", Now: 3_000, LeaseExpiresAt: 13_000})
	require.NoError(t, err)
	require.NotNil(t, reclaimed)
	require.Equal(t, tk.ID, reclaimed.ID)
	require.Equal(t, "agent-a", reclaimed.Owner)
	require.Equal(t, int64(13_000), reclaimed.LeaseExpiresAt)

	heartbeat, err := st.HeartbeatTask(ctx, tk.ID, store.HeartbeatOptions{Owner: "agent-a", Now: 4_000, LeaseExpiresAt: 14_000})
	require.NoError(t, err)
	require.Equal(t, int64(14_000), heartbeat.LeaseExpiresAt)

	newTitle := "updated by non-owner"
	_, err = st.UpdateTask(ctx, tk.ID, store.TaskUpdate{Title: &newTitle, Owner: "agent-b", Now: 5_000, LeaseExpiresAt: 15_000})
	require.ErrorIs(t, err, store.ErrConflict)

	newTitle = "updated by owner"
	updated, err := st.UpdateTask(ctx, tk.ID, store.TaskUpdate{Title: &newTitle, Owner: "agent-a", Now: 6_000, LeaseExpiresAt: 16_000})
	require.NoError(t, err)
	require.Equal(t, newTitle, updated.Title)
	require.Equal(t, int64(16_000), updated.LeaseExpiresAt)

	_, err = st.ReleaseTask(ctx, tk.ID, store.ReleaseOptions{Owner: "agent-b", Now: 7_000})
	require.ErrorIs(t, err, store.ErrConflict)

	released, err := st.ReleaseTask(ctx, tk.ID, store.ReleaseOptions{Owner: "agent-b", Force: true, Now: 8_000})
	require.NoError(t, err)
	require.Empty(t, released.Owner)
	require.Zero(t, released.ClaimedAt)
	require.Zero(t, released.LeaseExpiresAt)
}

func TestUpdateTaskIfStateRejectsStaleState(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	p, err := st.CreateProject(ctx, "p", "")
	require.NoError(t, err)
	tk, err := st.CreateTask(ctx, p.ID, "cas", "", model.TaskTypeFeature, 0, model.StateStart)
	require.NoError(t, err)

	expectedReview := model.StateReview
	nextDev := model.StateDev
	_, err = st.UpdateTask(ctx, tk.ID, store.TaskUpdate{IfState: &expectedReview, State: &nextDev})
	require.ErrorIs(t, err, store.ErrConflict)
	require.Contains(t, err.Error(), "current state start")

	expectedStart := model.StateStart
	updated, err := st.UpdateTask(ctx, tk.ID, store.TaskUpdate{IfState: &expectedStart, State: &nextDev})
	require.NoError(t, err)
	require.Equal(t, model.StateDev, updated.State)
}

func TestUpdateTaskIfStateAllowsSingleConcurrentWriter(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	path := filepath.Join(dir, "taskline.db")
	primary, err := store.New(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = primary.Close() })
	p, err := primary.CreateProject(ctx, "p", "")
	require.NoError(t, err)
	tk, err := primary.CreateTask(ctx, p.ID, "cas race", "", model.TaskTypeFeature, 0, model.StateStart)
	require.NoError(t, err)

	const workers = 12
	stores := make([]*store.Store, workers)
	for i := range workers {
		stores[i], err = store.New(path)
		require.NoError(t, err)
		t.Cleanup(func() { _ = stores[i].Close() })
	}

	startState := model.StateStart
	doneState := model.StateDone
	start := make(chan struct{})
	results := make(chan error, workers)
	var wg sync.WaitGroup
	for i := range workers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			_, err := stores[i].UpdateTask(ctx, tk.ID, store.TaskUpdate{
				State:   &doneState,
				IfState: &startState,
				Now:     10_000 + int64(i),
			})
			results <- err
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)

	successes := 0
	conflicts := 0
	for err := range results {
		if err == nil {
			successes++
			continue
		}
		if errors.Is(err, store.ErrConflict) {
			conflicts++
			continue
		}
		require.NoError(t, err)
	}
	require.Equal(t, 1, successes)
	require.Equal(t, workers-1, conflicts)

	got, err := primary.GetTask(ctx, tk.ID)
	require.NoError(t, err)
	require.Equal(t, model.StateDone, got.State)
}

func TestLinkCRUD(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	p, _ := st.CreateProject(ctx, "p", "")
	tk, _ := st.CreateTask(ctx, p.ID, "t", "", model.TaskTypeFeature, 0, model.StateStart)

	l1 := &model.Link{TaskID: tk.ID, URL: "https://example.com/pr/1", Label: "PR #1"}
	require.NoError(t, st.AddLink(ctx, l1))
	require.NotEmpty(t, l1.ID)
	require.NotZero(t, l1.CreatedAt)

	l2 := &model.Link{TaskID: tk.ID, URL: "https://example.com/doc"}
	require.NoError(t, st.AddLink(ctx, l2))

	// FK violation: attach to a missing task.
	bogus := &model.Link{TaskID: "no-such", URL: "https://x"}
	require.ErrorIs(t, st.AddLink(ctx, bogus), store.ErrNotFound)

	// Task fetch surfaces both links in insertion order.
	got, err := st.GetTask(ctx, tk.ID)
	require.NoError(t, err)
	require.Len(t, got.Links, 2)
	require.Equal(t, "https://example.com/pr/1", got.Links[0].URL)
	require.Equal(t, "PR #1", got.Links[0].Label)
	require.Equal(t, "https://example.com/doc", got.Links[1].URL)
	require.Equal(t, "", got.Links[1].Label)

	// DeleteLink removes one.
	require.NoError(t, st.DeleteLink(ctx, l1.ID))
	require.ErrorIs(t, st.DeleteLink(ctx, l1.ID), store.ErrNotFound)
	got2, _ := st.GetTask(ctx, tk.ID)
	require.Len(t, got2.Links, 1)
	require.Equal(t, l2.ID, got2.Links[0].ID)

	// Deleting the task cascades to remaining links.
	require.NoError(t, st.DeleteTask(ctx, tk.ID))
	_, err = st.GetLink(ctx, l2.ID)
	require.ErrorIs(t, err, store.ErrNotFound)
}

func TestImageCRUD(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	p, _ := st.CreateProject(ctx, "p", "")
	tk, _ := st.CreateTask(ctx, p.ID, "t", "", model.TaskTypeFeature, 0, model.StateStart)

	img := &model.Image{
		TaskID:      tk.ID,
		Filename:    "diagram.png",
		MimeType:    "image/png",
		SizeBytes:   42,
		StoragePath: filepath.Join(t.TempDir(), "diagram.png"),
	}
	require.NoError(t, st.AddImage(ctx, img))
	require.NotEmpty(t, img.ID)
	require.NotZero(t, img.UploadedAt)

	got, err := st.GetImage(ctx, img.ID)
	require.NoError(t, err)
	require.Equal(t, img.ID, got.ID)
	require.Equal(t, img.TaskID, got.TaskID)
	require.Equal(t, img.StoragePath, got.StoragePath)

	withImage, err := st.GetTask(ctx, tk.ID)
	require.NoError(t, err)
	require.Len(t, withImage.Images, 1)
	require.Equal(t, img.ID, withImage.Images[0].ID)

	deleted, err := st.DeleteImage(ctx, img.ID)
	require.NoError(t, err)
	require.Equal(t, img.ID, deleted.ID)
	_, err = st.DeleteImage(ctx, img.ID)
	require.ErrorIs(t, err, store.ErrNotFound)

	withoutImage, err := st.GetTask(ctx, tk.ID)
	require.NoError(t, err)
	require.Empty(t, withoutImage.Images)
}

func TestDocCRUD(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	p, _ := st.CreateProject(ctx, "p", "")
	tk, _ := st.CreateTask(ctx, p.ID, "t", "", model.TaskTypeFeature, 0, model.StateStart)

	doc := &model.Doc{
		TaskID:      tk.ID,
		Title:       "Spec",
		StoragePath: filepath.Join(t.TempDir(), "spec.md"),
	}
	require.NoError(t, st.AddDoc(ctx, doc))
	require.NotEmpty(t, doc.ID)
	require.NotZero(t, doc.CreatedAt)
	require.NotZero(t, doc.UpdatedAt)

	got, err := st.GetDoc(ctx, doc.ID)
	require.NoError(t, err)
	require.Equal(t, doc.ID, got.ID)
	require.Equal(t, tk.ID, got.TaskID)
	require.Equal(t, "Spec", got.Title)
	require.Equal(t, doc.StoragePath, got.StoragePath)

	withDoc, err := st.GetTask(ctx, tk.ID)
	require.NoError(t, err)
	require.Len(t, withDoc.Docs, 1)
	require.Equal(t, doc.ID, withDoc.Docs[0].ID)
	require.Equal(t, "Spec", withDoc.Docs[0].Title)

	nextTitle := "Updated Spec"
	updated, err := st.UpdateDoc(ctx, doc.ID, store.DocUpdate{Title: &nextTitle})
	require.NoError(t, err)
	require.Equal(t, nextTitle, updated.Title)
	require.GreaterOrEqual(t, updated.UpdatedAt, doc.UpdatedAt)

	bogus := &model.Doc{TaskID: "no-such", Title: "No task", StoragePath: "x.md"}
	require.ErrorIs(t, st.AddDoc(ctx, bogus), store.ErrNotFound)

	deleted, err := st.DeleteDoc(ctx, doc.ID)
	require.NoError(t, err)
	require.Equal(t, doc.ID, deleted.ID)
	_, err = st.DeleteDoc(ctx, doc.ID)
	require.ErrorIs(t, err, store.ErrNotFound)

	withoutDoc, err := st.GetTask(ctx, tk.ID)
	require.NoError(t, err)
	require.Empty(t, withoutDoc.Docs)
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
	require.GreaterOrEqual(t, v1, 10, "first open should advance to >=10")

	require.NoError(t, st1.Close())

	st2, err := store.New(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = st2.Close() })

	v2, err := readUserVersion(path)
	require.NoError(t, err)
	require.Equal(t, v1, v2, "re-opening must not change user_version")
}

func TestMigrationAddsDocsTypeWithoutDroppingTaskChildren(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	path := filepath.Join(dir, "taskline.db")

	raw, err := sql.Open("sqlite", "file:"+path+"?_pragma=foreign_keys(1)")
	require.NoError(t, err)
	_, err = raw.ExecContext(ctx, `
		CREATE TABLE projects(
		    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
		    description TEXT NOT NULL DEFAULT '',
		    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
		CREATE TABLE tasks(
		    id TEXT PRIMARY KEY,
		    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
		    title TEXT NOT NULL,
		    description TEXT NOT NULL DEFAULT '',
		    type TEXT NOT NULL CHECK (type IN ('feature','bug')),
		    state TEXT NOT NULL CHECK (state IN ('pending','start','spec','dev','test','review','done')),
		    priority INTEGER NOT NULL DEFAULT 0,
		    labels TEXT NOT NULL DEFAULT '[]',
		    created_at INTEGER NOT NULL,
		    updated_at INTEGER NOT NULL);
		CREATE TABLE task_deps(
		    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
		    depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
		    created_at INTEGER NOT NULL,
		    PRIMARY KEY(task_id, depends_on_task_id),
		    CHECK(task_id <> depends_on_task_id));
		CREATE TABLE task_images(
		    id TEXT PRIMARY KEY,
		    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
		    filename TEXT NOT NULL,
		    mime_type TEXT NOT NULL,
		    size_bytes INTEGER NOT NULL,
		    storage_path TEXT NOT NULL,
		    uploaded_at INTEGER NOT NULL);
		CREATE TABLE task_docs(
		    id TEXT PRIMARY KEY,
		    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
		    title TEXT NOT NULL,
		    storage_path TEXT NOT NULL,
		    created_at INTEGER NOT NULL,
		    updated_at INTEGER NOT NULL);
		CREATE TABLE task_links(
		    id TEXT PRIMARY KEY,
		    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
		    url TEXT NOT NULL,
		    label TEXT NOT NULL DEFAULT '',
		    created_at INTEGER NOT NULL);
		INSERT INTO projects(id,name,description,created_at,updated_at)
		    VALUES ('p1','demo','',0,0);
		INSERT INTO tasks(id,project_id,title,type,state,priority,labels,created_at,updated_at)
		    VALUES ('a','p1','dependency','feature','done',1,'[]',0,0),
		           ('b','p1','with children','bug','start',2,'["docs","ui"]',0,0);
		INSERT INTO task_deps(task_id,depends_on_task_id,created_at) VALUES ('b','a',0);
		INSERT INTO task_images(id,task_id,filename,mime_type,size_bytes,storage_path,uploaded_at)
		    VALUES ('img1','b','diagram.png','image/png',12,'images/diagram.png',0);
		INSERT INTO task_docs(id,task_id,title,storage_path,created_at,updated_at)
		    VALUES ('doc1','b','Plan','docs/plan.md',0,0);
		INSERT INTO task_links(id,task_id,url,label,created_at)
		    VALUES ('link1','b','https://example.com','Example',0);
		PRAGMA user_version = 8;
	`)
	require.NoError(t, err)
	require.NoError(t, raw.Close())

	st, err := store.New(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = st.Close() })

	v, err := readUserVersion(path)
	require.NoError(t, err)
	require.GreaterOrEqual(t, v, 10)

	got, err := st.GetTask(ctx, "b")
	require.NoError(t, err)
	require.Equal(t, []string{"docs", "ui"}, got.Labels)
	require.Equal(t, []string{"a"}, got.DependsOn)
	require.Len(t, got.Images, 1)
	require.Equal(t, "img1", got.Images[0].ID)
	require.Len(t, got.Docs, 1)
	require.Equal(t, "doc1", got.Docs[0].ID)
	require.Len(t, got.Links, 1)
	require.Equal(t, "link1", got.Links[0].ID)

	docs, err := st.CreateTask(ctx, "p1", "docs task", "", model.TaskTypeDocs, 0, model.StateStart)
	require.NoError(t, err)
	require.Equal(t, model.TaskTypeDocs, docs.Type)
}

// TestMigrationUpgradesCreatedAndDesignRows catches the failure mode
// where the 0003 migration would explode on any DB that actually has
// rows in state='created' — the old CHECK constraint forbids 'start',
// so a pre-UPDATE rename would fail. We seed the legacy schema with
// real 'created' and 'design' rows (and a task_deps edge) before opening
// the store to drive the full migration chain through.
func TestMigrationUpgradesCreatedAndDesignRows(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	path := filepath.Join(dir, "taskline.db")

	// Seed the legacy schema directly — bypass the Store so 0003 hasn't
	// run yet. user_version stays at 0; opening Store later will run all
	// migrations in order.
	raw, err := sql.Open("sqlite", "file:"+path+"?_pragma=foreign_keys(1)")
	require.NoError(t, err)
	_, err = raw.ExecContext(ctx, `
		CREATE TABLE projects(
		    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
		    description TEXT NOT NULL DEFAULT '',
		    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
		CREATE TABLE tasks(
		    id TEXT PRIMARY KEY,
		    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
		    title TEXT NOT NULL,
		    description TEXT NOT NULL DEFAULT '',
		    type TEXT NOT NULL CHECK (type IN ('feature','bug')),
		    state TEXT NOT NULL CHECK (state IN ('created','design','dev','review','done')),
		    priority INTEGER NOT NULL DEFAULT 0,
		    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
		CREATE TABLE task_deps(
		    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
		    depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
		    created_at INTEGER NOT NULL,
		    PRIMARY KEY(task_id, depends_on_task_id),
		    CHECK(task_id <> depends_on_task_id));
		INSERT INTO projects(id,name,description,created_at,updated_at)
		    VALUES ('p1','demo','',0,0);
			INSERT INTO tasks(id,project_id,title,type,state,priority,created_at,updated_at)
			    VALUES ('a','p1','first','feature','created',1,0,0),
			           ('b','p1','second','feature','design',2,0,0),
			           ('c','p1','third','feature','dev',3,0,0);
			INSERT INTO task_deps(task_id, depends_on_task_id, created_at)
			    VALUES ('c','a',0);
	`)
	require.NoError(t, err)
	require.NoError(t, raw.Close())

	// Open via Store — this runs the migrations in order, ending at the
	// latest schema version.
	st, err := store.New(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = st.Close() })

	v, err := readUserVersion(path)
	require.NoError(t, err)
	require.GreaterOrEqual(t, v, 10, "migration should have run at least through 0010")

	// The legacy 'created' row was renamed to 'start' during the swap.
	ta, err := st.GetTask(ctx, "a")
	require.NoError(t, err)
	require.Equal(t, model.StateStart, ta.State)

	// The legacy 'design' row was renamed to 'spec' during the 0005 swap.
	tb, err := st.GetTask(ctx, "b")
	require.NoError(t, err)
	require.Equal(t, model.StateSpec, tb.State)

	// The 'dev' row is untouched.
	tc, err := st.GetTask(ctx, "c")
	require.NoError(t, err)
	require.Equal(t, model.StateDev, tc.State)

	// task_deps FK + cascade-delete still work after the table swap.
	require.NoError(t, st.DeleteTask(ctx, "a"))
	rs, err := st.ListTasks(ctx, store.TaskFilter{ProjectID: "p1"})
	require.NoError(t, err)
	require.Len(t, rs, 2)
	for _, task := range rs {
		require.NotEqual(t, "a", task.ID)
		require.Empty(t, task.DependsOn, "task_deps row should have cascaded")
	}

	docs, err := st.CreateTask(ctx, "p1", "docs", "", model.TaskTypeDocs, 0, model.StateStart)
	require.NoError(t, err)
	require.Equal(t, model.TaskTypeDocs, docs.Type)
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
