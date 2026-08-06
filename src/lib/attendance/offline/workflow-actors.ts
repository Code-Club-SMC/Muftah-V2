export type OfflineWorkflowActors = {
  operatorUserId: string;
  supervisorUserId: string | null;
  reviewerUserId: string | null;
};

export function assertDistinctWorkflowActors(input: OfflineWorkflowActors) {
  if (
    input.supervisorUserId &&
    input.operatorUserId === input.supervisorUserId
  ) {
    throw new Error("Operator cannot confirm their own outage");
  }

  if (input.reviewerUserId && input.operatorUserId === input.reviewerUserId) {
    throw new Error("Final reviewer must be different from operator");
  }

  if (
    input.reviewerUserId &&
    input.supervisorUserId &&
    input.supervisorUserId === input.reviewerUserId
  ) {
    throw new Error("Final reviewer must be different from supervisor");
  }
}
