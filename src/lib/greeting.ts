/** "Good morning / afternoon / evening" from the viewer's local hour (0–23). */
export function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
