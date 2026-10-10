import type { ElementType } from "react";
import {
  AlertTriangle, BookOpen, Boxes, ClipboardCheck, FileBarChart2, FileUp, LayoutDashboard, LifeBuoy,
  NotebookPen, PiggyBank, ShieldCheck, Target, TrendingUp, Users, Zap,
} from "lucide-react";
import { termsFor } from "@/lib/terms";
import type { Feature, Kind } from "@/lib/types";

export type NavItem = { href: string; label: string; urdu: string; icon: ElementType; feature?: Feature };
type NavGroup = { title: string; items: NavItem[] };

/** Navigation per account type: same modules underneath, organised and worded for that kind of user. */
export function navGroups(kind: Kind): NavGroup[] {
  const t = termsFor(kind);
  if (kind === "enterprise") {
    return [
      { title: "Overview", items: [{ href: "/dashboard", label: t.dashboard, urdu: "جائزہ", icon: LayoutDashboard }] },
      { title: "Records", items: [
        { href: "/transactions", label: t.ledger, urdu: "لین دین", icon: NotebookPen, feature: "ledger" },
        { href: "/import", label: "Imports", urdu: "ڈیٹا شامل کریں", icon: FileUp, feature: "import" },
        { href: "/inventory", label: "Inventory", urdu: "اسٹاک", icon: Boxes, feature: "inventory" },
      ] },
      { title: "Planning", items: [
        { href: "/budget", label: "Budget vs Actual", urdu: "بجٹ", icon: PiggyBank, feature: "budget" },
        { href: "/forecast", label: t.forecast, urdu: "پیشگوئی", icon: TrendingUp, feature: "forecast" },
      ] },
      { title: "Risk & controls", items: [
        { href: "/alerts", label: t.alerts, urdu: "خطرات", icon: AlertTriangle, feature: "alerts" },
        { href: "/controls", label: "Data Checks", urdu: "جانچ", icon: ShieldCheck, feature: "controls" },
        { href: "/simulator", label: t.simulator, urdu: "منظرنامہ", icon: Zap, feature: "simulator" },
        { href: "/recovery", label: t.recovery, urdu: "بحالی", icon: LifeBuoy, feature: "recovery" },
      ] },
      { title: "Operations", items: [
        { href: "/actions", label: "Tasks & Approvals", urdu: "منظوری", icon: ClipboardCheck, feature: "actions" },
        { href: "/reports", label: t.reports, urdu: "رپورٹ", icon: FileBarChart2, feature: "reports" },
        { href: "/team", label: "Team & Access", urdu: "ٹیم", icon: Users, feature: "team" },
      ] },
      { title: "Help", items: [{ href: "/learn", label: "Learn the terms", urdu: "سیکھیں", icon: BookOpen }] },
    ];
  }
  if (t.personal) {
    return [
      { title: "Overview", items: [{ href: "/dashboard", label: t.dashboard, urdu: "میرا حساب", icon: LayoutDashboard }] },
      { title: "Money in & out", items: [
        { href: "/transactions", label: t.ledger, urdu: "آمدنی و خرچ", icon: NotebookPen, feature: "ledger" },
        { href: "/import", label: "Import statement", urdu: "ڈیٹا شامل کریں", icon: FileUp, feature: "import" },
      ] },
      { title: "Plan", items: [
        { href: "/budget", label: "Monthly Budget", urdu: "بجٹ", icon: PiggyBank, feature: "budget" },
        { href: "/goals", label: "Savings Goals", urdu: "بچت", icon: Target, feature: "goals" },
        { href: "/forecast", label: t.forecast, urdu: "پیشگوئی", icon: TrendingUp, feature: "forecast" },
        { href: "/simulator", label: t.simulator, urdu: "اگر ایسا ہو", icon: Zap, feature: "simulator" },
      ] },
      { title: "Stay on track", items: [
        { href: "/alerts", label: t.alerts, urdu: "انتباہ", icon: AlertTriangle, feature: "alerts" },
        { href: "/recovery", label: t.recovery, urdu: "خرچ میں تبدیلی", icon: LifeBuoy, feature: "recovery" },
        { href: "/reports", label: t.reports, urdu: "خلاصہ", icon: FileBarChart2, feature: "reports" },
        { href: "/learn", label: "Learn the terms", urdu: "سیکھیں", icon: BookOpen },
      ] },
    ];
  }
  return [
    { title: "Overview", items: [{ href: "/dashboard", label: t.dashboard, urdu: "ڈیش بورڈ", icon: LayoutDashboard }] },
    { title: "Records", items: [
      { href: "/transactions", label: t.ledger, urdu: "کھاتہ", icon: NotebookPen, feature: "ledger" },
      { href: "/import", label: "Import CSV", urdu: "ڈیٹا شامل کریں", icon: FileUp, feature: "import" },
      { href: "/inventory", label: "Inventory", urdu: "اسٹاک", icon: Boxes, feature: "inventory" },
    ] },
    { title: "Intelligence", items: [
      { href: "/forecast", label: t.forecast, urdu: "پیشگوئی", icon: TrendingUp, feature: "forecast" },
      { href: "/budget", label: "Budget", urdu: "بجٹ", icon: PiggyBank, feature: "budget" },
      { href: "/alerts", label: t.alerts, urdu: "خطرات", icon: AlertTriangle, feature: "alerts" },
      { href: "/controls", label: "Data Checks", urdu: "جانچ", icon: ShieldCheck, feature: "controls" },
      { href: "/simulator", label: t.simulator, urdu: "جھٹکا ٹیسٹ", icon: Zap, feature: "simulator" },
      { href: "/recovery", label: t.recovery, urdu: "بحالی", icon: LifeBuoy, feature: "recovery" },
    ] },
    { title: "Insights", items: [
      { href: "/actions", label: "Tasks", urdu: "کام", icon: ClipboardCheck, feature: "actions" },
      { href: "/reports", label: t.reports, urdu: "رپورٹ", icon: FileBarChart2, feature: "reports" },
      { href: "/learn", label: "Learn the terms", urdu: "سیکھیں", icon: BookOpen },
    ] },
  ];
}

