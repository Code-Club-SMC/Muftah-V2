import { useState } from "react";
import { InvoicesTable } from "@/components/sales/invoices-table";
import { CreateInvoiceSheet } from "@/components/sales/create-invoice-sheet";

export const InvoicesContainer = () => {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <InvoicesTable sheetOpen={sheetOpen} onSheetOpenChange={setSheetOpen} />
      <CreateInvoiceSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
};
