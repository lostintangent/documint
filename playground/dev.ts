import page from "./index.html";

const port = Number(Bun.env.PORT ?? "3003");

const server = Bun.serve({
  hostname: "0.0.0.0",
  port,
  routes: {
    "/*": page,
  },
});

console.log(`Documint playground ready at http://0.0.0.0:${server.port}/`);
