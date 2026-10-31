import { redirect } from "next/navigation";

/** Signer approval stays off the page. The API and signer code remain available. */
export default function FarcasterApprovePage() {
  redirect("/");
}
