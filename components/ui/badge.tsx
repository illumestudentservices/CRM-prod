import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#1E3A5F] focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[#1E3A5F] text-white hover:bg-[#1E3A5F]/80",
        secondary:
          "border-transparent bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
        destructive:
          "border-transparent bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20 hover:bg-[#EF4444]/20",
        outline:
          "border-slate-200 text-slate-700 bg-transparent dark:border-slate-700 dark:text-slate-300",
        success:
          "border-transparent bg-[#22C55E]/10 text-[#16A34A] border-[#22C55E]/20 hover:bg-[#22C55E]/20",
        warning:
          "border-transparent bg-[#F59E0B]/10 text-[#D97706] border-[#F59E0B]/20 hover:bg-[#F59E0B]/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
