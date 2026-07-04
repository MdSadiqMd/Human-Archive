import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { api, type Video } from "#/lib/api";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { Alert, AlertDescription } from "#/components/ui/alert";

export const Route = createFileRoute("/admin/videos")({
	component: VideosPage,
});

const labelColors: Record<string, string> = {
	easy: "bg-green-500/15 text-green-400 border-green-500/20",
	no_hands: "bg-blue-500/15 text-blue-400 border-blue-500/20",
	occluded: "bg-orange-500/15 text-orange-400 border-orange-500/20",
	low_lighting: "bg-purple-500/15 text-purple-400 border-purple-500/20",
	dexterous_pose: "bg-red-500/15 text-red-400 border-red-500/20",
};

function formatDuration(s: number) {
	const m = Math.floor(s / 60);
	const sec = Math.floor(s % 60);
	return `${m}m ${sec}s`;
}

function formatDate(iso: string) {
	return new Date(iso).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function VideosPage() {
	const [videos, setVideos] = useState<Video[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [ingesting, setIngesting] = useState(false);
	const [ingestMsg, setIngestMsg] = useState("");

	const fetchVideos = useCallback(async () => {
		setLoading(true);
		try {
			const data = await api.admin.listVideos();
			setVideos(data ?? []);
		} catch (err: any) {
			setError(err.message || "Failed to load videos");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchVideos();
	}, [fetchVideos]);

	async function handleIngest() {
		setIngesting(true);
		setIngestMsg("");
		setError("");
		try {
			const res = await api.admin.ingest("/data/output");
			setIngestMsg(
				`Ingested ${res.videos} video(s) with ${res.frames} frame(s)`,
			);
			await fetchVideos();
		} catch (err: any) {
			setError(err.message || "Ingest failed");
		} finally {
			setIngesting(false);
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold text-foreground">Videos</h1>
					<p className="text-sm text-muted-foreground mt-1">
						Processed videos from the classification pipeline.
					</p>
				</div>
			</div>

			{error && (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{ingestMsg && (
				<Alert>
					<AlertDescription>{ingestMsg}</AlertDescription>
				</Alert>
			)}

			<div className="flex items-center gap-3">
				<Button onClick={handleIngest} disabled={ingesting}>
					{ingesting ? "Scanning output…" : "Scan for new videos"}
				</Button>
				<span className="text-xs text-muted-foreground">
					Imports any new pipeline output from ./output
				</span>
			</div>

			<div className="border border-border rounded-lg overflow-hidden">
				<Table>
					<TableHeader>
						<TableRow className="hover:bg-transparent">
							<TableHead>Stem</TableHead>
							<TableHead>Duration</TableHead>
							<TableHead>Frames</TableHead>
							<TableHead>Labels</TableHead>
							<TableHead>Ingested</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{loading ? (
							<TableRow>
								<TableCell
									colSpan={6}
									className="text-center text-muted-foreground py-12"
								>
									Loading…
								</TableCell>
							</TableRow>
						) : videos.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={6}
									className="text-center text-muted-foreground py-12"
								>
									No videos ingested yet. Run the pipeline then ingest the
									output directory.
								</TableCell>
							</TableRow>
						) : (
							videos.map((video) => (
								<TableRow key={video.id}>
									<TableCell className="font-medium text-foreground font-mono text-sm">
										{video.stem}
									</TableCell>
									<TableCell className="text-muted-foreground text-sm">
										{formatDuration(video.duration_s)}
									</TableCell>
									<TableCell className="text-muted-foreground text-sm">
										{video.sampled_frames} / {video.total_frames}
									</TableCell>
									<TableCell>
										<div className="flex flex-wrap gap-1">
											{Object.entries(video.label_counts || {}).map(
												([label, count]) => (
													<Badge
														key={label}
														variant="outline"
														className={`text-[11px] ${labelColors[label] || ""}`}
													>
														{label}: {count}
													</Badge>
												),
											)}
										</div>
									</TableCell>
									<TableCell className="text-muted-foreground text-sm">
										{formatDate(video.ingested_at)}
									</TableCell>
									<TableCell className="text-right">
										<Button asChild variant="outline" size="sm">
											<Link
												to="/admin/video/$videoId"
												params={{ videoId: video.id }}
											>
												View
											</Link>
										</Button>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
