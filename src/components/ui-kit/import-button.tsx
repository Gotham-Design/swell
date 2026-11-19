import Link from "next/link";
import { Button } from "@/components/ui/button";
import { RailImportIcon } from "@/components/shell/rail-icons";

/** The screen's evergreen primary: always the far-right button. */
export function ImportStatementButton({ businessId, accountId, variant = "default", size = "default", label = "Import statement" }: {
  businessId: string; accountId?: string; variant?: "default" | "outline"; size?: "default" | "sm"; label?: string;
}) {
  return (
    <Button variant={variant} size={size} nativeButton={false} data-testid="import-statement"
      render={<Link href={`/b/${businessId}/import${accountId ? `?account=${accountId}` : ""}`} />}>
      <RailImportIcon className="size-4" /> {label}
    </Button>
  );
}
