export type SafeXlsxLimits = {
  maxBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
};

export type XlsxEntryMetadata = {
  filename: string;
  uncompressedSize: number;
  encrypted?: boolean;
  zip64?: boolean;
};
