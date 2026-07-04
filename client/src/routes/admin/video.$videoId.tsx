import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import {
	api,
	frameImageUrl,
	type Video,
	type User,
	type PaginatedFrames,
	type Assignment,
} from "#/lib/api";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Separator } from "#/components/ui/separator";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";

export const Route = createFileRoute("/admin/video/$videoId")({
	component: VideoDetailPage,
});

const LABELS = [
	"all",
	"no_hands",
	"easy",
	"occluded",
	"low_lighting",
	"dexterous_pose",
] as const;
type Label = (typeof LABELS)[number];

const labelColors: Record<string, string> = {
	easy: "bg-green-500/15 text-green-400 border-green-500/20",
	no_hands: "bg-blue-500/15 text-blue-400 border-blue-500/20",
	occluded: "bg-orange-500/15 text-orange-400 border-orange-500/20",
	low_lighting: "bg-purple-500/15 text-purple-400 border-purple-500/20",
	dexterous_pose: "bg-red-500/15 text-red-400 border-red-500/20",
};

function VideoDetailPage() {
	const { videoId } = Route.useParams();
	const navigate = useNavigate();
	const [video, setVideo] = useState<Video | null>(null);
	const [frames, setFrames] = useState<PaginatedFrames | null>(null);
	const [activeLabel, setActiveLabel] = useState<Label>("all");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [annotators, setAnnotators] = useState<User[]>([]);
	const [assigneeId, setAssigneeId] = useState("");
	const [assigning, setAssigning] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [assignments, setAssignments] = useState<Assignment[]>([]);

	const fetchData = useCallback(async () => {
		try {
			const [v, f, u, a] = await Promise.all([
				api.admin.getVideo(videoId),
				api.admin.listFrames(videoId, { label: activeLabel, per_page: 200 }),
				api.admin.listUsers({ role: "annotator", status: "active" }),
				api.admin.listAssignments(videoId),
			]);
			setVideo(v);
			setFrames(f);
			setAnnotators(u ?? []);
			setAssignments(a ?? []);
		} catch (err: any) {
			setError(err.message || "Failed to load");
		}
	}, [videoId, activeLabel]);

	const getFrameStatus = (
		frameId: string,
	): "pending" | "completed" | "skipped" | null => {
		const assignment = assignments.find((a) => a.frame_id === frameId);
		return (assignment?.status as any) || null;
	};

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	function toggleSelect(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setSelected(next);
	}

	function selectAll() {
		if (!frames) return;
		const all = new Set(frames.frames.map((f) => f.id));
		if (all.size === selected.size) {
			setSelected(new Set());
		} else {
			setSelected(all);
		}
	}

	async function handleAssign() {
		if (!assigneeId || selected.size === 0) return;
		setAssigning(true);
		setError("");
		setSuccess("");
		try {
			const res = await api.admin.assignFrames(
				Array.from(selected),
				assigneeId,
			);
			setSuccess(`Assigned ${res.assigned} frame(s)`);
			setSelected(new Set());
			await fetchData();
		} catch (err: any) {
			setError(err.message || "Assign failed");
		} finally {
			setAssigning(false);
		}
	}

	async function handleAssignAll() {
		if (!assigneeId) return;
		setAssigning(true);
		setError("");
		setSuccess("");
		try {
			const res = await api.admin.assignByFilter({
				video_id: videoId,
				label: activeLabel === "all" ? undefined : activeLabel,
				assignee_id: assigneeId,
			});
			setSuccess(`Assigned all ${res.assigned} matching frame(s)`);
			await fetchData();
		} catch (err: any) {
			setError(err.message || "Assign failed");
		} finally {
			setAssigning(false);
		}
	}

	if (!video)
		return (
			<div className="text-center py-12 text-muted-foreground">Loading…</div>
		);

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
						<button
							onClick={() => navigate({ to: "/admin/videos" })}
							className="hover:text-foreground"
						>
							Videos
						</button>
						<span>/</span>
						<span className="text-foreground font-mono text-xs">
							{video.stem}
						</span>
					</div>
					<h1 className="text-2xl font-semibold text-foreground">
						{video.stem}
					</h1>
				</div>
			</div>

			{error && (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}
			{success && (
				<Alert>
					<AlertDescription>{success}</AlertDescription>
				</Alert>
			)}

			{/* Stats */}
			<div className="grid grid-cols-2 md:grid-cols-5 gap-3">
				<div className="border border-border rounded-lg p-3">
					<div className="text-xs text-muted-foreground">Duration</div>
					<div className="text-lg font-semibold mt-0.5">
						{Math.floor(video.duration_s / 60)}m{" "}
						{Math.floor(video.duration_s % 60)}s
					</div>
				</div>
				<div className="border border-border rounded-lg p-3">
					<div className="text-xs text-muted-foreground">FPS</div>
					<div className="text-lg font-semibold mt-0.5">{video.fps}</div>
				</div>
				<div className="border border-border rounded-lg p-3">
					<div className="text-xs text-muted-foreground">Total Frames</div>
					<div className="text-lg font-semibold mt-0.5">
						{video.total_frames}
					</div>
				</div>
				<div className="border border-border rounded-lg p-3">
					<div className="text-xs text-muted-foreground">Sampled</div>
					<div className="text-lg font-semibold mt-0.5">
						{video.sampled_frames}
					</div>
				</div>
				<div className="border border-border rounded-lg p-3">
					<div className="text-xs text-muted-foreground">Status</div>
					<div className="text-lg font-semibold mt-0.5 capitalize">
						{video.status}
					</div>
				</div>
			</div>

			<Separator />

			{/* Label filter */}
			<Tabs
				value={activeLabel}
				onValueChange={(v) => {
					setActiveLabel(v as Label);
					setSelected(new Set());
				}}
			>
				<TabsList>
					{LABELS.map((label) => (
						<TabsTrigger key={label} value={label} className="gap-1.5">
							{label === "all" ? "All" : label.replace(/_/g, " ")}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>

			{/* Assign controls */}
			<div className="flex items-center gap-3">
				<Select value={assigneeId} onValueChange={setAssigneeId}>
					<SelectTrigger className="w-[200px]">
						<SelectValue placeholder="Select annotator…" />
					</SelectTrigger>
					<SelectContent>
						{annotators.map((u) => (
							<SelectItem key={u.id} value={u.id}>
								{u.email}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					size="sm"
					onClick={handleAssign}
					disabled={!assigneeId || selected.size === 0 || assigning}
				>
					Assign Selected ({selected.size})
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={handleAssignAll}
					disabled={!assigneeId || assigning}
				>
					Assign All {activeLabel !== "all" && activeLabel}
				</Button>
			</div>

			{/* Frame grid */}
			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<button
						onClick={selectAll}
						className="text-xs text-muted-foreground hover:text-foreground"
					>
						{frames &&
						selected.size === frames.frames.length &&
						frames.frames.length > 0
							? "Deselect all"
							: "Select all"}
					</button>
					{frames && (
						<span className="text-xs text-muted-foreground">
							{frames.total} frame{frames.total !== 1 ? "s" : ""}
						</span>
					)}
				</div>
				<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
					{frames?.frames.map((frame) => {
						const status = getFrameStatus(frame.id);
						return (
							<div
								key={frame.id}
								className={`relative border rounded-lg overflow-hidden cursor-pointer transition-colors ${
									selected.has(frame.id)
										? "border-primary ring-2 ring-primary/30"
										: "border-border hover:border-muted-foreground/30"
								}`}
								onClick={() => toggleSelect(frame.id)}
							>
								<div className="aspect-[4/3] bg-muted relative group">
									<img
										src={frameImageUrl(video.stem, frame.label, frame.filename)}
										alt={`Frame ${frame.frame_index}`}
										className="w-full h-full object-cover"
										loading="lazy"
									/>
									{selected.has(frame.id) && (
										<div className="absolute top-1 right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
											<svg
												className="w-3 h-3 text-primary-foreground"
												fill="none"
												viewBox="0 0 24 24"
												stroke="currentColor"
											>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													strokeWidth={3}
													d="M5 13l4 4L19 7"
												/>
											</svg>
										</div>
									)}
									{status && (
										<div
											className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${
												status === "completed"
													? "bg-green-500/90 text-white"
													: status === "skipped"
														? "bg-yellow-500/90 text-black"
														: "bg-blue-500/90 text-white"
											}`}
										>
											{status}
										</div>
									)}
									{status === "completed" && (
										<Link
											to="/admin/frame/$frameId"
											params={{ frameId: frame.id }}
											onClick={(e) => e.stopPropagation()}
											className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
										>
											<span className="text-white text-xs font-medium bg-white/20 px-2 py-1 rounded">
												View Annotation
											</span>
										</Link>
									)}
								</div>
								<div className="p-1.5 space-y-0.5">
									<div className="flex items-center justify-between">
										<span className="text-[11px] font-mono text-muted-foreground">
											#{frame.frame_index}
										</span>
										<Badge
											variant="outline"
											className={`text-[10px] px-1 py-0 ${labelColors[frame.label] || ""}`}
										>
											{frame.label.replace(/_/g, " ")}
										</Badge>
									</div>
									{frame.num_hands > 0 && (
										<div className="text-[10px] text-muted-foreground">
											{frame.num_hands} hand{frame.num_hands !== 1 ? "s" : ""} ·{" "}
											{frame.hand_evidence.toFixed(2)}
										</div>
									)}
								</div>
							</div>
						);
					})}
				</div>
				{frames && frames.frames.length === 0 && (
					<p className="text-center py-12 text-muted-foreground">
						No frames found for this filter.
					</p>
				)}
			</div>

			{frames && frames.total_pages > 1 && (
				<div className="flex items-center justify-center gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={frames.page <= 1}
						onClick={async () => {
							const f = await api.admin.listFrames(videoId, {
								label: activeLabel,
								page: frames.page - 1,
								per_page: 200,
							});
							setFrames(f);
							setSelected(new Set());
						}}
					>
						Previous
					</Button>
					<span className="text-sm text-muted-foreground">
						Page {frames.page} of {frames.total_pages}
					</span>
					<Button
						variant="outline"
						size="sm"
						disabled={frames.page >= frames.total_pages}
						onClick={async () => {
							const f = await api.admin.listFrames(videoId, {
								label: activeLabel,
								page: frames.page + 1,
								per_page: 200,
							});
							setFrames(f);
							setSelected(new Set());
						}}
					>
						Next
					</Button>
				</div>
			)}
		</div>
	);
}
