import { forwardRef } from "react";
import { cn } from "../../utils/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "ui-btn-primary",
  secondary: "ui-btn-secondary",
  ghost: "ui-btn-ghost",
  outline: "ui-btn-outline",
  danger: "ui-btn-danger",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "ui-btn-sm",
  md: "",
  lg: "ui-btn-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "ghost", size = "md", type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn("ui-btn", SIZE_CLASS[size], VARIANT_CLASS[variant], className)}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

