const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8080";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const token = localStorage.getItem("token");
	const res = await fetch(`${API_BASE}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...options?.headers,
		},
	});

	if (res.status === 204) return undefined as T;

	const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));

	if (!res.ok) {
		throw new Error(data.error || `HTTP ${res.status}`);
	}

	return data as T;
}

export interface User {
	id: string;
	email: string;
	role: "annotator" | "admin";
	status: "pending" | "active" | "rejected";
	created_at: string;
	updated_at: string;
}

export interface LoginResponse {
	token: string;
	user: User;
}

export interface RegisterResponse {
	message: string;
	user: User;
}

export interface Video {
	id: string;
	s3_key: string;
	stem: string;
	fps: number;
	duration_s: number;
	total_frames: number;
	sampled_frames: number;
	label_counts: Record<string, number>;
	status: string;
	ingested_at: string;
	ingested_by: string;
}

export interface Frame {
	id: string;
	video_id: string;
	frame_index: number;
	timestamp_s: number;
	label: string;
	filename: string;
	num_hands: number;
	hand_evidence: number;
	sample_reason: string;
	scores: Record<string, number>;
	features: Record<string, unknown>;
}

export interface PaginatedFrames {
	frames: Frame[];
	total: number;
	page: number;
	per_page: number;
	total_pages: number;
}

export interface Assignment {
	id: string;
	frame_id: string;
	assignee_id: string;
	assigned_by: string;
	status: string;
	assigned_at: string;
	completed_at: string | null;
	frame_index: number;
	label: string;
	filename: string;
	video_stem: string;
}

export interface QueueItem {
	assignment_id: string;
	frame_id: string;
	frame_index: number;
	label: string;
	filename: string;
	video_stem: string;
	timestamp_s: number;
	num_hands: number;
	hand_evidence: number;
}

export interface QueueProgress {
	pending: number;
	completed: number;
	skipped: number;
	total: number;
}

export interface QueueResponse {
	items: QueueItem[];
	progress: QueueProgress;
}

export interface BoundingBox {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	hand: "left" | "right";
}

export interface AnnotationInput {
	no_hands: boolean;
	bounding_boxes: BoundingBox[];
	notes?: string;
}

export interface Annotation {
	id: string;
	assignment_id: string;
	frame_id: string;
	annotator_id: string;
	no_hands: boolean;
	left_hand: boolean;
	right_hand: boolean;
	bounding_boxes: BoundingBox[];
	notes: string;
	created_at: string;
	updated_at: string;
}

export interface AnnotationWithMeta {
	id: string;
	frame_id: string;
	no_hands: boolean;
	bounding_boxes: BoundingBox[];
	corrected_bounding_boxes: BoundingBox[];
	corrected_no_hands: boolean;
	notes: string;
	annotator_id: string;
	annotator_email: string;
	created_at: number;
	review_status: string;
	reviewed_by: string;
	reviewed_by_email: string;
	reviewed_at: number;
	review_notes: string;
}

export interface AnnotatorReviewStats {
	annotator_id: string;
	annotator_email: string;
	total_completed: number;
	pending_review: number;
}

export interface ReviewItem {
	annotation_id: string;
	frame_id: string;
	frame_index: number;
	label: string;
	filename: string;
	video_stem: string;
	video_id: string;
	no_hands: boolean;
	bounding_boxes: BoundingBox[];
	corrected_bounding_boxes: BoundingBox[];
	corrected_no_hands: boolean;
	annotator_id: string;
	annotator_email: string;
	created_at: number;
	review_status: string;
	reviewed_by_email?: string;
	review_notes?: string;
}

export interface PaginatedReviews {
	items: ReviewItem[];
	total: number;
	page: number;
	per_page: number;
	total_pages: number;
}

export interface ExportRow {
	frame_index: number;
	timestamp_s: number;
	label: string;
	no_hands: boolean;
	left_hand: boolean;
	right_hand: boolean;
	bounding_boxes: BoundingBox[];
	notes: string;
	annotator_id: string;
	annotator_email: string;
}

export function frameImageUrl(
	stem: string,
	label: string,
	filename: string,
): string {
	const token = localStorage.getItem("token");
	const url = `${API_BASE}/frames/${stem}/frames/${label}/${filename}`;
	return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

export const api = {
	auth: {
		login: (email: string, password: string) =>
			request<LoginResponse>("/auth/login", {
				method: "POST",
				body: JSON.stringify({ email, password }),
			}),
		register: (email: string, password: string) =>
			request<RegisterResponse>("/auth/register", {
				method: "POST",
				body: JSON.stringify({ email, password }),
			}),
		me: () => request<User>("/auth/me"),
	},
	admin: {
		listUsers: (params?: { role?: string; status?: string }) => {
			const q = new URLSearchParams();
			if (params?.role) q.set("role", params.role);
			if (params?.status) q.set("status", params.status);
			const qs = q.toString();
			return request<User[]>(`/admin/users${qs ? `?${qs}` : ""}`);
		},
		listPending: () => request<User[]>("/admin/users/pending"),
		approveUser: (id: string) =>
			request<User>(`/admin/users/${id}/approve`, { method: "POST" }),
		rejectUser: (id: string) =>
			request<User>(`/admin/users/${id}/reject`, { method: "POST" }),
		deleteUser: (id: string) =>
			request<void>(`/admin/users/${id}`, { method: "DELETE" }),
		ingest: (directory: string) =>
			request<{ message: string; videos: number; frames: number }>(
				"/admin/ingest",
				{
					method: "POST",
					body: JSON.stringify({ directory }),
				},
			),
		listVideos: () => request<Video[]>("/admin/videos"),
		getVideo: (id: string) => request<Video>(`/admin/videos/${id}`),
		listFrames: (
			videoId: string,
			params?: { label?: string; page?: number; per_page?: number },
		) => {
			const q = new URLSearchParams();
			if (params?.label && params.label !== "all") q.set("label", params.label);
			if (params?.page) q.set("page", String(params.page));
			if (params?.per_page) q.set("per_page", String(params.per_page));
			const qs = q.toString();
			return request<PaginatedFrames>(
				`/admin/videos/${videoId}/frames${qs ? `?${qs}` : ""}`,
			);
		},
		getFrame: (id: string) => request<Frame>(`/admin/frames/${id}`),
		assignFrames: (frameIds: string[], assigneeId: string) =>
			request<{ assigned: number }>("/admin/assignments", {
				method: "POST",
				body: JSON.stringify({ frame_ids: frameIds, assignee_id: assigneeId }),
			}),
		assignByFilter: (params: {
			video_id?: string;
			label?: string;
			assignee_id: string;
		}) =>
			request<{ assigned: number }>("/admin/assignments/by-filter", {
				method: "POST",
				body: JSON.stringify(params),
			}),
		listAssignments: (videoId?: string) => {
			const q = videoId ? `?video_id=${videoId}` : "";
			return request<Assignment[]>(`/admin/assignments${q}`);
		},
		deleteAssignment: (id: string) =>
			request<void>(`/admin/assignments/${id}`, { method: "DELETE" }),
		exportAnnotations: (videoId: string) =>
			request<ExportRow[]>(`/admin/export?video_id=${videoId}`),
		getFrameAnnotation: (frameId: string) =>
			request<AnnotationWithMeta | null>(`/admin/frames/${frameId}/annotation`),
		listReviewAnnotators: () =>
			request<AnnotatorReviewStats[]>("/admin/reviews/annotators"),
		listReviews: (params?: {
			status?: string;
			video_id?: string;
			annotator_id?: string;
			page?: number;
			per_page?: number;
		}) => {
			const q = new URLSearchParams();
			if (params?.status) q.set("status", params.status);
			if (params?.video_id) q.set("video_id", params.video_id);
			if (params?.annotator_id) q.set("annotator_id", params.annotator_id);
			if (params?.page) q.set("page", String(params.page));
			if (params?.per_page) q.set("per_page", String(params.per_page));
			const qs = q.toString();
			return request<PaginatedReviews>(`/admin/reviews${qs ? `?${qs}` : ""}`);
		},
		updateAnnotation: (
			id: string,
			data: {
				no_hands: boolean;
				bounding_boxes: BoundingBox[];
				notes: string;
				review_notes: string;
			},
		) =>
			request<{ status: string }>(`/admin/annotations/${id}`, {
				method: "PUT",
				body: JSON.stringify(data),
			}),
		approveAnnotation: (id: string, review_notes: string) =>
			request<{ status: string }>(`/admin/annotations/${id}/approve`, {
				method: "POST",
				body: JSON.stringify({ review_notes }),
			}),
		rejectAnnotation: (id: string, review_notes: string) =>
			request<{ status: string }>(`/admin/annotations/${id}/reject`, {
				method: "POST",
				body: JSON.stringify({ review_notes }),
			}),
	},
	queue: {
		list: () => request<QueueResponse>("/queue"),
		get: (id: string) => request<QueueItem>(`/queue/${id}`),
		submit: (id: string, data: AnnotationInput) =>
			request<{ status: string }>(`/queue/${id}/submit`, {
				method: "POST",
				body: JSON.stringify(data),
			}),
		skip: (id: string) =>
			request<{ status: string }>(`/queue/${id}/skip`, { method: "POST" }),
	},
};
