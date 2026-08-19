"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { EditEmployeeForm } from "./edit-employee-form";

interface Department { id: string; name: string; }
interface ManagerOption { id: string; user: { name: string | null }; }
interface Region { id: string; name: string; }

interface EditEmployeeTriggerProps {
  employeeId: string;
  initial: {
    jobTitle: string;
    employmentType: string;
    startDate: string;
    phone: string | null;
    emergencyContact: string | null;
    emergencyPhone: string | null;
    address: string | null;
    isActive: boolean;
    departmentId: string | null;
    managerId: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string;
    role: string;
    regionId: string | null;
    gender: string | null;
    // Timesheet configuration (migration 028). Optional so callers that do not
    // manage timesheets need not supply them.
    timesheetRequired?: boolean;
    timesheetFrequency?: string | null;
    standardWorkingHours?: number | null;
    timesheetApproverId?: string | null;
    costCentre?: string | null;
  };
  departments: Department[];
  managers: ManagerOption[];
  regions: Region[];
  isHR: boolean;
  isSuperAdmin: boolean;
}

export function EditEmployeeTrigger(props: EditEmployeeTriggerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4 mr-1" /> Edit
      </Button>
      <EditEmployeeForm
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={() => { setOpen(false); router.refresh(); }}
        {...props}
      />
    </>
  );
}
