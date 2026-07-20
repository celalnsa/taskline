package store_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"taskline_server/api/model"
	"taskline_server/internal/store"
)

func TestListActiveClaimsFiltersOwnerLeaseAndState(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	project, err := st.CreateProject(ctx, "status", "")
	require.NoError(t, err)

	create := func(title string) *model.Task {
		task, createErr := st.CreateTask(ctx, project.ID, title, "", model.TaskTypeFeature, 0, model.StateStart)
		require.NoError(t, createErr)
		return task
	}
	claim := func(task *model.Task, owner string, now, lease int64) {
		_, claimErr := st.ClaimTask(ctx, task.ID, store.ClaimOptions{
			Owner: owner, Now: now, LeaseExpiresAt: lease,
		})
		require.NoError(t, claimErr)
	}

	live := create("live")
	claim(live, "agent-a", 1_000, 10_000)

	expired := create("expired")
	claim(expired, "agent-a", 1_000, 2_000)

	done := create("done")
	claim(done, "agent-a", 1_000, 10_000)
	doneState := model.StateDone
	_, err = st.UpdateTask(ctx, done.ID, store.TaskUpdate{
		State: &doneState, Owner: "agent-a", Now: 2_000, LeaseExpiresAt: 10_000,
	})
	require.NoError(t, err)

	parked := create("parked")
	claim(parked, "agent-a", 1_000, 10_000)
	pendingState := model.StatePending
	_, err = st.UpdateTask(ctx, parked.ID, store.TaskUpdate{
		State: &pendingState, Owner: "agent-a", Now: 2_000, LeaseExpiresAt: 10_000,
	})
	require.NoError(t, err)

	other := create("other owner")
	claim(other, "agent-b", 1_000, 10_000)

	claims, err := st.ListActiveClaims(ctx, "agent-a", 5_000)
	require.NoError(t, err)
	require.Equal(t, []model.ActiveClaim{{
		ID:             live.ID,
		Title:          "live",
		ClaimedAt:      1_000,
		LeaseExpiresAt: 10_000,
	}}, claims)
}
