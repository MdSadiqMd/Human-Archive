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
	},
};
