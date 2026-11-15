import { Link } from "wouter";
import { Empty } from "@/components/bits";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md pt-10">
      <Empty title="That page does not exist">
        <Link href="/" className="font-medium text-primary underline underline-offset-4" data-testid="link-back-home">Back to Today</Link>
      </Empty>
    </div>
  );
}
