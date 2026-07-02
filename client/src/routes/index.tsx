import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "#/lib/auth";
import { useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const { user, isLoading } = useAuth();
	const navigate = useNavigate();

	useEffect(() => {
		if (isLoading) return;
		if (!user) {
			navigate({ to: "/login" });
		} else if (user.role === "admin") {
			navigate({ to: "/admin/users" });
		} else {
			navigate({ to: "/dashboard" });
		}
	}, [user, isLoading]);

	return null;
}
