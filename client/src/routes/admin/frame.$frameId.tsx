import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import {
	api,
	frameImageUrl,
	type Frame,
	type AnnotationWithMeta,
	type Video,
	type BoundingBox,
} from "#/lib/api";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import { AnnotationCanvas } from "#/components/annotation";
import { AnnotationToolbar } from "#/components/annotation/AnnotationToolbar";
import { SyncStatusBadge } from "#/components/SyncStatus";
import { useSyncBuffer, isNetworkError } from "#/lib/sync-buffer";
import type { ZoomControl } from "#/components/annotation/types";

export const Route = createFileRoute("/admin/frame/$frameId")({
	component: FrameDetailPage,
});

const labelColors: Record<string, string> = {
	easy: "bg-green-500/15 text-green-400 border-green-500/20",
	no_hands: "bg-blue-500/15 text-blue-400 border-blue-500/20",
	occluded: "bg-orange-500/15 text-orange-400 border-orange-500/20",
	low_lighting: "bg-purple-500/15 text-purple-400 border-purple-500/20",
	dexterous_pose: "bg-red-500/15 text-red-400 border-red-500/20",
};

const statusColors: Record<string, string> = {
	pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
	approved: "bg-green-500/15 text-green-400 border-green-500/20",
	rejected: "bg-red-500/15 text-red-400 border-red-500/20",
	corrected: "bg-blue-500/15 text-blue-400 border-blue-500/20",
};

