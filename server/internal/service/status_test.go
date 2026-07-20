package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"taskline_server/api/model"
	"taskline_server/internal/service"
)

func TestStatusReturnsAuthenticatedAgentAndLiveClaims(t *testing.T) {
	ctx := context.Background()
	s := newSvc(t)
	reg, err := s.RegisterAgent(ctx, "agent-a")
	require.NoError(t, err)
	project, err := s.CreateProject(ctx, "status", "")
	require.NoError(t, err)
	task, err := s.CreateTask(ctx, project.ID, "claimed", "", model.TaskTypeFeature, 0, true)
	require.NoError(t, err)
	claimed, err := s.ClaimTask(ctx, task.ID, service.ClaimOptions{
		Owner: "agent-a",
		Lease: time.Hour,
	})
	require.NoError(t, err)

	status, err := s.Status(ctx, reg.Agent)
	require.NoError(t, err)
	require.True(t, status.OK)
	require.Equal(t, reg.Agent, status.Agent)
	require.Len(t, status.ActiveTasks, 1)
	require.Equal(t, claimed.ID, status.ActiveTasks[0].ID)
	require.Equal(t, claimed.ClaimedAt, status.ActiveTasks[0].ClaimedAt)
	require.GreaterOrEqual(t, status.ActiveTasks[0].ClaimedForMS, int64(0))
	require.Equal(t, claimed.LeaseExpiresAt, status.ActiveTasks[0].LeaseExpiresAt)
	require.NotZero(t, status.ServerTime)
}

func TestStatusWithoutAgentIsHealthyAndUnregistered(t *testing.T) {
	status, err := newSvc(t).Status(context.Background(), nil)
	require.NoError(t, err)
	require.True(t, status.OK)
	require.Nil(t, status.Agent)
	require.Empty(t, status.ActiveTasks)
}
