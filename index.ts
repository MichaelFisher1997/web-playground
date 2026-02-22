Bun.serve({
  port: 3000,
  routes: {
    "/": new Response("Hello from web-playground via Tailscale Funnel!"),
    "/api": Response.json({ message: "API is working", timestamp: Date.now() }),
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log("Server running on http://localhost:3000");
