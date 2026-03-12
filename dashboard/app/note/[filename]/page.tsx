import NotePageClient from "./NotePageClient";

// Next.js requires at least one entry to satisfy the output:export check.
// The placeholder is never navigated to; real notes load via client-side routing.
export function generateStaticParams() {
  return [{ filename: "_placeholder" }];
}

export default function NotePage() {
  return <NotePageClient />;
}
