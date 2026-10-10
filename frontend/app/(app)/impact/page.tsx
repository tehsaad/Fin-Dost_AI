import { redirect } from "next/navigation";

/** SDG impact and the benchmark now live on the public home page (one place, not every workspace). */
export default function ImpactPage() {
  redirect("/#impact");
}
