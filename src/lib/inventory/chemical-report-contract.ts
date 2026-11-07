export type ChemicalPurchaseRef = {
  purchaseId: string;
  chemicalId: string;
  chemicalName: string;
};

export type ChemicalReportCoverage = {
  purchaseCount: number;
  missingPurchaseCount: number;
  reportCount: number;
};

export type ChemicalReportPurchase = ChemicalPurchaseRef & {
  supplierName: string;
  purchaseDate: Date | string;
  quantity: string;
  unit: string;
  reportCount: number;
  voidedAt: Date | string | null;
};
