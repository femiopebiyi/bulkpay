function Error({ statusCode }: { statusCode: number }) {
    return (
        <div style={{
            minHeight: "100vh",
            background: "#0f1117",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontFamily: "sans-serif",
            textAlign: "center",
        }}>
            <div>
                <h1 style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>
                    {statusCode ?? "Error"}
                </h1>
                <p style={{ color: "#94a3b8" }}>
                    {statusCode === 404 ? "Page not found" : "Something went wrong"}
                </p>
                <a href="/" style={{ color: "#a78bfa", marginTop: "1rem", display: "block" }}>
                    Go home
                </a>
            </div>
        </div>
    );
}

Error.getInitialProps = ({ res, err }: { res: any; err: any }) => {
    const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
    return { statusCode };
};

export default Error;
