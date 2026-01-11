/**
 * Embedded daemon source code.
 * This lightweight HTTP server is deployed to remote hosts via SSH bootstrap.
 */

/**
 * The daemon source code as a string.
 * Deployed to /tmp/panpan-daemon.ts and run with Deno.
 */
export const DAEMON_SOURCE = `
// panpan-daemon.ts - Remote execution daemon
// Usage: deno run --allow-all panpan-daemon.ts <port> <token> <timeout_seconds>

const port = parseInt(Deno.args[0]) || 0;  // 0 = random port
const token = Deno.args[1] || crypto.randomUUID();
const timeoutSeconds = parseInt(Deno.args[2]) || 1800;  // Default 30 minutes

let lastActivity = Date.now();

// Auto-shutdown timer
const shutdownTimer = setInterval(() => {
  if (Date.now() - lastActivity > timeoutSeconds * 1000) {
    console.log("Daemon timeout, shutting down...");
    Deno.exit(0);
  }
}, 60000);

// HTTP server
const server = Deno.serve({ port }, async (req) => {
  lastActivity = Date.now();

  // Validate token
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== \`Bearer \${token}\`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);

  // GET /health - Health check
  if (url.pathname === "/health" && req.method === "GET") {
    return Response.json({
      status: "ok",
      pid: Deno.pid,
      uptime: Date.now() - (lastActivity - timeoutSeconds * 1000),
    });
  }

  // POST /exec - Execute command
  if (url.pathname === "/exec" && req.method === "POST") {
    try {
      const body = await req.json();
      const { command, cwd, env, timeout = 60000 } = body;

      const cmd = new Deno.Command("bash", {
        args: ["-c", command],
        cwd: cwd || Deno.cwd(),
        env: { ...Deno.env.toObject(), ...env },
        stdout: "piped",
        stderr: "piped",
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const process = cmd.spawn();
      const [stdout, stderr] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);
      const status = await process.status;

      clearTimeout(timeoutId);

      return Response.json({
        stdout,
        stderr,
        exitCode: status.code,
      });
    } catch (error) {
      return Response.json({
        error: error.message,
        exitCode: -1,
      }, { status: 500 });
    }
  }

  // POST /file/read - Read file
  if (url.pathname === "/file/read" && req.method === "POST") {
    try {
      const { path } = await req.json();
      const content = await Deno.readTextFile(path);
      return Response.json({ content });
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /file/write - Write file
  if (url.pathname === "/file/write" && req.method === "POST") {
    try {
      const { path, content } = await req.json();
      await Deno.writeTextFile(path, content);
      return Response.json({ success: true });
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /shutdown - Shutdown daemon
  if (url.pathname === "/shutdown" && req.method === "POST") {
    clearInterval(shutdownTimer);
    setTimeout(() => Deno.exit(0), 100);
    return Response.json({ message: "Shutting down" });
  }

  return new Response("Not Found", { status: 404 });
});

// Output startup info (captured by SSH bootstrap)
console.log(\`DAEMON_STARTED:{"port":\${server.addr.port},"token":"\${token}","pid":\${Deno.pid}}\`);
`;

/** Daemon version */
export const DAEMON_VERSION = "0.1.0";

/** Command to check if Deno is installed */
export function getDenoCheckCommand(): string {
  return "which deno || ([ -f ~/.deno/bin/deno ] && echo ~/.deno/bin/deno) || echo 'DENO_NOT_FOUND'";
}

/** Command to install Deno */
export function getDenoInstallCommand(): string {
  return "curl -fsSL https://deno.land/install.sh | sh";
}

/** Get the path to deno binary (handles both system and user install) */
export function getDenoPath(): string {
  return "~/.deno/bin/deno";
}
