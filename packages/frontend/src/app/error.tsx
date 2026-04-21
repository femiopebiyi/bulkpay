"use client";

export default function Error({
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <div className="min-h-screen bg-bp-bg flex items-center justify-center">
            <div className="text-center">
                <h1 className="text-4xl font-bold text-white mb-2">500</h1>
                <p className="text-slate-400 mb-4">Something went wrong</p>
                <button
                    onClick={reset}
                    className="text-purple-400 hover:text-purple-300"
                >
                    Try again
                </button>
            </div>
        </div>
    );
}
