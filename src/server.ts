#!/usr/bin/env node
/**
 * LSP Server entry point for VS Code extension (Node IPC transport).
 * 
 * This file maintains backward compatibility with the VS Code extension
 * which expects the server to use Node IPC transport by default.
 * 
 * For standalone usage with stdio transport, use src/cli.ts instead.
 */

import { create_server } from './server-factory';

// Start server with Node IPC transport (VS Code default)
create_server({ transport: 'node-ipc' });
