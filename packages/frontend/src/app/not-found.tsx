export default function NotFound() {
    return (
        <div className="min-h-screen bg-bp-bg flex items-center justify-center">
            <div className="text-center">
                <h1 className="text-4xl font-bold text-white mb-2">404</h1>
                <p className="text-slate-400">Page not found</p>
                <a href="/" className="mt-4 inline-block text-purple-400 hover:text-purple-300">
                    Go home
                </a>
            </div>
        </div>
    );
}
