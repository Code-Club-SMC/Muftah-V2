const BATCH_PREFIX = "A";
const BATCH_NUMBER_WIDTH = 4;
const BATCH_ID_PATTERN = /^A(\d+)$/;

export function generateNextBatchId(
	lastBatchId: string | null | undefined,
): string {
	if (lastBatchId) {
		const match = lastBatchId.match(BATCH_ID_PATTERN);
		if (match) {
			const number = parseInt(match[1], 10);
			return `${BATCH_PREFIX}${String(number + 1).padStart(
				BATCH_NUMBER_WIDTH,
				"0",
			)}`;
		}
	}

	return `${BATCH_PREFIX}${"1".padStart(BATCH_NUMBER_WIDTH, "0")}`;
}
