import { expect, it } from "vitest";
import { getContext } from "./root-provider";

it("isolates server request query data instead of sharing cached HR results", () => {
  const firstRequest = getContext();
  firstRequest.queryClient.setQueryData(["overtime-approvals", "pending"], { records: [] });
  const secondRequest = getContext();
  expect(secondRequest.queryClient).not.toBe(firstRequest.queryClient);
  expect(secondRequest.queryClient.getQueryData(["overtime-approvals", "pending"])).toBeUndefined();
  firstRequest.queryClient.clear();
  secondRequest.queryClient.clear();
});
