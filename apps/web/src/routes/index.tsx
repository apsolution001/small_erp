import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  return <h1 className="p-6 text-2xl font-semibold">Ekaro</h1>;
}
