import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlusIcon } from "lucide-react";
import { useCreateMixingRun } from "@/hooks/manufacturing/mixing/use-mixing-mutations";
import { useQuery } from "@tanstack/react-query";
import { getActiveFormulaOptionsFn } from "@/server-functions/manufacturing/formulas/get-active-formula-options-fn";
import { getManufacturingAssignmentOptionsFn } from "@/server-functions/manufacturing/get-assignment-options-fn";
import { getMixingStockAvailabilityFn } from "@/server-functions/manufacturing/mixing/get-mixing-stock-availability-fn";
import { useNavigate } from "@tanstack/react-router";

export function CreateMixingRunDialog() {
  const [open, setOpen] = useState(false);
  const [formulaId, setFormulaId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const createMixingRun = useCreateMixingRun();
  const navigate = useNavigate();
  const formulasQuery = useQuery({
    queryKey: ["formulas", "active-options"],
    queryFn: () => getActiveFormulaOptionsFn(),
    enabled: open,
  });
  const assignmentsQuery = useQuery({
    queryKey: ["manufacturing-assignment-options"],
    queryFn: () => getManufacturingAssignmentOptionsFn(),
    enabled: open,
  });
  const stockQuery = useQuery({
    queryKey: ["mixing-stock-availability", formulaId, warehouseId],
    queryFn: () =>
      getMixingStockAvailabilityFn({ data: { formulaId, warehouseId } }),
    enabled: open && !!formulaId && !!warehouseId,
    retry: false,
    staleTime: 0,
  });
  const shortages =
    createMixingRun.data?.success === false
      ? createMixingRun.data.shortages
      : (stockQuery.data?.shortages ?? []);
  const error =
    createMixingRun.error ??
    stockQuery.error ??
    formulasQuery.error ??
    assignmentsQuery.error;

  function changeSelection(setter: (value: string) => void, value: string) {
    createMixingRun.reset();
    setter(value);
  }
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    createMixingRun.mutate(
      { data: { formulaId, warehouseId, operatorId } },
      {
        onSuccess: (result) => {
          if (!result.success) return;
          setOpen(false);
          setFormulaId("");
          setWarehouseId("");
          setOperatorId("");
          navigate({
            to: "/manufacturing/mixing/$runId",
            params: { runId: result.mixingRun.id },
          });
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (createMixingRun.isPending) return;
        createMixingRun.reset();
        setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <PlusIcon data-icon="inline-start" />
          Create Mixing Batch
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create New Mixing Batch</DialogTitle>
          <DialogDescription>
            Stock is checked on the selected factory floor. Chemicals are
            consumed when the batch starts.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="mixing-formula">
                Select Mixing Formula
              </FieldLabel>
              <NativeSelect
                className="w-full"
                id="mixing-formula"
                required
                disabled={createMixingRun.isPending}
                value={formulaId}
                onChange={(event) =>
                  changeSelection(setFormulaId, event.target.value)
                }
              >
                <NativeSelectOption value="" disabled>
                  Select a mixing formula
                </NativeSelectOption>
                {formulasQuery.data?.map((formula) => (
                  <NativeSelectOption key={formula.id} value={formula.id}>
                    {formula.name} ({formula.batchSize} {formula.batchUnit})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="mixing-floor">Factory floor</FieldLabel>
              <NativeSelect
                className="w-full"
                id="mixing-floor"
                required
                disabled={createMixingRun.isPending}
                value={warehouseId}
                onChange={(event) =>
                  changeSelection(setWarehouseId, event.target.value)
                }
              >
                <NativeSelectOption value="" disabled>
                  Select a factory floor
                </NativeSelectOption>
                {assignmentsQuery.data?.factoryFloors.map((floor) => (
                  <NativeSelectOption key={floor.id} value={floor.id}>
                    {floor.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="mixing-operator">Operator</FieldLabel>
              <NativeSelect
                className="w-full"
                id="mixing-operator"
                required
                disabled={createMixingRun.isPending}
                value={operatorId}
                onChange={(event) =>
                  changeSelection(setOperatorId, event.target.value)
                }
              >
                <NativeSelectOption value="" disabled>
                  Select an operator
                </NativeSelectOption>
                {assignmentsQuery.data?.operators.map((operator) => (
                  <NativeSelectOption key={operator.id} value={operator.id}>
                    {operator.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </FieldGroup>
          {formulaId && warehouseId && (
            <div className="flex flex-col gap-3" aria-live="polite">
              {stockQuery.isFetching && (
                <p className="text-sm text-muted-foreground">
                  Checking factory floor stock...
                </p>
              )}
              {shortages.length > 0 && (
                <Alert variant="destructive">
                  <AlertTitle>Not enough stock to create this batch</AlertTitle>
                  <AlertDescription>
                    Transfer the missing quantities to the selected factory
                    floor, then refresh stock.
                  </AlertDescription>
                </Alert>
              )}
              {shortages.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Chemical</TableHead>
                      <TableHead>Required</TableHead>
                      <TableHead>Available</TableHead>
                      <TableHead>Missing</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shortages.map((item) => (
                      <TableRow key={item.chemicalId}>
                        <TableCell>{item.name}</TableCell>
                        <TableCell>
                          {item.required} {item.unit}
                        </TableCell>
                        <TableCell>
                          {item.available} {item.unit}
                        </TableCell>
                        <TableCell>
                          {item.missing} {item.unit}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {stockQuery.isSuccess &&
                !stockQuery.isFetching &&
                !shortages.length && (
                  <p className="text-sm text-muted-foreground">
                    Enough stock is available. Stock will be checked again when
                    you create and start the batch.
                  </p>
                )}
              <Button
                type="button"
                variant="outline"
                disabled={stockQuery.isFetching || createMixingRun.isPending}
                onClick={() => {
                  createMixingRun.reset();
                  void stockQuery.refetch();
                }}
              >
                Refresh stock
              </Button>
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Cannot create mixing batch</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={createMixingRun.isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                createMixingRun.isPending ||
                !formulaId ||
                !warehouseId ||
                !operatorId ||
                !stockQuery.isSuccess ||
                stockQuery.isFetching ||
                shortages.length > 0
              }
            >
              {createMixingRun.isPending ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
