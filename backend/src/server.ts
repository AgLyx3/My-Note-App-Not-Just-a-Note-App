import "dotenv/config";
import { buildApp } from "./app.js";

const app = buildApp();
const port = Number(process.env.PORT ?? "3001");

app
  .listen({ port, host: "0.0.0.0" })
  .then((address) => {
    console.log(`Notes API listening at ${address}`);
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
