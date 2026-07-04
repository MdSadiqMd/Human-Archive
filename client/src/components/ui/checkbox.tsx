import * as React from "react";
import * as CheckboxPrimitive from "radix-ui";
import { cn } from "#/lib/utils";

const Checkbox = React.forwardRef<
	React.ComponentRef<typeof CheckboxPrimitive.Checkbox.Root>,
	React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Checkbox.Root>
>(({ className, ...props }, ref) => (
	<CheckboxPrimitive.Checkbox.Root
		ref={ref}
		className={cn(
			"peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
			className,
		)}
		{...props}
	>
		<CheckboxPrimitive.Checkbox.Indicator
			className={cn("flex items-center justify-center text-current")}
		>
			<svg
				className="h-4 w-4"
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
		</CheckboxPrimitive.Checkbox.Indicator>
	</CheckboxPrimitive.Checkbox.Root>
));
Checkbox.displayName = CheckboxPrimitive.Checkbox.Root.displayName;

export { Checkbox };
