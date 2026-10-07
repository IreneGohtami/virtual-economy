import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="text-center max-w-2xl">
        <h1 className="text-5xl font-bold text-gray-900 mb-4">
          Virtual Economy
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          Build your commodity empire across Southeast Asia. Farm, produce, trade, and dominate the market.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/login"
            className="inline-flex items-center px-6 py-3 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
          >
            Login
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center px-6 py-3 rounded-lg bg-gray-200 text-gray-900 font-medium hover:bg-gray-300 transition-colors"
          >
            Register
          </Link>
        </div>
      </div>
    </main>
  );
}
