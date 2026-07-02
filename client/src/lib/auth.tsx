import {
	createContext,
	useContext,
	useState,
	useEffect,
	type ReactNode,
} from "react";
import type { User } from "./api";

interface AuthState {
	user: User | null;
	token: string | null;
	isLoading: boolean;
}

interface AuthContext extends AuthState {
	login: (token: string, user: User) => void;
	logout: () => void;
}

const Context = createContext<AuthContext | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<AuthState>({
		user: null,
		token: null,
		isLoading: true,
	});

	useEffect(() => {
		const token = localStorage.getItem("token");
		const raw = localStorage.getItem("user");
		if (token && raw) {
			try {
				setState({ user: JSON.parse(raw), token, isLoading: false });
			} catch {
				localStorage.removeItem("token");
				localStorage.removeItem("user");
				setState({ user: null, token: null, isLoading: false });
			}
		} else {
			setState((s) => ({ ...s, isLoading: false }));
		}
	}, []);

	function login(token: string, user: User) {
		localStorage.setItem("token", token);
		localStorage.setItem("user", JSON.stringify(user));
		setState({ user, token, isLoading: false });
	}

	function logout() {
		localStorage.removeItem("token");
		localStorage.removeItem("user");
		setState({ user: null, token: null, isLoading: false });
	}

	return (
		<Context.Provider value={{ ...state, login, logout }}>
			{children}
		</Context.Provider>
	);
}

export function useAuth() {
	const ctx = useContext(Context);
	if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
	return ctx;
}
