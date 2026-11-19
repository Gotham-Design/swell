import { CircleAlert, CircleCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function FormAlert({ error, success }: { error?: string; success?: string }) {
  if (error) {
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (success) {
    return (
      <Alert role="status">
        <CircleCheck aria-hidden />
        <AlertDescription>{success}</AlertDescription>
      </Alert>
    );
  }
  return null;
}
