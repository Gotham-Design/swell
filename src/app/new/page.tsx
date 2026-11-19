import { Suspense } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { getMyBusinesses } from "@/lib/dal";
import { CreateBusinessForm } from "./create-business-form";

export default function NewBusinessPage() {
  return (
    <main className="min-h-dvh flex-1 px-4 pb-16 sm:px-10">
      <header className="flex items-center justify-between py-7">
        <Logo />
        <Suspense fallback={null}><BackLink /></Suspense>
      </header>
      <div className="pt-4"><CreateBusinessForm /></div>
    </main>
  );
}

async function BackLink() {
  const businesses = (await getMyBusinesses()).filter((b) => !b.archived);
  if (!businesses.length) return null;
  return <Link href="/" className="text-sm font-medium hover:underline">Back to your clients</Link>;
}
