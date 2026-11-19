// Development-only previews of screens with sample data, for checking the build against
// the Figma frames without a signed-in session. 404s in production builds.
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PREVIEWS } from "./previews";

export default function PreviewPage({ params }: PageProps<"/dev/preview/[screen]">) {
  if (process.env.NODE_ENV !== "development") notFound();
  return <Suspense fallback={null}><Preview params={params} /></Suspense>;
}

async function Preview({ params }: Pick<PageProps<"/dev/preview/[screen]">, "params">) {
  const { screen } = await params;
  const render = PREVIEWS[screen];
  if (!render) notFound();
  return render();
}