function FrameDetailPage() {
	const { frameId } = Route.useParams();
	const navigate = useNavigate();
	const [frame, setFrame] = useState<Frame | null>(null);
	const [video, setVideo] = useState<Video | null>(null);
	const [annotation, setAnnotation] = useState<AnnotationWithMeta | null>(null);
	const [error, setError] = useState("");

	const [reviewMode, setReviewMode] = useState(false);
	const [editedBoxes, setEditedBoxes] = useState<BoundingBox[]>([]);
	const [editedNoHands, setEditedNoHands] = useState(false);
	const [editedNotes, setEditedNotes] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selectedIdRef = useRef(selectedId);
	selectedIdRef.current = selectedId;
	const [reviewNotes, setReviewNotes] = useState("");
	const [saving, setSaving] = useState(false);
	const canvasRef = useRef<ZoomControl>(null);
	const [canvasZoom, setCanvasZoom] = useState(1);
	const { add: bufferAdd } = useSyncBuffer();
	const historyRef = useRef<{ boxes: BoundingBox[] }[]>([]);
	const historyIndexRef = useRef(-1);

	function pushHistory(newBoxes: BoundingBox[]) {
		const idx = historyIndexRef.current;
		historyRef.current = [
			...historyRef.current.slice(0, idx + 1),
			{ boxes: newBoxes },
		];
		historyIndexRef.current = idx + 1;
	}

	const handleEditedBoxesChange = useCallback((newBoxes: BoundingBox[]) => {
		setEditedBoxes(newBoxes);
		pushHistory(newBoxes);
	}, []);

	const handleUndoFrame = useCallback(() => {
		if (historyIndexRef.current > 0) {
			historyIndexRef.current--;
			setEditedBoxes(historyRef.current[historyIndexRef.current].boxes);
		}
	}, []);

	const handleRedoFrame = useCallback(() => {
		if (historyIndexRef.current < historyRef.current.length - 1) {
			historyIndexRef.current++;
			setEditedBoxes(historyRef.current[historyIndexRef.current].boxes);
		}
	}, []);

	const handleSendToBackFrame = useCallback(() => {
		const sid = selectedIdRef.current;
		if (!sid) return;
		const idx = editedBoxes.findIndex((b) => b.id === sid);
		if (idx <= 0) return;
		const newBoxes = [...editedBoxes];
		const [moved] = newBoxes.splice(idx, 1);
		newBoxes.unshift(moved);
		setEditedBoxes(newBoxes);
		pushHistory(newBoxes);
	}, [editedBoxes]);

	const handleBringToFrontFrame = useCallback(() => {
		const sid = selectedIdRef.current;
		if (!sid) return;
		const idx = editedBoxes.findIndex((b) => b.id === sid);
		if (idx < 0 || idx >= editedBoxes.length - 1) return;
		const newBoxes = [...editedBoxes];
		const [moved] = newBoxes.splice(idx, 1);
		newBoxes.push(moved);
		setEditedBoxes(newBoxes);
		pushHistory(newBoxes);
	}, [editedBoxes]);

	const handleDeleteSelectedFrame = useCallback(() => {
		const sid = selectedIdRef.current;
		if (sid) {
			const newBoxes = editedBoxes.filter((b) => b.id !== sid);
			setEditedBoxes(newBoxes);
			setSelectedId(null);
			pushHistory(newBoxes);
		}
	}, [editedBoxes]);

	const handleNoHandsFrame = useCallback(() => {
		setEditedNoHands(true);
		setEditedBoxes([]);
		setSelectedId(null);
		pushHistory([]);
	}, []);

	const loadAnnotation = useCallback(async (f: Frame) => {
		try {
			const a = await api.admin.getFrameAnnotation(f.id);
			setAnnotation(a);
			if (a) {
				const hasCorrection =
					a.corrected_bounding_boxes && a.corrected_bounding_boxes.length > 0;
				setEditedBoxes(
					hasCorrection ? a.corrected_bounding_boxes : a.bounding_boxes,
				);
				setEditedNoHands(hasCorrection ? a.corrected_no_hands : a.no_hands);
				setEditedNotes(a.notes);
			}
		} catch {}
	}, []);

	useEffect(() => {
		async function load() {
			try {
				const f = await api.admin.getFrame(frameId);
				setFrame(f);
				const v = await api.admin.getVideo(f.video_id);
				setVideo(v);
				await loadAnnotation(f);
			} catch (err: any) {
				setError(err.message || "Failed to load frame");
			}
		}
		load();
	}, [frameId, loadAnnotation]);

	function effectiveBoxes(a: AnnotationWithMeta) {
		return a.corrected_bounding_boxes && a.corrected_bounding_boxes.length > 0
			? a.corrected_bounding_boxes
			: a.bounding_boxes;
	}

	function effectiveNoHands(a: AnnotationWithMeta) {
		return a.corrected_bounding_boxes && a.corrected_bounding_boxes.length > 0
			? a.corrected_no_hands
			: a.no_hands;
	}

	function enterReviewMode() {
		if (!annotation) return;
		setReviewMode(true);
		const initialBoxes = effectiveBoxes(annotation);
		setEditedBoxes(initialBoxes);
		setEditedNoHands(effectiveNoHands(annotation));
		setEditedNotes(annotation?.notes || "");
		setSelectedId(null);
		historyRef.current = [{ boxes: initialBoxes }];
		historyIndexRef.current = 0;
	}

	function exitReviewMode() {
		if (!annotation) return;
		setReviewMode(false);
		setEditedBoxes(effectiveBoxes(annotation));
		setEditedNoHands(effectiveNoHands(annotation));
		setSelectedId(null);
	}

	async function handleSave() {
		if (!annotation) return;
		setSaving(true);
		setError("");
		try {
			await api.admin.updateAnnotation(annotation.id, {
				no_hands: editedNoHands,
				bounding_boxes: editedBoxes,
				notes: editedNotes,
				review_notes: reviewNotes,
			});
			await loadAnnotation(frame!);
			setReviewMode(false);
			setReviewNotes("");
		} catch (err: any) {
			if (isNetworkError(err)) {
				bufferAdd({
					type: "update",
					annotationId: annotation.id,
					data: {
						no_hands: editedNoHands,
						bounding_boxes: editedBoxes,
						notes: editedNotes,
						review_notes: reviewNotes,
					},
				});
				setReviewMode(false);
				setReviewNotes("");
			} else {
				setError(err.message || "Failed to save correction");
			}
		} finally {
			setSaving(false);
		}
	}

	async function handleApprove() {
		if (!annotation) return;
		setSaving(true);
		setError("");
		try {
			await api.admin.approveAnnotation(annotation.id, reviewNotes);
			await loadAnnotation(frame!);
		} catch (err: any) {
			if (isNetworkError(err)) {
				bufferAdd({
					type: "approve",
					annotationId: annotation.id,
					review_notes: reviewNotes,
				});
				setReviewNotes("");
			} else {
				setError(err.message || "Failed to approve");
			}
		} finally {
			setSaving(false);
		}
	}

	async function handleReject() {
		if (!annotation) return;
		setSaving(true);
		setError("");
		try {
			await api.admin.rejectAnnotation(annotation.id, reviewNotes);
			await loadAnnotation(frame!);
		} catch (err: any) {
			if (isNetworkError(err)) {
				bufferAdd({
					type: "reject",
					annotationId: annotation.id,
					review_notes: reviewNotes,
				});
				setReviewNotes("");
			} else {
				setError(err.message || "Failed to reject");
			}
		} finally {
			setSaving(false);
		}
	}

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (!reviewMode) return;
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement
			)
				return;
			if (
				(e.key === "Delete" || e.key === "Backspace") &&
				selectedIdRef.current
			) {
				e.preventDefault();
				handleDeleteSelectedFrame();
			} else if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
				e.preventDefault();
				handleUndoFrame();
			} else if (
				(e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey) ||
				(e.key === "y" && (e.ctrlKey || e.metaKey))
			) {
				e.preventDefault();
				handleRedoFrame();
			} else if (e.key === "[" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				handleSendToBackFrame();
			} else if (e.key === "]" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				handleBringToFrontFrame();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		reviewMode,
		handleUndoFrame,
		handleRedoFrame,
		handleSendToBackFrame,
		handleBringToFrontFrame,
		handleDeleteSelectedFrame,
	]);

	if (error) {
		return (
			<div className="p-6">
				<div className="text-destructive mb-4">{error}</div>
				<Button
					variant="outline"
					onClick={() => navigate({ to: "/admin/reviews" })}
				>
					Back to Reviews
				</Button>
			</div>
		);
	}

	if (!frame || !video) {
		return <div className="p-6 text-muted-foreground">Loading...</div>;
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
						<button
							onClick={() => navigate({ to: "/admin/reviews" })}
							className="hover:text-foreground"
						>
							Reviews
						</button>
						<span>/</span>
						<button
							onClick={() =>
								navigate({
									to: "/admin/video/$videoId",
									params: { videoId: video.id },
								})
							}
							className="hover:text-foreground font-mono text-xs"
						>
							{video.stem}
						</button>
						<span>/</span>
						<span className="text-foreground">Frame #{frame.frame_index}</span>
					</div>
					<h1 className="text-2xl font-semibold">Frame #{frame.frame_index}</h1>
				</div>
				<div className="flex items-center gap-2">
					<SyncStatusBadge />
					{annotation && (
						<Badge
							variant="outline"
							className={
								statusColors[annotation.review_status] ||
								"bg-yellow-500/15 text-yellow-400"
							}
						>
							{annotation.review_status || "pending"}
						</Badge>
					)}
					<Badge variant="outline" className={labelColors[frame.label] || ""}>
						{frame.label.replace(/_/g, " ")}
					</Badge>
				</div>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				<div className="lg:col-span-2 space-y-3">
					{reviewMode && annotation && (
						<div className="flex items-center gap-2">
							<Button
								size="sm"
								variant={editedNoHands ? "default" : "outline"}
								onClick={handleNoHandsFrame}
							>
								No Hands
							</Button>
							<AnnotationToolbar
								boxes={editedBoxes}
								onBoxesChange={handleEditedBoxesChange}
								selectedId={selectedId}
								onSelectedChange={setSelectedId}
								onUndo={handleUndoFrame}
								onRedo={handleRedoFrame}
								canUndo={historyIndexRef.current > 0}
								canRedo={
									historyIndexRef.current < historyRef.current.length - 1
								}
								onZoomIn={() => canvasRef.current?.zoomIn()}
								onZoomOut={() => canvasRef.current?.zoomOut()}
								onZoomReset={() => canvasRef.current?.zoomReset()}
								zoom={canvasZoom}
								disabled={saving}
								onSendToBack={handleSendToBackFrame}
								onBringToFront={handleBringToFrontFrame}
							/>
						</div>
					)}
					<div className="h-[500px] border border-border rounded-lg overflow-hidden">
						<AnnotationCanvas
							zoomRef={canvasRef}
							imageUrl={frameImageUrl(video.stem, frame.label, frame.filename)}
							boxes={
								reviewMode
									? editedBoxes
									: annotation
										? effectiveBoxes(annotation)
										: []
							}
							onBoxesChange={reviewMode ? handleEditedBoxesChange : () => {}}
							selectedId={reviewMode ? selectedId : null}
							onSelectedChange={reviewMode ? setSelectedId : () => {}}
							readOnly={!reviewMode}
							onZoomChange={setCanvasZoom}
						/>
					</div>
					<p className="text-xs text-muted-foreground text-center">
						t={frame.timestamp_s.toFixed(2)}s · {frame.filename}
					</p>
					{reviewMode && (
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							<span className="text-yellow-500">Review mode</span>
							<span>·</span>
							<span>Draw new boxes, drag to move, drag handles to resize</span>
							<span>·</span>
							<span>
								Press{" "}
								<kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">
									1
								</kbd>{" "}
								L /{" "}
								<kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">
									2
								</kbd>{" "}
								R for selected box
							</span>
						</div>
					)}
				</div>

				<div className="space-y-4">
					<div className="border border-border rounded-lg p-4 space-y-3">
						<h3 className="text-sm font-medium">Frame Details</h3>
						<div className="space-y-2 text-sm">
							<div className="flex justify-between">
								<span className="text-muted-foreground">Index</span>
								<span className="font-mono">#{frame.frame_index}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">Timestamp</span>
								<span>{frame.timestamp_s.toFixed(2)}s</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">Label</span>
								<span>{frame.label.replace(/_/g, " ")}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">Detected hands</span>
								<span>{frame.num_hands}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">Confidence</span>
								<span>{frame.hand_evidence.toFixed(3)}</span>
							</div>
						</div>
					</div>

					{annotation ? (
						<>
							<div className="border border-border rounded-lg p-4 space-y-3">
								<h3 className="text-sm font-medium">Annotation</h3>
								<div className="space-y-2 text-sm">
									<div className="flex justify-between">
										<span className="text-muted-foreground">No hands</span>
										<span>{effectiveNoHands(annotation) ? "Yes" : "No"}</span>
									</div>
									<div className="flex justify-between">
										<span className="text-muted-foreground">Boxes</span>
										<span>{effectiveBoxes(annotation).length}</span>
									</div>
									{effectiveBoxes(annotation).length > 0 && (
										<div className="pt-2 space-y-1">
											{effectiveBoxes(annotation).map((box, i) => (
												<div
													key={box.id}
													className="flex items-center gap-2 text-xs"
												>
													<span
														className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold text-white ${
															box.hand === "left"
																? "bg-blue-500"
																: "bg-orange-500"
														}`}
													>
														{box.hand === "left" ? "L" : "R"}
													</span>
													<span className="text-muted-foreground">
														Box {i + 1}: ({(box.x * 100).toFixed(0)}%,{" "}
														{(box.y * 100).toFixed(0)}%)
														{(box.width * 100).toFixed(0)}×
														{(box.height * 100).toFixed(0)}%
													</span>
												</div>
											))}
											{annotation.review_status === "corrected" &&
												annotation.corrected_bounding_boxes?.length > 0 && (
													<p className="text-[10px] text-blue-400 mt-1">
														Showing corrected annotation
													</p>
												)}
										</div>
									)}
									<div className="flex justify-between pt-2 border-t border-border">
										<span className="text-muted-foreground">Annotator</span>
										<span className="text-xs">
											{annotation.annotator_email}
										</span>
									</div>
									<div className="flex justify-between">
										<span className="text-muted-foreground">Submitted</span>
										<span className="text-xs">
											{new Date(annotation.created_at * 1000).toLocaleString()}
										</span>
									</div>
									{annotation.notes && (
										<div className="pt-2 border-t border-border">
											<span className="text-muted-foreground block mb-1">
												Annotator notes
											</span>
											<p className="text-xs bg-muted/50 rounded p-2">
												{annotation.notes}
											</p>
										</div>
									)}
									{annotation.review_status &&
										annotation.review_status !== "pending" && (
											<div className="pt-2 border-t border-border space-y-1">
												<div className="flex justify-between">
													<span className="text-muted-foreground">
														Review status
													</span>
													<Badge
														variant="outline"
														className={`text-[10px] ${statusColors[annotation.review_status] || ""}`}
													>
														{annotation.review_status}
													</Badge>
												</div>
												{annotation.reviewed_by_email && (
													<div className="flex justify-between">
														<span className="text-muted-foreground">
															Reviewed by
														</span>
														<span className="text-xs">
															{annotation.reviewed_by_email}
														</span>
													</div>
												)}
												{annotation.review_notes && (
													<div>
														<span className="text-muted-foreground text-[10px] block mb-0.5">
															Review notes
														</span>
														<p className="text-xs bg-muted/50 rounded p-2">
															{annotation.review_notes}
														</p>
													</div>
												)}
											</div>
										)}
								</div>
							</div>

							{reviewMode && (
								<div className="border border-border rounded-lg p-4 space-y-3">
									<h3 className="text-sm font-medium">Review Actions</h3>
									<div className="space-y-3">
										<div>
											<label className="text-xs text-muted-foreground block mb-1">
												Review notes
											</label>
											<textarea
												value={reviewNotes}
												onChange={(e) => setReviewNotes(e.target.value)}
												className="w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
												placeholder="Notes about this review..."
											/>
										</div>
										<div className="flex gap-2">
											<Button
												size="sm"
												variant="default"
												className="flex-1"
												onClick={handleSave}
												disabled={saving}
											>
												{saving ? "Saving…" : "Save Correction"}
											</Button>
										</div>
										<div className="flex gap-2">
											<Button
												size="sm"
												variant="outline"
												className="flex-1 border-green-500/30 text-green-500 hover:bg-green-500/10"
												onClick={handleApprove}
												disabled={saving}
											>
												Approve
											</Button>
											<Button
												size="sm"
												variant="outline"
												className="flex-1 border-red-500/30 text-red-500 hover:bg-red-500/10"
												onClick={handleReject}
												disabled={saving}
											>
												Reject
											</Button>
										</div>
										<Button
											size="sm"
											variant="ghost"
											className="w-full"
											onClick={exitReviewMode}
											disabled={saving}
										>
											Cancel
										</Button>
									</div>
								</div>
							)}
						</>
					) : (
						<div className="border border-border rounded-lg p-4">
							<h3 className="text-sm font-medium mb-2">Annotation</h3>
							<p className="text-sm text-muted-foreground">No annotation yet</p>
						</div>
					)}

					{!reviewMode && (
						<div className="space-y-2">
							<Button
								variant="default"
								className="w-full"
								disabled={!annotation}
								onClick={enterReviewMode}
							>
								{annotation?.review_status &&
								annotation.review_status !== "pending"
									? "Review Again"
									: "Review Annotation"}
							</Button>
							<Button
								variant="outline"
								className="w-full"
								onClick={() =>
									navigate({
										to: "/admin/video/$videoId",
										params: { videoId: video.id },
									})
								}
							>
								Back to Video
							</Button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
