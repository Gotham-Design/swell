import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-3 px-6 py-24 text-center">
      <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-3xl">Not found</h1>
      <p className="text-muted-foreground">That page doesn&apos;t exist, or it belongs to a business you&apos;re not a member of.</p>
      <p><Link className="underline" href="/">Go to your businesses</Link></p>
    </main>
  );
}
