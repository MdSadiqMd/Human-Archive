import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAuth } from "#/lib/auth";
import { api } from "#/lib/api";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
	Card,
	CardContent,
	CardFooter,
} from "#/components/ui/card";
import { Alert, AlertDescription } from "#/components/ui/alert";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
	const { login, user } = useAuth();
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (user?.role === "admin") navigate({ to: "/admin/users" });
	}, [user]);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError("");
		setLoading(true);
		try {
			const res = await api.auth.login(email, password);
			login(res.token, res.user);
			if (res.user.role === "admin") {
				navigate({ to: "/admin/users" });
			} else {
				navigate({ to: "/dashboard" });
			}
		} catch (err: any) {
			const msg = err.message || "Login failed";
			if (msg.includes("pending")) {
				setError("Your account is pending admin approval.");
			} else if (msg.includes("rejected")) {
				setError("Your account has been rejected.");
			} else {
				setError("Invalid email or password.");
			}
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="min-h-screen flex items-center justify-center px-4">
			<div className="w-full max-w-sm">
				<div className="text-center mb-8">
					<div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 mb-4">
						<svg
							className="w-6 h-6 text-primary"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={1.5}
								d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"
							/>
						</svg>
					</div>
					<h1 className="text-xl font-semibold text-foreground">
						Hand Tracking Annotation
					</h1>
					<p className="text-sm text-muted-foreground mt-1">
						Sign in to your account
					</p>
				</div>

				<Card>
					<form onSubmit={handleSubmit}>
						<CardContent className="pt-6 space-y-4">
							{error && (
								<Alert variant="destructive">
									<AlertDescription>{error}</AlertDescription>
								</Alert>
							)}
							<div className="space-y-2">
								<Label htmlFor="email">Email</Label>
								<Input
									id="email"
									type="email"
									placeholder="you@example.com"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									required
									autoComplete="email"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="password">Password</Label>
								<Input
									id="password"
									type="password"
									placeholder="••••••••"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
									autoComplete="current-password"
								/>
							</div>
						</CardContent>
						<CardFooter className="flex flex-col gap-3">
							<Button type="submit" className="w-full" disabled={loading}>
								{loading ? "Signing in…" : "Sign in"}
							</Button>
							<p className="text-sm text-muted-foreground text-center">
								Need access?{" "}
								<Link
									to="/register"
									className="text-foreground underline underline-offset-4 hover:text-primary"
								>
									Request an account
								</Link>
							</p>
						</CardFooter>
					</form>
				</Card>
			</div>
		</div>
	);
}
