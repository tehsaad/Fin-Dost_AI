import { Building2, GraduationCap, Home, Store } from "lucide-react";
import type { ElementType } from "react";
import type { Kind } from "@/lib/types";

export const KIND_ICONS: Record<Kind, ElementType> = { sme: Store, enterprise: Building2, household: Home, student: GraduationCap };
