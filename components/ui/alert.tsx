import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-current",
  {
    variants: {
      variant: {
        // The semantic variants below use tinted brand hexes that clear 4.5:1
        // on both themes; only this neutral one was light-only.
        default: "bg-slate-50 text-slate-900 border-slate-200 [&>svg]:text-slate-600 dark:bg-slate-900/60 dark:text-slate-100 dark:border-slate-700 dark:[&>svg]:text-slate-400",
        destructive:
          "border-[#EF4444]/30 bg-[#EF4444]/5 text-[#EF4444] [&>svg]:text-[#EF4444]",
        success:
          "border-[#22C55E]/30 bg-[#22C55E]/5 text-[#16A34A] [&>svg]:text-[#22C55E]",
        warning:
          "border-[#F59E0B]/30 bg-[#F59E0B]/5 text-[#D97706] [&>svg]:text-[#F59E0B]",
        info:
          "border-[#0EA5E9]/30 bg-[#0EA5E9]/5 text-[#0369A1] [&>svg]:text-[#0EA5E9]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
