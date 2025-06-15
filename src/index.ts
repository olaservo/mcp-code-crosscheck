#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

console.error('Starting MCP Code Crosscheck server (STDIO)...');

async function main() {
  const transport = new StdioServerTransport();
  const { server, cleanup } = createServer();

  await server.connect(transport);

  // Cleanup on exit
  const handleExit = async () => {
    await cleanup();
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", handleExit);
  process.on("SIGTERM", handleExit);
  process.on("SIGQUIT", handleExit);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
