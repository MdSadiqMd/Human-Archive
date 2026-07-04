import * as React from "react";
import * as SelectPrimitive from "radix-ui";
import { cn } from "#/lib/utils";

const Select = SelectPrimitive.Select.Root;

const SelectGroup = SelectPrimitive.Select.Group;

const SelectValue = SelectPrimitive.Select.Value;

const SelectTrigger = React.forwardRef<
	React.ComponentRef<typeof SelectPrimitive.Select.Trigger>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Select.Trigger>
>(({ className, children, ...props }, ref) => (
	<SelectPrimitive.Select.Trigger
		ref={ref}
		className={cn(
			"flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
			className,
		)}
		{...props}
	>
		{children}
		<SelectPrimitive.Select.Icon asChild>
			<svg
				className="h-4 w-4 opacity-50"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={2}
					d="M19 9l-7 7-7-7"
				/>
			</svg>
		</SelectPrimitive.Select.Icon>
	</SelectPrimitive.Select.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Select.Trigger.displayName;

const SelectContent = React.forwardRef<
	React.ComponentRef<typeof SelectPrimitive.Select.Content>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Select.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
	<SelectPrimitive.Select.Portal>
		<SelectPrimitive.Select.Content
			ref={ref}
			className={cn(
				"relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
				position === "popper" &&
					"data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
				className,
			)}
			position={position}
			{...props}
		>
			<SelectPrimitive.Select.Viewport
				className={cn(
					"p-1",
					position === "popper" &&
						"h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
				)}
			>
				{children}
			</SelectPrimitive.Select.Viewport>
		</SelectPrimitive.Select.Content>
	</SelectPrimitive.Select.Portal>
));
SelectContent.displayName = SelectPrimitive.Select.Content.displayName;

const SelectItem = React.forwardRef<
	React.ComponentRef<typeof SelectPrimitive.Select.Item>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Select.Item>
>(({ className, children, ...props }, ref) => (
	<SelectPrimitive.Select.Item
		ref={ref}
		className={cn(
			"relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
			className,
		)}
		{...props}
	>
		<SelectPrimitive.Select.ItemText>
			{children}
		</SelectPrimitive.Select.ItemText>
	</SelectPrimitive.Select.Item>
));
SelectItem.displayName = SelectPrimitive.Select.Item.displayName;

export {
	Select,
	SelectGroup,
	SelectValue,
	SelectTrigger,
	SelectContent,
	SelectItem,
};
