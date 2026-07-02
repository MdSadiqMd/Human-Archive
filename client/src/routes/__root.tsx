import {
	HeadContent,
	Scripts,
	createRootRoute,
	Outlet,
} from "@tanstack/react-router";
import { AuthProvider } from "#/lib/auth";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "Hand Tracking Annotation" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className="dark">
			<head>
				<HeadContent />
			</head>
			<body>
				<AuthProvider>{children}</AuthProvider>
				<Scripts />
			</body>
		</html>
	);
}
