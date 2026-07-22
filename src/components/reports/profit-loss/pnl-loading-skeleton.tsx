import { Skeleton } from "@/components/ui/skeleton";

export function PnlLoadingSkeleton() {
	return (
		<div className="space-y-5 animate-pulse print:hidden">
			<div>
				<Skeleton className="h-4 w-40 mb-3" />
				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
					{Array.from({ length: 6 }).map((_, i) => (
						<div
							key={i}
							className="flex items-center gap-4 rounded-2xl border border-border/70 bg-white/95 px-5 py-4"
						>
							<Skeleton className="size-12 rounded-full" />
							<div className="flex-1 space-y-2">
								<Skeleton className="h-3 w-20" />
								<Skeleton className="h-5 w-28" />
								<Skeleton className="h-3 w-32" />
							</div>
						</div>
					))}
				</div>
			</div>

			<div className="grid gap-4 xl:grid-cols-4">
				{Array.from({ length: 4 }).map((_, i) => (
					<div
						key={i}
						className="rounded-2xl border border-border/70 bg-white/95"
					>
						<div className="border-b border-border/60 px-5 py-4">
							<Skeleton className="h-4 w-40" />
						</div>
						<div className="px-5 py-4">
							<Skeleton className="h-[220px] w-full" />
						</div>
					</div>
				))}
			</div>

			<div className="rounded-2xl border border-border/70 bg-white/95">
				<div className="border-b border-border/60 px-5 py-4">
					<Skeleton className="h-4 w-48" />
					<Skeleton className="mt-2 h-3 w-72" />
				</div>
				<div className="space-y-5 px-5 py-4">
					<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
						{Array.from({ length: 4 }).map((_, i) => (
							<div
								key={i}
								className="flex items-center gap-4 rounded-2xl border border-border/70 px-5 py-4"
							>
								<Skeleton className="size-12 rounded-full" />
								<div className="flex-1 space-y-2">
									<Skeleton className="h-3 w-24" />
									<Skeleton className="h-5 w-20" />
								</div>
							</div>
						))}
					</div>
					<div className="rounded-xl border border-border/70">
						{Array.from({ length: 3 }).map((_, i) => (
							<div
								key={i}
								className="flex gap-4 border-b border-border/40 px-4 py-3 last:border-b-0"
							>
								<Skeleton className="h-3 flex-1" />
								<Skeleton className="h-3 flex-1" />
								<Skeleton className="h-3 w-24" />
								<Skeleton className="h-3 w-24" />
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="grid gap-4 xl:grid-cols-2">
				{Array.from({ length: 2 }).map((_, i) => (
					<div
						key={i}
						className="rounded-2xl border border-border/70 bg-white/95"
					>
						<div className="border-b border-border/60 px-5 py-4">
							<Skeleton className="h-4 w-44" />
						</div>
						<div className="px-5 py-4">
							<Skeleton className="h-[220px] w-full" />
						</div>
					</div>
				))}
			</div>

			<div className="rounded-2xl border border-border/70 bg-white/95">
				<div className="border-b border-border/60 px-5 py-4">
					<Skeleton className="h-4 w-44" />
				</div>
				<div className="px-5 py-4">
					<div className="rounded-xl border border-border/70">
						{Array.from({ length: 4 }).map((_, i) => (
							<div
								key={i}
								className="flex gap-4 border-b border-border/40 px-4 py-3 last:border-b-0"
							>
								{Array.from({ length: 6 }).map((__, j) => (
									<Skeleton key={j} className="h-3 flex-1" />
								))}
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
