import { createFileRoute } from "@tanstack/react-router";
import { OfflineDeskPage } from "@/components/sales/offline-desk/offline-desk-page";

/**
 * The offline invoice desk. It is a public shell that renders only in the
 * browser and reads everything from this computer's own storage, so the page
 * still opens when the server cannot be reached. Prices and invoice numbers
 * are fetched only while signed in (see "Prepare this computer").
 */
export const Route = createFileRoute("/offline-desk")({
  ssr: false,
  component: OfflineDeskPage,
});
