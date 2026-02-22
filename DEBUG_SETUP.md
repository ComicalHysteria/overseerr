# Overseerr Debug Setup Guide

## Overview

Your Overseerr workspace is now configured for full-stack debugging with Node.js backend and Chrome DevTools for frontend.

## Configuration Files Updated

### 1. `.vscode/settings.json`

Enhanced with TypeScript support, formatter associations, and debug settings:

- TypeScript SDK configured to use workspace version
- Prettier formatting enabled for TS/TSX/JS files
- Debug auto-attach disabled (manual control)

### 2. `.vscode/launch.json`

Multiple debugging configurations available:

#### **Backend (Node.js)**

- Starts nodemon with TypeScript support
- Inspect port: 9229
- Environment: development with DEBUG logs enabled
- **Use when**: Debugging Express server, API routes, database operations

#### **Frontend (Chrome DevTools)**

- Connects to `http://localhost:3000`
- Source maps enabled for Next.js
- **Use when**: Debugging React components, frontend logic, browser interactions

#### **Full Stack Debug (Backend + Frontend)**

- Compound configuration runs both simultaneously
- Backend loads first, then Chrome opens with frontend
- **Use when**: Debugging interactions between frontend and backend

#### **Attach to Node.js**

- Attaches to already-running Node process on port 9229
- **Use when**: Connecting to a running backend instance

#### **Next.js (full debug)**

- Direct Next.js dev server with Node inspector
- **Use when**: Debugging Next.js specific features

### 3. `.vscode/tasks.json`

Helper tasks for common operations:

- **Install dependencies** - Runs `yarn`
- **Start Next.js Dev Server** - Runs frontend dev server
- **Build Backend** - Compiles TypeScript server code
- **Build Frontend** - Builds Next.js
- **Build Everything** - Full build
- **Lint Code** - ESLint validation
- **Type Check** - TypeScript type checking
- **Format Code** - Prettier formatting
- **Start Production Server** - Runs production build

### 4. `.vscode/extensions.json`

Recommended extensions for debugging:

- `msjsdiag.debugger-for-chrome` - Chrome debugger
- `msjsdiag.debugger-for-edge` - Edge debugger
- `mtxr.sqltools` + `mtxr.sqltools-driver-sqlite` - Database browser

## How to Use

### Quick Start - Full Stack Debugging

1. Press `Ctrl+Shift+D` (or `Cmd+Shift+D` on Mac) to open Debug view
2. Select **"Full Stack Debug (Backend + Frontend)"** from the dropdown
3. Press `F5` to start debugging
4. VS Code will start the Node.js backend and open Chrome with frontend

### Backend Only

1. Open Debug view (`Ctrl+Shift+D`)
2. Select **"Backend (Node.js)"**
3. Press `F5`
4. Set breakpoints in `server/**/*.ts` files

### Frontend Only (requires backend running separately)

1. Run backend: Open terminal and run `npm run dev` or use "Backend (Node.js)" debug config
2. Open Debug view (`Ctrl+Shift+D`)
3. Select **"Frontend (Chrome DevTools)"**
4. Press `F5`
5. Set breakpoints in `src/**/*.tsx` files and React DevTools

### Manual Backend Debugging

If backend is already running on port 9229:

1. Open Debug view (`Ctrl+Shift+D`)
2. Select **"Attach to Node.js"**
3. Press `F5`
4. Debug will attach to running process

## Breakpoints & Debugging Features

### Setting Breakpoints

- **Click** on line number to toggle breakpoint
- **Right-click** for conditional breakpoints (e.g., `i > 5`)
- Use **Logpoints** for non-blocking debugging logs

### Debug Console

- Use Debug Console (Ctrl+Shift+Y) for immediate evaluation in current scope
- Type `locals` to inspect all local variables
- Type `globals` to see global scope

### Watch Expression

- Add variables in Watch panel to monitor during execution
- Automatically updates as you step through code

## Environment Variables

The backend debug config sets:

```
NODE_ENV=development
DEBUG=overseerr:*
```

To add more, edit `launch.json` and add to the `env` object.

## Keyboard Shortcuts

| Action            | Shortcut            |
| ----------------- | ------------------- |
| Toggle Breakpoint | F9                  |
| Start Debugging   | F5                  |
| Continue          | F5 or Ctrl+Shift+F5 |
| Step Over         | F10                 |
| Step Into         | F11                 |
| Step Out          | Shift+F11           |
| Pause             | Ctrl+Shift+D        |
| Stop              | Shift+F5            |
| Open Debug View   | Ctrl+Shift+D        |
| Debug Console     | Ctrl+Shift+Y        |

## Troubleshooting

### Port Already in Use

If port 9229 or 3000 is already in use:

```bash
# List processes on port
lsof -i :9229  # or :3000

# Kill process
kill -9 <PID>
```

### Chrome DevTools Not Opening

- Ensure Chrome is installed
- Check `http://localhost:3000` is accessible in browser
- Clear Chrome cache: `Ctrl+Shift+Delete`
- Try with incognito window

### Source Maps Not Working

- Run `npm run build:next` first to generate source maps
- Check `.next/` directory exists
- Verify `"sourceMaps": true` in launch.json

### Backend Not Breaking on Breakpoints

- Ensure backend TypeScript is being compiled
- Check `--inspect=9229` flag is set
- Verify you're debugging `server/**` files, not `dist/**`

### Cannot Find Package Errors

- Run `npm install` or `yarn` to install dependencies
- Restart VS Code debug session
- Check `server/tsconfig.json` paths are correct

## Additional Resources

- [VS Code Debugging Docs](https://code.visualstudio.com/docs/editor/debugging)
- [Node.js Debugging](https://nodejs.org/en/docs/guides/debugging-getting-started/)
- [Chrome DevTools Protocol](https://chromedevtools.io/protocol/)
- [Next.js Debugging](https://nextjs.org/docs/advanced-features/debugging)

## Project Structure Reference

```
overseerr/
├── server/           # Express backend (TypeScript)
│   ├── api/         # API routes
│   ├── entity/      # Database entities (TypeORM)
│   ├── middleware/  # Express middleware
│   └── index.ts     # Entry point
├── src/             # Next.js frontend (React + TypeScript)
│   ├── pages/       # Next.js pages
│   ├── components/  # React components
│   ├── hooks/       # Custom React hooks
│   └── utils/       # Utility functions
├── .vscode/         # VS Code settings (this is what we configured)
│   ├── launch.json  # Debug configurations
│   ├── tasks.json   # Build/run tasks
│   └── settings.json # Editor settings
└── package.json     # Dependencies
```

---

**Happy debugging! 🎯**
